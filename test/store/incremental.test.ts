/**
 * 증분 인덱싱. 측정하는 것은 "건너뛰었는가" 다 —
 * 캐시가 맞았다고 말하는 것으로는 부족하고, 파싱 횟수가 실제로 0 이어야 한다.
 */

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadPreset } from '../../src/schema/index.js'
import { indexWorkspace } from '../../src/workspace/index.js'

const schema = loadPreset('preset/principle')

function document(id: string, norm: string): string {
  return `---
type: principle
id: ${id}
subject: []
status: active
---

## 기준

${norm}

## 근거

${norm} 이렇게 두면 이후가 단순해진다.
`
}

/** 문서 몇 개가 든 루트를 만든다. */
function fixture(documents: Record<string, string>): { root: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), 'dockit-inc-'))
  mkdirSync(join(root, 'principle'), { recursive: true })
  for (const [id, norm] of Object.entries(documents)) {
    writeFileSync(join(root, 'principle', `${id}.md`), document(id, norm), 'utf8')
  }
  return { root, store: join(root, '.store') }
}

const THREE = { 가: '가를 한다.', 나: '나를 한다.', 다: '다를 한다.' }

test('처음에는 전부 파싱한다', () => {
  const { root, store } = fixture(THREE)
  try {
    const { stats, workspace } = indexWorkspace({ root, schema, store })
    assert.equal(workspace.entries.length, 3)
    assert.equal(stats.parsed, 3)
    assert.equal(stats.cached, 0)
    assert.equal(stats.files.misses, 3)
    assert.ok(stats.objects.written > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('바뀐 것이 없으면 한 번도 파싱하지 않고 파일도 읽지 않는다', () => {
  const { root, store } = fixture(THREE)
  try {
    indexWorkspace({ root, schema, store })
    const { stats } = indexWorkspace({ root, schema, store })

    assert.equal(stats.parsed, 0)
    assert.equal(stats.cached, 3)
    assert.equal(stats.files.misses, 0)
    assert.equal(stats.files.hits, 3)
    assert.equal(stats.objects.written, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('한 문서만 고치면 그 하나만 파싱한다', () => {
  const { root, store } = fixture(THREE)
  try {
    indexWorkspace({ root, schema, store })
    writeFileSync(join(root, 'principle', '나.md'), document('나', '나를 다르게 한다.'), 'utf8')

    const { stats } = indexWorkspace({ root, schema, store })
    assert.equal(stats.parsed, 1)
    assert.equal(stats.cached, 2)
    assert.equal(stats.files.misses, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('기록은 캐시를 타도 같다', () => {
  const { root, store } = fixture(THREE)
  try {
    const fresh = indexWorkspace({ root, schema, store })
    const cached = indexWorkspace({ root, schema, store })

    assert.equal(cached.stats.cached, 3)
    assert.deepEqual(
      cached.workspace.records.map((record) => record.address),
      fresh.workspace.records.map((record) => record.address),
    )
    assert.deepEqual(cached.workspace.records, fresh.workspace.records)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('뿌리 주소는 내용이 같으면 같다 — 되돌리면 되돌아온다', () => {
  const { root, store } = fixture(THREE)
  try {
    const before = indexWorkspace({ root, schema, store }).root
    writeFileSync(join(root, 'principle', '나.md'), document('나', '잠깐 다르게.'), 'utf8')
    const changed = indexWorkspace({ root, schema, store }).root
    writeFileSync(join(root, 'principle', '나.md'), document('나', '나를 한다.'), 'utf8')
    const after = indexWorkspace({ root, schema, store }).root

    assert.notEqual(before, changed)
    assert.equal(before, after)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('내용이 그대로면 스냅샷을 쌓지 않는다', () => {
  const { root, store } = fixture(THREE)
  try {
    const first = indexWorkspace({ root, schema, store })
    const second = indexWorkspace({ root, schema, store })
    assert.equal(second.snapshot, first.snapshot)
    assert.equal([...second.store.history()].length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('내용이 바뀌면 스냅샷이 쌓이고 부모로 이어진다', () => {
  const { root, store } = fixture(THREE)
  try {
    const first = indexWorkspace({ root, schema, store })
    writeFileSync(join(root, 'principle', '나.md'), document('나', '달라졌다.'), 'utf8')
    const second = indexWorkspace({ root, schema, store })

    assert.notEqual(second.snapshot, first.snapshot)
    assert.equal(second.parent, first.snapshot)
    assert.deepEqual(
      [...second.store.history()].map((item) => item.id),
      [second.snapshot, first.snapshot],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('규약이 바뀌면 캐시가 전부 무효가 된다', () => {
  const { root, store } = fixture(THREE)
  try {
    indexWorkspace({ root, schema, store })
    const other = loadPreset('preset/convention')
    const { stats } = indexWorkspace({ root, schema: other, store })
    assert.equal(stats.cached, 0)
    assert.equal(stats.parsed, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('같은 진술이 두 문서에 있으면 저장소에 한 번만 담긴다', () => {
  const { root, store } = fixture({ 가: '똑같은 진술이다.', 나: '똑같은 진술이다.' })
  try {
    const { store: objects } = indexWorkspace({ root, schema, store })
    // 두 문서의 본문 blob 이 공유되므로 중복으로 건너뛴 객체가 있어야 한다
    assert.ok(objects.stats.reused > 0, '같은 내용 blob 이 공유되지 않았다')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('문서 트리는 필요할 때만 파싱된다', () => {
  const { root, store } = fixture(THREE)
  try {
    indexWorkspace({ root, schema, store })
    const { workspace } = indexWorkspace({ root, schema, store })

    // 식별자는 파싱 없이 얻는다
    assert.deepEqual([...workspace.documentIds].sort(), [
      'principle/가',
      'principle/나',
      'principle/다',
    ])
    // 트리를 달라고 하면 그때 파싱한다
    const document = workspace.document('principle/나')
    assert.ok(document !== null)
    assert.equal(document.id, 'principle/나')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('저장소를 지워도 결과는 같다 — 전부 파생물이다', () => {
  const { root, store } = fixture(THREE)
  try {
    const first = indexWorkspace({ root, schema, store })
    rmSync(store, { recursive: true, force: true })
    const second = indexWorkspace({ root, schema, store })

    assert.equal(second.root, first.root)
    assert.deepEqual(second.workspace.records, first.workspace.records)
    // 진단까지 같아야 한다 — 기록만 보면 저장소가 진단에 새는 것을 놓친다
    assert.deepEqual(second.workspace.diagnostics, first.workspace.diagnostics)
    assert.equal(second.stats.parsed, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('노드 디렉터리로 흩어진 문서도 증분으로 돈다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-inc-tree-'))
  const store = join(root, '.store')
  try {
    const base = join(root, 'principle', '흩어진-문서')
    mkdirSync(join(base, 'norm'), { recursive: true })
    mkdirSync(join(base, 'rationale'), { recursive: true })
    writeFileSync(
      join(base, 'node.md'),
      `---\ntype: principle\nid: 흩어진-문서\nsubject: []\nstatus: active\nchildren: [norm, rationale]\n---\n`,
      'utf8',
    )
    writeFileSync(join(base, 'norm', 'node.md'), '---\n---\n\n흩어진 규범이다.\n', 'utf8')
    writeFileSync(join(base, 'rationale', 'node.md'), '---\n---\n\n흩어진 근거다.\n', 'utf8')

    const first = indexWorkspace({ root, schema, store })
    assert.equal(first.stats.parsed, 1)
    // 세 노드 파일을 전부 센다
    assert.equal(first.stats.files.misses, 3)

    const second = indexWorkspace({ root, schema, store })
    assert.equal(second.stats.parsed, 0)
    assert.equal(second.stats.files.hits, 3)

    writeFileSync(join(base, 'rationale', 'node.md'), '---\n---\n\n근거를 고쳤다.\n', 'utf8')
    const third = indexWorkspace({ root, schema, store })
    assert.equal(third.stats.parsed, 1)
    assert.notEqual(third.root, first.root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('진단도 캐시를 타고 되살아난다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-inc-diag-'))
  const store = join(root, '.store')
  try {
    mkdirSync(join(root, 'principle'), { recursive: true })
    // 규약에 없는 섹션을 넣어 파싱 경고(PRS005)와 검증 오류(SCH001)를 함께 만든다
    writeFileSync(
      join(root, 'principle', '어긋난.md'),
      `${document('어긋난', '하나를 한다.')}\n## 뜬금없는-섹션\n\n규약에 없는 섹션이다.\n`,
      'utf8',
    )

    const first = indexWorkspace({ root, schema, store })
    const second = indexWorkspace({ root, schema, store })

    const codes = first.workspace.diagnostics.map((item) => item.code).sort()
    assert.deepEqual(codes, ['PRS005', 'SCH001'])
    assert.equal(second.stats.cached, 1)
    // 파싱 쪽 진단과 검증 쪽 진단이 둘 다 캐시에서 되살아나야 한다
    assert.deepEqual(second.workspace.diagnostics, first.workspace.diagnostics)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('캐시가 맞으면 파일 내용을 아예 열지 않는다', () => {
  const { root, store } = fixture(THREE)
  const path = join(root, 'principle', '가.md')
  try {
    indexWorkspace({ root, schema, store })
    // 읽을 수 없게 만든다. 내용을 열려고 하면 EACCES 로 터진다
    chmodSync(path, 0o000)
    const { stats } = indexWorkspace({ root, schema, store })
    assert.equal(stats.cached, 3)
    assert.equal(stats.files.hits, 3)
  } finally {
    chmodSync(path, 0o644)
    rmSync(root, { recursive: true, force: true })
  }
})
