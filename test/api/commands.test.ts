import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, applyCommands, breaksRules } from '../../src/api/index.js'
import { Block, parseFragment } from '../../src/model/index.js'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset } from '../../src/schema/index.js'
import { serializeDocument } from '../../src/serialize/index.js'

const schema = loadPreset('preset/principle')
const options = { schema }

const TEXT = `---
type: principle
id: sample
---

## 기준

<!-- rk: id=core -->
진술이다.

## 근거

설명이다.
`

function read() {
  return parseDocument(TEXT, {
    schema,
    path: 'principle/sample.md',
    collection: 'principle',
    name: 'sample',
  }).document!
}

test('document.create — 규약이 아는 타입으로 빈 문서를 만든다', () => {
  const result = applyCommand(
    null,
    { op: 'document.create', collection: 'principle', name: '새-판단기준' },
    options,
  )
  assert.equal(result.ok, true)
  assert.equal(result.document?.id, 'principle/새-판단기준')
  assert.equal(result.document?.type, 'principle')
})

test('document.create — 모르는 컬렉션은 거절한다', () => {
  const result = applyCommand(
    null,
    { op: 'document.create', collection: '모르는곳', name: 'x' },
    options,
  )
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD003')
})

test('section.ensure — 규약이 정한 순서 자리에 끼운다', () => {
  const withoutExample = read()
  const result = applyCommand(withoutExample, { op: 'section.ensure', key: 'example' }, options)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.document?.sections.map((section) => section.key),
    ['norm', 'rationale', 'example'],
  )
})

test('section.ensure — 이미 있으면 그대로 둔다', () => {
  const document = read()
  const result = applyCommand(document, { op: 'section.ensure', key: 'norm' }, options)
  assert.equal(result.ok, true)
  assert.equal(result.document?.sections.length, 2)
})

test('section.ensure — 규약에 없는 섹션은 거절한다', () => {
  const result = applyCommand(read(), { op: 'section.ensure', key: '없는섹션' }, options)
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD006')
})

test('block.insert — 섹션 기본 역할이 붙는다', () => {
  const result = applyCommand(
    read(),
    { op: 'block.insert', at: 'rationale', markdown: '덧붙이는 설명.' },
    options,
  )
  assert.equal(result.ok, true)
  const inserted = result.document!.resolve(parseFragment('rationale/1')!)
  assert.equal((inserted?.node as Block).aux.role, 'rationale')
  assert.equal((inserted?.node as Block).text, '덧붙이는 설명.')
})

test('block.insert — 블록 상한을 넘으면 거절한다', () => {
  let document = read()
  for (const markdown of ['둘째.', '셋째.']) {
    const result = applyCommand(document, { op: 'block.insert', at: 'norm', markdown }, options)
    assert.equal(result.ok, true)
    document = result.document!
  }
  const overflow = applyCommand(document, { op: 'block.insert', at: 'norm', markdown: '넷째.' }, options)
  assert.equal(overflow.ok, false)
  assert.equal(overflow.diagnostics[0]?.code, 'CMD010')
})

test('block.insert — 블록 여러 개를 한 명령으로 만들 수 없다', () => {
  const result = applyCommand(
    read(),
    { op: 'block.insert', at: 'rationale', markdown: '하나.\n\n둘.' },
    options,
  )
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD009')
})

test('block.update — 본문만 바꾸면 나머지는 원문 그대로다', () => {
  const result = applyCommand(
    read(),
    { op: 'block.update', at: 'core', markdown: '고친 진술이다.' },
    options,
  )
  assert.equal(result.ok, true)
  const output = serializeDocument(result.document!, { schema })
  assert.match(output, /<!-- rk: id=core -->\n고친 진술이다\./)
  assert.ok(output.includes('설명이다.'))
})

test('block.remove — 블록을 뺀다', () => {
  const result = applyCommand(read(), { op: 'block.remove', at: 'core' }, options)
  assert.equal(result.ok, true)
  assert.equal(result.document!.sections[0]?.children.length, 0)
})

test('node.move — 자기 자손 아래로는 옮길 수 없다', () => {
  const result = applyCommand(read(), { op: 'node.move', at: 'norm', to: 'norm' }, options)
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD012')
})

test('node.move — 새 부모가 다루지 않는 대상이면 거절한다', () => {
  const text = `---
type: principle
id: sample
---

## 기준

<!-- rk: id=core subject=[domain] -->
진술이다.

<!-- rk: subject=[app] -->
## 근거

설명이다.
`
  const document = parseDocument(text, {
    schema,
    path: 'principle/sample.md',
    collection: 'principle',
    name: 'sample',
  }).document!
  const result = applyCommand(document, { op: 'node.move', at: 'core', to: 'rationale' }, options)
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD013')
})

test('relation.link — 규약에 없는 관계는 거절한다', () => {
  const result = applyCommand(
    read(),
    { op: 'relation.link', at: 'core', kind: '아무관계', target: 'principle/다른#core' },
    options,
  )
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD014')
})

test('relation.link — 안정 식별자가 없는 노드에서는 걸 수 없다', () => {
  const result = applyCommand(
    read(),
    { op: 'relation.link', at: 'rationale/0', kind: 'refines', target: 'principle/다른#core' },
    options,
  )
  assert.equal(result.ok, false)
  assert.equal(result.diagnostics[0]?.code, 'CMD016')
})

test('relation.link — 걸고 끊는다', () => {
  const linked = applyCommand(
    read(),
    { op: 'relation.link', at: 'core', kind: 'refines', target: 'principle/다른#core' },
    options,
  )
  assert.equal(linked.ok, true)
  const node = linked.document!.resolve(parseFragment('core')!)!.node
  assert.deepEqual(node.aux.relations, [{ kind: 'refines', target: 'principle/다른#core' }])

  const unlinked = applyCommand(
    linked.document,
    { op: 'relation.unlink', at: 'core', kind: 'refines', target: 'principle/다른#core' },
    options,
  )
  assert.deepEqual(unlinked.document!.resolve(parseFragment('core')!)!.node.aux.relations, [])
})

test('모르는 명령과 형식을 벗어난 인자를 구분해 거절한다', () => {
  assert.equal(applyCommand(read(), { op: '없는명령' }, options).diagnostics[0]?.code, 'CMD000')
  const bad = applyCommand(read(), { op: 'block.insert', at: 'norm' }, options)
  assert.equal(bad.ok, false)
  assert.match(bad.diagnostics[0]?.message ?? '', /형식을 벗어났습니다/)
})

test('명령 묶음은 하나라도 거절되면 아무것도 적용하지 않는다', () => {
  const document = read()
  const result = applyCommands(
    document,
    [
      { op: 'block.insert', at: 'rationale', markdown: '되는 명령.' },
      { op: 'block.insert', at: '없는섹션', markdown: '안 되는 명령.' },
    ],
    options,
  )
  assert.equal(result.ok, false)
  assert.equal(result.document, document)
  assert.match(result.diagnostics[0]?.message ?? '', /^2번째 명령:/)
})

test('적용 결과에 원칙 검사를 함께 돌려준다', () => {
  const result = applyCommands(
    read(),
    [{ op: 'block.update', at: 'core', markdown: '하나다. 둘이다. 셋이다. 넷이다.' }],
    options,
  )
  assert.equal(result.ok, true)
  assert.ok(result.diagnostics.some((item) => item.code === 'STR001'))
  assert.equal(breaksRules(result), false)
})

test('검사를 끄면 진단 없이 적용만 한다', () => {
  const result = applyCommands(
    read(),
    [{ op: 'block.update', at: 'core', markdown: '하나다. 둘이다. 셋이다. 넷이다.' }],
    { schema, validate: false },
  )
  assert.deepEqual(result.diagnostics, [])
})

test('새로 만든 블록은 앞 블록과 빈 줄로 갈라진다', () => {
  const result = applyCommand(
    read(),
    { op: 'block.insert', at: 'rationale', markdown: '또 다른 문단.' },
    options,
  )
  const output = serializeDocument(result.document!, { schema })
  assert.ok(output.includes('설명이다.\n\n또 다른 문단.\n'))

  // 다시 읽으면 블록이 둘이어야 한다 — 하나로 합쳐지면 보조데이터가 사라진다
  const reread = parseDocument(output, {
    schema,
    path: 'principle/sample.md',
    collection: 'principle',
    name: 'sample',
  }).document!
  assert.equal(reread.sections[1]?.blocks.length, 2)
})

test('명령으로 만든 문서도 다시 읽을 수 있다', () => {
  const built = applyCommands(
    null,
    [
      { op: 'document.create', collection: 'principle', name: '새것' },
      { op: 'section.ensure', key: 'norm' },
      { op: 'block.insert', at: 'norm', markdown: '새 진술이다.' },
      { op: 'section.ensure', key: 'rationale' },
      { op: 'block.insert', at: 'rationale', markdown: '새 근거다.' },
    ],
    options,
  )
  assert.equal(built.ok, true)
  assert.deepEqual(built.diagnostics, [])

  const text = serializeDocument(built.document!, { schema })
  assert.equal(text, '---\ntype: principle\nid: 새것\n---\n\n## 기준\n\n새 진술이다.\n\n## 근거\n\n새 근거다.\n')

  const reread = parseDocument(text, {
    schema,
    path: 'principle/새것.md',
    collection: 'principle',
    name: '새것',
  })
  assert.deepEqual(reread.diagnostics, [])
  assert.equal(serializeDocument(reread.document!, { schema }), text)
})

test('섹션을 새로 끼워도 앞 블록과 갈라진다', () => {
  const result = applyCommand(read(), { op: 'section.ensure', key: 'example' }, options)
  const output = serializeDocument(result.document!, { schema })
  assert.ok(output.includes('설명이다.\n\n## 예시\n'))
})
