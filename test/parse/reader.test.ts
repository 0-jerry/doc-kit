import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectiveAux, parseFragment } from '../../src/model/index.js'
import { formatDirective, parseDirective, parseDocument } from '../../src/parse/index.js'
import { loadPreset } from '../../src/schema/index.js'

const schema = loadPreset('preset/principle')

function read(body: string, options: { collection?: string; name?: string } = {}) {
  const collection = options.collection ?? 'principle'
  const name = options.name ?? 'sample'
  return parseDocument(body, { schema, path: `${collection}/${name}.md`, collection, name })
}

function codes(result: ReturnType<typeof read>): string[] {
  return result.diagnostics.map((item) => item.code)
}

const HEAD = '---\ntype: principle\nid: sample\n---\n\n'

test('frontmatter 는 문서의 보조데이터가 된다', () => {
  const { document } = read(
    '---\ntype: principle\nid: 이름\nsubject: [domain]\ntopic: [validation]\nstatus: active\nrefines: principle/다른문서#core\n---\n\n## 기준\n\n진술.\n',
  )
  assert.equal(document?.id, 'principle/이름')
  assert.equal(document?.type, 'principle')
  assert.deepEqual(document?.aux.subject, ['domain'])
  assert.deepEqual(document?.aux.topic, ['validation'])
  assert.equal(document?.aux.lifecycle.status, 'active')
  assert.deepEqual(document?.aux.relations, [
    { kind: 'refines', target: 'principle/다른문서#core' },
  ])
})

test('컬렉션 이름으로 문서 타입을 정한다', () => {
  const { document, diagnostics } = read('---\nid: sample\n---\n\n## 기준\n\n진술.\n')
  assert.equal(document?.type, 'principle')
  assert.deepEqual(diagnostics, [])
})

test('규약에 없는 컬렉션은 오류로 보고한다', () => {
  const result = read('---\nid: sample\n---\n\n## 기준\n\n진술.\n', { collection: '모르는곳' })
  assert.ok(codes(result).includes('PRS007'))
})

test('섹션 제목은 규약의 키로 옮겨지고 기본 역할이 해소된다', () => {
  const { document } = read(`${HEAD}## 기준\n\n진술.\n\n## 근거\n\n설명.\n`)
  const norm = document!.resolve(parseFragment('norm/0')!)
  const rationale = document!.resolve(parseFragment('rationale/0')!)
  assert.equal(norm?.node.aux.role, 'norm')
  assert.equal(rationale?.node.aux.role, 'rationale')
})

test('디렉티브가 기본 역할을 덮어쓴다', () => {
  const { document } = read(`${HEAD}## 예시\n\n<!-- rk: role=counter-example id=bad -->\n반례 문단.\n`)
  const block = document!.resolve(parseFragment('bad')!)
  assert.equal(block?.node.aux.role, 'counter-example')
  assert.equal(block?.node.stableId, 'bad')
})

test('디렉티브의 대상과 주제는 상속을 통해 좁혀진다', () => {
  const { document } = read(
    '---\ntype: principle\nid: sample\nsubject: [domain, app]\n---\n\n## 기준\n\n<!-- rk: subject=[domain] topic=[invariant] -->\n진술.\n',
  )
  const visit = document!.resolve(parseFragment('norm/0')!)!
  const resolved = effectiveAux(visit)
  assert.deepEqual(resolved.subject, ['domain'])
  assert.deepEqual(resolved.topic, ['invariant'])
})

test('규약에 없는 제목은 경고하고 슬러그 키로 담는다', () => {
  const result = read(`${HEAD}## 알 수 없는 제목\n\n문단.\n`)
  assert.ok(codes(result).includes('PRS005'))
  assert.equal(result.document?.sections[0]?.key, '알-수-없는-제목')
})

test('규약에 없는 디렉티브 키는 오류다', () => {
  const result = read(`${HEAD}## 기준\n\n<!-- rk: 없는키=값 -->\n진술.\n`)
  assert.ok(codes(result).includes('PRS004'))
})

test('역할을 여럿 적으면 오류로 알린다', () => {
  const result = read(`${HEAD}## 기준\n\n<!-- rk: role=[norm, note] -->\n진술.\n`)
  assert.ok(codes(result).includes('PRS004'))
  assert.match(result.diagnostics.map((item) => item.message).join(), /블록을 나누세요/)
})

test('붙을 곳이 없는 디렉티브는 경고한다', () => {
  const result = read(`${HEAD}## 기준\n\n진술.\n\n<!-- rk: role=note -->\n`)
  assert.ok(codes(result).includes('PRS004'))
  assert.equal(result.document?.sections.length, 1)
})

test('frontmatter 가 없으면 오류지만 문서는 만든다', () => {
  const result = read('## 기준\n\n진술.\n')
  assert.ok(codes(result).includes('PRS001'))
  assert.notEqual(result.document, null)
})

test('YAML 이 깨지면 문서를 만들지 않는다', () => {
  const result = read('---\ntype: [깨짐\n---\n\n## 기준\n\n진술.\n')
  assert.ok(codes(result).includes('PRS002'))
  assert.equal(result.document, null)
})

test('블록 형태를 거칠게 분류한다', () => {
  const { document } = read(
    `${HEAD}## 기준\n\n문단.\n\n- 목록\n\n\`\`\`ts\ncode\n\`\`\`\n\n> 인용\n`,
  )
  const forms = document!.sections[0]!.blocks.map((block) => block.form)
  assert.deepEqual(forms, ['paragraph', 'list', 'code', 'quote'])
})

test('중첩 섹션은 제목 깊이로 이어진다', () => {
  const { document } = read(`${HEAD}## 기준\n\n진술.\n\n### 더 좁은 경우\n\n문단.\n\n## 근거\n\n설명.\n`)
  assert.deepEqual(
    document!.sections.map((section) => section.key),
    ['norm', 'rationale'],
  )
  assert.equal(document!.sections[0]!.sections[0]?.heading, '더 좁은 경우')
})

test('공백을 담은 값은 목록 표기로 써야 다시 읽힌다', () => {
  const line = formatDirective([{ key: 'status', values: ['외부 API'], isList: false }])
  assert.equal(line, '<!-- rk: status=[외부 API] -->')
  assert.deepEqual(parseDirective(line!)?.entries, [
    { key: 'status', values: ['외부 API'], isList: true },
  ])
})

test('안정 식별자에 주소 구분자가 섞이면 오류다', () => {
  const result = read(`${HEAD}## 기준\n\n<!-- rk: id=a#b -->\n진술.\n`)
  assert.ok(codes(result).includes('PRS004'))
  assert.equal(result.document?.sections[0]?.blocks[0]?.stableId, null)
})
