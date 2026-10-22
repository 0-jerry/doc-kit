/**
 * 거두기. 지키는 불변식은 하나다 —
 * **거두기는 진단도 기록도 바꿀 수 없다.** 이것이 깨지면 거두기는 안전하지 않다.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadPreset } from '../../src/schema/index.js'
import {
  DEFAULT_RETENTION,
  collectGarbage,
  indexWorkspace,
  loadStoreConfig,
  storeConfigText,
  storeDirectoryFor,
} from '../../src/workspace/index.js'

const schema = loadPreset('preset/principle')

function doc(id: string, n: number): string {
  return `---\ntype: principle\nid: ${id}\nsubject: []\nstatus: active\n---\n\n## 기준\n\n${id} 를 ${n} 번째 방식으로 한다.\n\n## 근거\n\n그렇게 두면 이후가 단순해진다. 판본 ${n}.\n`
}

/** 문서 몇 개를 두고 그중 하나를 여러 번 고쳐 이력을 쌓는다. */
function aged(documents: number, edits: number): { root: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), 'dockit-gc-'))
  const store = join(root, '.store')
  mkdirSync(join(root, 'principle'), { recursive: true })
  for (let i = 0; i < documents; i += 1) {
    writeFileSync(join(root, 'principle', `문서${i}.md`), doc(`문서${i}`, 0), 'utf8')
  }
  for (let n = 1; n <= edits; n += 1) {
    writeFileSync(join(root, 'principle', '문서0.md'), doc('문서0', n), 'utf8')
    indexWorkspace({ root, schema, store })
  }
  return { root, store }
}

test('거두면 작업 트리가 쓰는 만큼만 남는다', () => {
  const { root, store } = aged(5, 20)
  try {
    const before = indexWorkspace({ root, schema, store })
    const result = collectGarbage({ root, schema, store, retention: 'head' })

    // 빈 저장소에 같은 작업 트리를 담았을 때의 크기와 같아야 한다
    const fresh = mkdtempSync(join(tmpdir(), 'dockit-gc-fresh-'))
    try {
      const baseline = indexWorkspace({ root, schema, store: fresh })
      assert.equal(result.objects.kept, baseline.store.count())
      assert.ok(result.objects.removed > 0, '거둘 것이 없으면 이 테스트는 무의미하다')
      assert.ok(result.objects.before > result.objects.kept)
      assert.equal(before.root, baseline.root)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('거두기는 진단과 기록을 바꾸지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-gc-diag-'))
  const store = join(root, '.store')
  try {
    mkdirSync(join(root, 'principle'), { recursive: true })
    writeFileSync(join(root, 'principle', '성한.md'), doc('성한', 0), 'utf8')
    // 규약에 없는 섹션으로 진단을 만든다
    writeFileSync(
      join(root, 'principle', '어긋난.md'),
      `${doc('어긋난', 0)}\n## 뜬금없는-섹션\n\n규약에 없는 섹션이다.\n`,
      'utf8',
    )
    for (let n = 1; n <= 10; n += 1) {
      writeFileSync(join(root, 'principle', '성한.md'), doc('성한', n), 'utf8')
      indexWorkspace({ root, schema, store })
    }

    const before = indexWorkspace({ root, schema, store })
    assert.ok(before.workspace.diagnostics.length > 0, '진단이 없으면 이 테스트는 무의미하다')

    collectGarbage({ root, schema, store, retention: 'head' })
    const after = indexWorkspace({ root, schema, store })

    assert.deepEqual(after.workspace.diagnostics, before.workspace.diagnostics)
    assert.deepEqual(after.workspace.records, before.workspace.records)
    assert.equal(after.root, before.root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('거둔 뒤에도 작업 트리의 모든 객체를 읽을 수 있다', () => {
  const { root, store } = aged(4, 15)
  try {
    const result = collectGarbage({ root, schema, store, retention: 'head' })
    const after = indexWorkspace({ root, schema, store })

    // 뿌리에서 블록까지 끊긴 곳이 없어야 한다
    const walk = (id: string): number => {
      const tree = after.store.tree(id)
      if (tree === null) return 0
      let seen = 1
      for (const entry of tree.entries) {
        if (entry.kind === 'blob') {
          assert.ok(after.store.blob(entry.id) !== null, `blob 이 끊겼다: ${entry.id}`)
          seen += 1
        } else seen += walk(entry.id)
      }
      return seen
    }
    assert.ok(walk(after.root) > 1)
    assert.equal(result.objects.removed > 0, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('--dry-run 은 계획만 세우고 지우지 않는다', () => {
  const { root, store } = aged(4, 15)
  try {
    const plan = collectGarbage({ root, schema, store, retention: 'head', dryRun: true })
    assert.equal(plan.dryRun, true)
    assert.ok(plan.objects.removed > 0)

    // 실제로는 그대로여야 한다
    const still = indexWorkspace({ root, schema, store })
    assert.equal(still.store.count(), plan.objects.before)

    const done = collectGarbage({ root, schema, store, retention: 'head' })
    assert.equal(done.objects.removed, plan.objects.removed)
    assert.equal(done.derived.removed, plan.derived.removed)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/** 디렉터리 아래 모든 파일과 그 내용. 디스크가 그대로인지 비교할 때 쓴다. */
function listing(directory: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path] = readFileSync(path).toString('base64')
  }
  return out
}

test('--dry-run 은 디스크에 아무것도 쓰지 않는다 — HEAD 도 움직이지 않는다', () => {
  const { root, store } = aged(3, 8)
  try {
    // 마지막 인덱싱 뒤에 고쳐 둔다. 실제 거두기라면 새 스냅샷을 쓸 상황이다
    writeFileSync(join(root, 'principle', '문서1.md'), doc('문서1', 99), 'utf8')
    const before = listing(store)

    const plan = collectGarbage({ root, schema, store, retention: 'head', dryRun: true })
    assert.deepEqual(listing(store), before)

    const done = collectGarbage({ root, schema, store, retention: 'head' })
    assert.equal(done.objects.removed, plan.objects.removed)
    assert.equal(done.derived.removed, plan.derived.removed)
    // 뿌리 주소는 스냅샷 시각이 달라 같지 않다 — 개수만 같으면 된다
    assert.equal(done.roots.length, plan.roots.length)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('저장소를 주지 않으면 정책을 읽은 그 프로젝트의 저장소를 거둔다', () => {
  const outer = mkdtempSync(join(tmpdir(), 'dockit-base-'))
  try {
    const root = join(outer, 'rules')
    mkdirSync(join(root, 'principle'), { recursive: true })
    mkdirSync(join(outer, '.dockit'), { recursive: true })
    writeFileSync(join(outer, '.dockit', 'store.yaml'), storeConfigText('all'), 'utf8')
    writeFileSync(join(root, 'principle', '가.md'), doc('가', 0), 'utf8')

    assert.equal(storeDirectoryFor(root), join(outer, '.dockit', 'store'))
    indexWorkspace({ root, schema })
    assert.ok(existsSync(join(outer, '.dockit', 'store', 'HEAD')))

    // cwd(doc-kit 자신)의 저장소가 아니라 outer 의 것을, outer 의 정책으로 다룬다
    const result = collectGarbage({ root, schema })
    assert.equal(result.skipped, true)
    assert.ok(result.objects.before > 0)
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})

test('정책이 all 이면 거두지 않는다', () => {
  const { root, store } = aged(4, 15)
  try {
    const before = indexWorkspace({ root, schema, store }).store.count()
    const result = collectGarbage({ root, schema, store, retention: 'all' })

    assert.equal(result.skipped, true)
    assert.equal(result.objects.removed, 0)
    assert.equal(result.derived.removed, 0)
    assert.equal(indexWorkspace({ root, schema, store }).store.count(), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('거둔 뒤 이력은 HEAD 하나로 줄고 끊긴 부모에서 멈춘다', () => {
  const { root, store } = aged(3, 12)
  try {
    const before = indexWorkspace({ root, schema, store })
    assert.ok([...before.store.history()].length > 1)

    collectGarbage({ root, schema, store, retention: 'head' })
    const after = indexWorkspace({ root, schema, store })
    const history = [...after.store.history()]

    assert.equal(history.length, 1)
    // HEAD 의 부모 링크는 끊긴 채 남는다 — 고쳐 쓰면 HEAD 주소 자신이 바뀐다
    assert.ok(history[0]!.snapshot.parents.length > 0)
    assert.equal(after.store.snapshot(history[0]!.snapshot.parents[0]!), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('거두기를 거듭해도 더 줄지 않는다', () => {
  const { root, store } = aged(4, 15)
  try {
    const first = collectGarbage({ root, schema, store, retention: 'head' })
    const second = collectGarbage({ root, schema, store, retention: 'head' })

    assert.ok(first.objects.removed > 0)
    // 두 번째 인덱싱이 스냅샷을 쌓지 않으므로 거둘 것이 남지 않는다
    assert.equal(second.objects.removed, 0)
    assert.equal(second.derived.removed, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('빈 저장소를 거두어도 터지지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-gc-empty-'))
  try {
    mkdirSync(join(root, 'principle'), { recursive: true })
    const result = collectGarbage({ root, schema, store: join(root, '.store'), retention: 'head' })
    assert.equal(result.objects.removed, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ── 보존 정책 설정 ──────────────────────────────────────────────────── */

test('설정이 없으면 기본 정책이다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-cfg-'))
  try {
    const config = loadStoreConfig(root)
    assert.equal(config.retention, DEFAULT_RETENTION)
    assert.equal(config.retention, 'head')
    assert.match(config.origin, /기본값/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('정책은 cwd 를 타고 새지 않는다', () => {
  /*
   * 남의 루트를 인수로 주고 거두기를 돌릴 때 이쪽 정책이 따라가면,
   * 그 프로젝트가 고른 `all` 을 무시하고 이력을 지운다. 규약과 달리 cwd 를 보지 않는다.
   */
  const outer = mkdtempSync(join(tmpdir(), 'dockit-cwd-'))
  try {
    // 이 프로세스의 cwd 에는 .dockit/store.yaml 이 있다 (doc-kit 자신)
    assert.ok(existsSync(join(process.cwd(), '.dockit', 'store.yaml')))
    const root = join(outer, 'rules')
    mkdirSync(root, { recursive: true })
    assert.match(loadStoreConfig(root).origin, /기본값/)
  } finally {
    rmSync(outer, { recursive: true, force: true })
  }
})

test('설정 파일의 정책을 읽는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-cfg2-'))
  try {
    mkdirSync(join(root, '.dockit'), { recursive: true })
    for (const retention of ['head', 'all'] as const) {
      writeFileSync(join(root, '.dockit', 'store.yaml'), storeConfigText(retention), 'utf8')
      const config = loadStoreConfig(root)
      assert.equal(config.retention, retention)
      assert.match(config.origin, /store\.yaml$/)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('망가지거나 모르는 값이면 기본 정책으로 떨어진다', () => {
  const root = mkdtempSync(join(tmpdir(), 'dockit-cfg3-'))
  try {
    mkdirSync(join(root, '.dockit'), { recursive: true })
    for (const text of ['retention: 아무거나\n', ': : :\n', '', 'version: 1\n']) {
      writeFileSync(join(root, '.dockit', 'store.yaml'), text, 'utf8')
      assert.equal(loadStoreConfig(root).retention, DEFAULT_RETENTION)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
