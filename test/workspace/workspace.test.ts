import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadSchema } from '../../src/schema/index.js'
import { type SourceFile, buildWorkspace } from '../../src/workspace/index.js'
import { contextFor, matchesGlob, query, subjectsForPath } from '../../src/query/index.js'

const schema = loadSchema({
  version: 1,
  extends: 'preset/principle',
  vocabularies: {
    subject: {
      closed: true,
      values: ['domain', 'infra'],
      paths: { domain: ['src/domain/**'], infra: ['src/infra/**', '*.config.ts'] },
    },
  },
})

function source(name: string, text: string): SourceFile {
  return { kind: 'file', path: `principle/${name}.md`, collection: 'principle', name, text }
}

const 불변식 = source(
  '불변식',
  `---
type: principle
id: 불변식
subject: [domain]
topic: [validation]
status: active
---

## 기준

<!-- rk: id=core -->
불변식은 생성자에서 검증한다.

## 근거

유효하지 않은 상태가 존재할 수 없게 된다.
`,
)

const 로깅 = source(
  '로깅',
  `---
type: principle
id: 로깅
subject: [infra]
topic: [observability]
status: active
refines: principle/불변식#core
---

## 기준

<!-- rk: id=core -->
경계에서만 로그를 남긴다.

## 근거

같은 사건이 여러 번 기록되지 않는다.
`,
)

function build(sources: readonly SourceFile[]) {
  return buildWorkspace(sources, { root: '.', schema })
}

test('역인덱스가 대상·주제·역할별로 선다', () => {
  const workspace = build([불변식, 로깅])
  assert.equal(workspace.documents.length, 2)
  // 대상은 문서에서 자손으로 흐르므로 그 문서의 모든 노드가 색인에 들어간다
  const domain = workspace.bySubject.get('domain') ?? []
  assert.ok(domain.includes('principle/불변식'))
  assert.ok(domain.includes('principle/불변식#norm/0'))
  assert.ok(!domain.some((address) => address.startsWith('principle/로깅')))
  assert.ok(workspace.byTopic.has('validation'))
  assert.ok((workspace.byRole.get('norm') ?? []).length >= 2)
  assert.ok(workspace.byStatus.has('active'))
})

test('질의는 규범 진술만 돌려주고 근거는 링크로 단다', () => {
  const workspace = build([불변식, 로깅])
  const hits = query(workspace, { role: ['norm'] })
  assert.equal(hits.length, 2)
  const hit = hits.find((item) => item.document === 'principle/불변식')!
  assert.equal(hit.text, '불변식은 생성자에서 검증한다.')
  assert.deepEqual(hit.breadcrumb, ['기준'])
  assert.ok(hit.support.length > 0)
  // 근거의 본문은 붙이지 않는다
  assert.ok(hit.support.every((address) => typeof address === 'string'))
})

test('대상으로 좁힐 수 있다', () => {
  const workspace = build([불변식, 로깅])
  const hits = query(workspace, { role: ['norm'], subject: ['infra'] })
  assert.deepEqual(hits.map((hit) => hit.document), ['principle/로깅'])
})

test('경로가 어떤 대상인지는 어휘가 답한다', () => {
  const workspace = build([불변식, 로깅])
  assert.deepEqual(subjectsForPath(workspace, 'src/domain/Order.ts'), ['domain'])
  assert.deepEqual(subjectsForPath(workspace, 'vite.config.ts'), ['infra'])
  assert.deepEqual(subjectsForPath(workspace, 'README.md'), [])
})

test('context 는 그 파일에 적용되는 판단기준만 모은다', () => {
  const workspace = build([불변식, 로깅])
  const result = contextFor(workspace, 'src/domain/Order.ts')
  assert.deepEqual(result.subjects, ['domain'])
  assert.deepEqual(result.hits.map((hit) => hit.document), ['principle/불변식'])
})

test('대상을 선언하지 않은 판단기준은 어디에나 적용된다', () => {
  const 공통 = source(
    '공통',
    '---\ntype: principle\nid: 공통\n---\n\n## 기준\n\n이름은 뜻을 드러낸다.\n\n## 근거\n\n읽는 사람이 선언부를 찾아가지 않아도 된다.\n',
  )
  const result = contextFor(build([불변식, 공통]), 'src/domain/Order.ts')
  assert.deepEqual(result.hits.map((hit) => hit.document).sort(), [
    'principle/공통',
    'principle/불변식',
  ])
})

test('REF002 — 가리키는 곳이 없는 링크는 오류', () => {
  const 끊긴 = source(
    '끊긴',
    '---\ntype: principle\nid: 끊긴\nrefines: principle/없는문서#core\n---\n\n## 기준\n\n진술.\n\n## 근거\n\n설명.\n',
  )
  const codes = build([끊긴]).diagnostics.map((item) => item.code)
  assert.ok(codes.includes('REF002'))
})

test('REF003 — 비순환 관계의 순환은 오류', () => {
  const a = source(
    'a',
    '---\ntype: principle\nid: a\nrefines: principle/b#core\n---\n\n## 기준\n\n<!-- rk: id=core -->\n진술 가.\n\n## 근거\n\n설명.\n',
  )
  const b = source(
    'b',
    '---\ntype: principle\nid: b\nrefines: principle/a#core\n---\n\n## 기준\n\n<!-- rk: id=core -->\n진술 나.\n\n## 근거\n\n설명.\n',
  )
  const codes = build([a, b]).diagnostics.map((item) => item.code)
  assert.ok(codes.includes('REF003'))
})

test('REF001 — 같은 진술이 두 곳에 있으면 경고', () => {
  const 사본 = source(
    '사본',
    '---\ntype: principle\nid: 사본\n---\n\n## 기준\n\n불변식은 생성자에서 검증한다.\n\n## 근거\n\n다른 근거.\n',
  )
  const codes = build([불변식, 사본]).diagnostics.map((item) => item.code)
  assert.ok(codes.includes('REF001'))
})

test('REF004 — 짝이 맞아야 하는 관계가 한쪽만 걸리면 경고', () => {
  const codes = build([불변식, 로깅]).diagnostics.map((item) => item.code)
  // refines 는 대칭도 역관계도 없으므로 REF004 가 나오지 않는다
  assert.ok(!codes.includes('REF004'))

  const 충돌 = source(
    '충돌',
    '---\ntype: principle\nid: 충돌\nconflicts: principle/불변식\n---\n\n## 기준\n\n진술.\n\n## 근거\n\n설명.\n',
  )
  assert.ok(build([불변식, 충돌]).diagnostics.map((item) => item.code).includes('REF004'))
})

test('REF005 — 문서 식별자가 겹치면 오류', () => {
  const 같은id: SourceFile = {
    kind: 'file',
    path: 'principle/다른파일.md',
    collection: 'principle',
    name: '다른파일',
    text: 불변식.text,
  }
  const codes = build([불변식, 같은id]).diagnostics.map((item) => item.code)
  assert.ok(codes.includes('REF005'))
})

test('글롭은 * ** ? 만 안다', () => {
  assert.equal(matchesGlob('src/domain/Order.ts', 'src/domain/**'), true)
  assert.equal(matchesGlob('src/domain/a/b/Order.ts', 'src/domain/**'), true)
  assert.equal(matchesGlob('src/infra/Order.ts', 'src/domain/**'), false)
  assert.equal(matchesGlob('a.config.ts', '*.config.ts'), true)
  assert.equal(matchesGlob('src/a.config.ts', '*.config.ts'), false)
  assert.equal(matchesGlob('src/a.ts', 'src/?.ts'), true)
})

test('작업공간에서 문서와 기록을 주소로 찾는다', () => {
  const workspace = build([불변식])
  assert.equal(workspace.document('principle/불변식')?.type, 'principle')
  assert.equal(workspace.record('principle/불변식#norm/0')?.role, 'norm')
  assert.equal(workspace.document('없음'), null)
})
