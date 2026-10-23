/**
 * 스냅샷 비교 (0004 · R15). 실제로 인덱싱한 저장소 위에서 본다 —
 * 짝짓기가 기대는 성질(위치를 해싱하지 않음, 항목 자리 = 자식 자리)은 encode 가 만든다.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAddress } from '../../src/model/index.js'
import { splitDocument } from '../../src/nodes/index.js'
import { loadPreset } from '../../src/schema/index.js'
import { ObjectStore, type Snapshot } from '../../src/store/index.js'
import {
  type Change,
  diffSnapshots,
  findSnapshot,
  indexWorkspace,
  lineDiff,
} from '../../src/workspace/index.js'

const schema = loadPreset('preset/principle')

function sample(options: { norm?: string; rationale?: string[]; tail?: string } = {}): string {
  const rationale = (options.rationale ?? ['근거 가.', '근거 나.', '근거 다.']).join('\n\n')
  return [
    '---\ntype: principle\nid: x\nsubject: [domain]\n---\n',
    '## 기준\n',
    `<!-- dk: id=core -->\n${options.norm ?? '불변식은 생성자에서 검증한다.'}\n`,
    '## 근거\n',
    `${rationale}\n`,
    options.tail ?? '',
  ].join('\n')
}

/** 임시 프로젝트. 문서를 쓰고 인덱싱할 때마다 스냅샷을 돌려준다. */
function project() {
  const base = mkdtempSync(join(tmpdir(), 'dockit-diff-'))
  const root = join(base, 'rules')
  const directory = join(base, 'store')
  mkdirSync(join(root, 'principle'), { recursive: true })
  return {
    root,
    directory,
    write(name: string, text: string) {
      writeFileSync(join(root, 'principle', `${name}.md`), text, 'utf8')
    },
    index(): { id: string; snapshot: Snapshot } {
      const result = indexWorkspace({ root, schema, store: directory })
      return { id: result.snapshot!, snapshot: result.store.snapshot(result.snapshot!)! }
    },
    /** 읽은 수를 0 부터 세는 새 저장소. */
    store: () => new ObjectStore(directory),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  }
}

/** 한 문서를 두 판본으로 인덱싱해 비교한다. */
function compare(before: string, after: string, options: { patch?: boolean } = {}): Change[] {
  const p = project()
  try {
    p.write('x', before)
    const a = p.index()
    p.write('x', after)
    const b = p.index()
    return diffSnapshots(p.store(), a.snapshot, b.snapshot, options)
  } finally {
    p.cleanup()
  }
}

const brief = (changes: readonly Change[]) =>
  changes.map((change) => [change.kind, change.address, ...(change.changed ?? [])].join(' '))

test('같은 스냅샷끼리는 비어 있고 아무것도 읽지 않는다', () => {
  const p = project()
  try {
    p.write('x', sample())
    const a = p.index()
    const store = p.store()
    assert.deepEqual(diffSnapshots(store, a.snapshot, a.snapshot), [])
    assert.equal(store.stats.read, 0)
  } finally {
    p.cleanup()
  }
})

test('R15.5 — 본문만 바꾸면 body, 형태가 바뀌어도 body', () => {
  assert.deepEqual(brief(compare(sample(), sample({ norm: '고친 진술.' }))), [
    'modified principle/x#norm/0 body',
  ])
  assert.deepEqual(brief(compare(sample(), sample({ rationale: ['근거 가.', '- 근거 나.', '근거 다.'] }))), [
    'modified principle/x#rationale/1 body',
  ])
})

test('R15.5 — 보조데이터나 안정 식별자만 바꾸면 aux', () => {
  const tagged = sample({ rationale: ['근거 가.', '<!-- dk: topic=[invariant] -->\n근거 나.', '근거 다.'] })
  assert.deepEqual(brief(compare(sample(), tagged)), ['modified principle/x#rationale/1 aux'])

  const renamed = sample().replace('id=core', 'id=main')
  assert.deepEqual(brief(compare(sample(), renamed)), ['modified principle/x#norm/0 aux'])
})

test('R15.5 — 섹션 제목만 바꾸면 heading 이고, 안의 블록은 따로 나온다', () => {
  const before = sample({ tail: '### Notes\n\n메모.\n' })
  const after = sample({ tail: '### NOTES\n\n고친 메모.\n' })
  assert.deepEqual(brief(compare(before, after)), [
    'modified principle/x#rationale/notes heading',
    'modified principle/x#rationale/notes/0 body',
  ])
})

test('R15.5 — 문서 보조데이터가 바뀌면 문서 주소에 aux', () => {
  const after = sample().replace('subject: [domain]', 'subject: [domain]\nstatus: deprecated')
  assert.deepEqual(brief(compare(sample(), after)), ['modified principle/x aux'])
})

test('R15.7 — 이름 없는 블록을 맨 앞에 끼우거나 빼도 그 하나만 나온다', () => {
  const inserted = sample({ rationale: ['끼운 문단.', '근거 가.', '근거 나.', '근거 다.'] })
  assert.deepEqual(brief(compare(sample(), inserted)), ['added principle/x#rationale/0'])
  assert.deepEqual(brief(compare(inserted, sample())), ['removed principle/x#rationale/0'])
})

test('R15.12 — 같은 섹션 안에서 순서를 바꾸면 옮김 하나다', () => {
  const after = sample({ rationale: ['근거 나.', '근거 다.', '근거 가.'] })
  const changes = compare(sample(), after)
  assert.deepEqual(brief(changes), ['moved principle/x#rationale/2'])
  assert.equal(changes[0]!.before, 'principle/x#rationale/0')
})

test('R15.12 — 다른 섹션으로 옮기면 사라짐과 생김이다', () => {
  const before = sample({ tail: '## 예시\n\n예.\n' })
  const after = sample({ rationale: ['근거 가.', '근거 다.'], tail: '## 예시\n\n예.\n\n근거 나.\n' })
  assert.deepEqual(brief(compare(before, after)), [
    'removed principle/x#rationale/1',
    'added principle/x#example/1',
  ])
})

test('R15.12 — 안정 식별자로 짝지은 블록이 옮기며 고쳐지면 옮김에 바뀐 것을 단다', () => {
  const before = sample({ rationale: ['<!-- dk: id=r1 -->\n근거 가.', '근거 나.'] })
  const after = sample({ rationale: ['근거 나.', '<!-- dk: id=r1 -->\n고친 근거 가.'] })
  const changes = compare(before, after)
  assert.deepEqual(brief(changes), ['moved principle/x#rationale/1 body'])
  assert.equal(changes[0]!.stableId, 'r1')
})

test('R15.13 — 기본은 blob 을 읽지 않고, --patch 면 줄 차이를 붙인다', () => {
  const p = project()
  try {
    p.write('x', sample())
    const a = p.index()
    p.write('x', sample({ norm: '고친 진술.' }))
    const b = p.index()

    const plain = p.store()
    const [change] = diffSnapshots(plain, a.snapshot, b.snapshot)
    assert.equal(change!.patch, undefined)

    const patched = p.store()
    const [withPatch] = diffSnapshots(patched, a.snapshot, b.snapshot, { patch: true })
    assert.equal(withPatch!.patch, '- 불변식은 생성자에서 검증한다.\n+ 고친 진술.')
    assert.equal(patched.stats.read, plain.stats.read + 2)
  } finally {
    p.cleanup()
  }
})

test('R15.6 — 블록 하나를 고친 비교가 읽는 객체 수는 문서 수와 무관하다', () => {
  const reads = (count: number): number => {
    const p = project()
    try {
      for (let index = 0; index < count; index += 1) {
        p.write(`d${index}`, sample().replace('id: x', `id: d${index}`))
      }
      const a = p.index()
      p.write('d0', sample({ norm: '고친 진술.' }).replace('id: x', 'id: d0'))
      const b = p.index()
      const store = p.store()
      assert.equal(diffSnapshots(store, a.snapshot, b.snapshot).length, 1)
      return store.stats.read
    } finally {
      p.cleanup()
    }
  }
  assert.equal(reads(1), reads(50))
})

test('R15.8 — 문서를 노드 디렉터리로 흩어도 비교가 비어 있다', () => {
  const p = project()
  try {
    p.write('x', sample({ tail: '### Notes\n\n메모.\n' }))
    const a = p.index()
    const workspace = indexWorkspace({ root: p.root, schema, store: p.directory }).workspace
    for (const file of splitDocument(workspace.document('principle/x')!, schema)) {
      mkdirSync(join(p.root, file.path, '..'), { recursive: true })
      writeFileSync(join(p.root, file.path), file.content, 'utf8')
    }
    rmSync(join(p.root, 'principle', 'x.md'))
    const b = p.index()
    assert.deepEqual(diffSnapshots(p.store(), a.snapshot, b.snapshot), [])
  } finally {
    p.cleanup()
  }
})

test('R15.3 — 낸 주소로 뒤 문서를 풀면 그 노드가 나오고, 기록의 주소와 같다', () => {
  const p = project()
  try {
    p.write('x', sample({ tail: '### Notes\n\n메모.\n' }))
    const a = p.index()
    p.write('x', sample({ tail: '### Notes\n\n고친 메모.\n' }))
    const result = indexWorkspace({ root: p.root, schema, store: p.directory })
    const [change] = diffSnapshots(p.store(), a.snapshot, result.store.snapshot(result.snapshot!)!)

    const address = parseAddress(change!.address)!
    const visit = result.workspace.document(address.document)!.resolve(address.fragment!)
    assert.equal(visit?.node.kind === 'block' ? visit.node.text : null, '고친 메모.')
    assert.ok(result.workspace.records.some((record) => record.address === change!.address))
  } finally {
    p.cleanup()
  }
})

test('R15.9 — 비교는 저장소에 아무것도 쓰지 않는다', () => {
  const p = project()
  try {
    p.write('x', sample())
    const a = p.index()
    p.write('x', sample({ norm: '고친 진술.' }))
    const b = p.index()

    const listing = (): string[] => {
      const out: string[] = []
      const walk = (directory: string): void => {
        for (const name of readdirSync(directory)) {
          const path = join(directory, name)
          const stat = statSync(path)
          if (stat.isDirectory()) walk(path)
          else out.push(`${path} ${stat.mtimeMs} ${stat.size}`)
        }
      }
      walk(p.directory)
      return out.sort()
    }
    const before = listing()
    // 작업 트리가 없어도 된다
    rmSync(p.root, { recursive: true, force: true })
    diffSnapshots(p.store(), a.snapshot, b.snapshot, { patch: true })
    assert.deepEqual(listing(), before)
  } finally {
    p.cleanup()
  }
})

test('R15.2 — 앞부분으로 찾고, 스냅샷이 아닌 객체는 거절하고, 겹치면 후보를 늘어놓는다', () => {
  const p = project()
  try {
    p.write('x', sample())
    const a = p.index()
    const store = p.store()

    const found = findSnapshot(store, a.id.slice(0, 12))
    assert.ok(found.ok && found.id === a.id)

    const tree = findSnapshot(store, a.snapshot.root.slice(0, 12))
    assert.ok(!tree.ok && /스냅샷이 아닙니다/.test(tree.error))

    // 앞 네 자가 겹치는 스냅샷 둘을 만든다
    const byPrefix = new Map<string, string>()
    let collision: string | null = null
    for (let n = 0; collision === null; n += 1) {
      const id = store.writeSnapshot({ parents: [], root: a.snapshot.root, meta: { n } })
      const prefix = id.slice(0, 4)
      if (byPrefix.has(prefix)) collision = prefix
      byPrefix.set(prefix, id)
    }
    const ambiguous = findSnapshot(store, collision)
    assert.ok(!ambiguous.ok && /여럿과 겹칩니다/.test(ambiguous.error))
  } finally {
    p.cleanup()
  }
})

test('R15.10 — 이력이 잘려 있을 때만 거둔 이력일 수 있다고 덧붙인다', () => {
  const p = project()
  try {
    p.write('x', sample())
    const a = p.index()
    p.write('x', sample({ norm: '고친 진술.' }))
    p.index()

    const missing = findSnapshot(p.store(), 'abcd1234')
    assert.ok(!missing.ok && !/거둔 이력/.test(missing.error))

    p.store().remove(a.id)
    const collected = findSnapshot(p.store(), a.id.slice(0, 12))
    assert.ok(!collected.ok && /거둔 이력일 수 있습니다/.test(collected.error))
  } finally {
    p.cleanup()
  }
})

test('줄 단위 차이는 같은 줄을 남기고 다른 줄만 가른다', () => {
  assert.deepEqual(
    lineDiff('가\n나\n다\n', '가\n라\n다\n').map((line) => `${line.op}${line.text}`),
    [' 가', '-나', '+라', ' 다'],
  )
  assert.deepEqual(lineDiff('', '새 줄').map((line) => line.op), ['+'])
})
