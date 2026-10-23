/**
 * 병합에 강한 노드 트리 (R16). 서로 다른 노드를 고치는 작업은 서로 다른 파일만 건드려야 하고,
 * 텍스트로는 깨끗한데 뜻이 깨지는 병합은 검사가 잡아야 한다.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset, loadSchema } from '../../src/schema/index.js'
import {
  NODE_FILE,
  type NodeFile,
  type NodeFiles,
  assignOrder,
  between,
  compareSiblings,
  isOrderKey,
  nodeFilesAt,
  planNodeWrites,
  readNodeTree,
  splitDocument,
} from '../../src/nodes/index.js'
import { loadWorkspace } from '../../src/workspace/index.js'

const schema = loadPreset('preset/principle')
const NAME = '불변식'

function parse(text: string) {
  return parseDocument(text, {
    schema,
    path: `principle/${NAME}.md`,
    collection: 'principle',
    name: NAME,
  }).document!
}

/** 근거 아래에 규약이 선언하지 않은 하위 섹션을 주어진 순서로 둔 문서. */
function withCases(...cases: string[]): string {
  return `---
type: principle
id: ${NAME}
---

## 기준

<!-- dk: id=core -->
불변식은 생성자에서 검증한다.

## 근거

유효하지 않은 상태가 존재할 수 없다.

${cases.map((name) => `### ${name}\n\n${name} 의 설명.\n`).join('\n')}`
}

function memory(files: readonly NodeFile[]): NodeFiles {
  const map = new Map(files.map((file) => [file.path, file.content]))
  return {
    read: (path) => map.get(path) ?? null,
    directories: (directory) => {
      const prefix = directory === '' ? '' : `${directory}/`
      const found = new Set<string>()
      for (const path of map.keys()) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length).split('/')
        if (rest.length >= 2) found.add(rest[0]!)
      }
      return [...found].sort()
    },
  }
}

function assemble(files: NodeFiles) {
  return readNodeTree({ schema, collection: 'principle', name: NAME, files })
}

const caseKeys = (files: NodeFiles) =>
  assemble(files).document!.sections[1]!.sections.map((section) => section.heading)

// ── 분수 색인 ────────────────────────────────────────────────────────────

test('between 은 두 값 사이의 가장 짧은 열쇠를 낸다 (R16.3)', () => {
  assert.equal(between('', null), 'i')
  assert.equal(between('i', null), 'r')
  assert.equal(between('i', 'r'), 'n')
  assert.equal(between('i', 'j'), 'ii')
  assert.throws(() => between('r', 'i'), RangeError)
})

test('between 은 같은 자리에 거듭 끼워도 늘 사이에 있고 0 으로 끝나지 않는다', () => {
  for (const [low, high] of [['', 'i'], ['i', null]] as const) {
    let lo: string = low
    let hi: string | null = high
    for (let i = 0; i < 200; i += 1) {
      const key = between(lo, hi)
      assert.ok(lo < key && (hi === null || key < hi), `${lo} < ${key} < ${hi}`)
      assert.ok(isOrderKey(key), key)
      // 번갈아 아래·위를 좁힌다
      if (i % 2 === 0) hi = key
      else lo = key
    }
  }
})

test('형제는 규약 순번 → order → 이름 으로 정렬된다 (R16.2 · R16.4)', () => {
  const keys = [
    { rank: Infinity, order: '', name: 'b' },
    { rank: Infinity, order: 'i', name: 'a' },
    { rank: 1, order: 'z', name: 'z' },
    { rank: Infinity, order: 'i', name: 'c' },
    { rank: 0, order: '', name: 'y' },
  ]
  assert.deepEqual(
    [...keys].sort(compareSiblings).map((key) => key.name),
    ['y', 'z', 'b', 'a', 'c'],
  )
})

test('assignOrder — 이름 순이면 아무것도 적지 않고, 규약 순번이 거꾸로면 표현할 수 없다', () => {
  const none = () => null
  assert.deepEqual(assignOrder(['a', 'b'], () => Infinity, none), new Map())
  assert.equal(assignOrder(['b', 'a'], (name) => (name === 'a' ? 0 : 1), none), null)
  const fresh = assignOrder(['b', 'a'], () => Infinity, none)!
  assert.ok(fresh.get('b')! < fresh.get('a')!)
})

test('assignOrder — 앞서 적힌 값은 순서가 맞는 한 그대로 두고 새 형제만 값을 얻는다 (R16.3)', () => {
  const previous = new Map([['b', 'i'], ['a', 'r']])
  const assigned = assignOrder(['b', 'c', 'a'], () => Infinity, (name) => previous.get(name) ?? null)!
  assert.equal(assigned.get('b'), 'i')
  assert.equal(assigned.get('a'), 'r')
  assert.ok('i' < assigned.get('c')! && assigned.get('c')! < 'r')
})

// ── 흩고 읽기 ────────────────────────────────────────────────────────────

test('규약이 정하지 못하는 순서는 각 노드의 order 로 적고 그대로 읽힌다', () => {
  const files = splitDocument(parse(withCases('나중-경우', '가장-먼저')), schema)
  const nested = files.filter((file) => /rationale\/[^/]+\//.test(file.path))
  assert.equal(nested.length, 2)
  assert.ok(nested.every((file) => /^order: /m.test(file.content)))
  // 규약이 순서를 아는 노드에는 적지 않는다
  assert.ok(files.filter((file) => !nested.includes(file)).every((file) => !file.content.includes('order:')))
  assert.ok(files.every((file) => !file.content.includes('children:')))
  assert.deepEqual(caseKeys(memory(files)), ['나중-경우', '가장-먼저'])
})

test('규약 순서를 어긴 문서는 정보를 잃지 않도록 그 부모에만 옛 인덱스를 쓴다', () => {
  const text = `---\ntype: principle\nid: ${NAME}\n---\n\n## 근거\n\n설명.\n\n## 기준\n\n진술.\n`
  const files = splitDocument(parse(text), schema)
  assert.match(files[0]!.content, /children:\n {2}- rationale\n {2}- norm\n/)
  const result = assemble(memory(files))
  assert.deepEqual(result.document!.sections.map((section) => section.key), ['rationale', 'norm'])
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE007'))
})

test('order 형식이 틀리면 거절한다', () => {
  const files = [
    ...splitDocument(parse(withCases('가')), schema).map((file) =>
      file.path.includes('rationale/') ? { ...file, content: `---\norder: a0\n${file.content.slice(4)}` } : file,
    ),
  ]
  assert.ok(assemble(memory(files)).diagnostics.some((item) => item.message.includes('order')))
})

// ── 바뀐 노드만 쓴다 ──────────────────────────────────────────────────────

test('블록 하나를 고치면 그 노드 파일만 쓰인다 (R16.6)', () => {
  const before = parse(withCases('가'))
  const files = splitDocument(before, schema)
  const after = parse(withCases('가').replace('불변식은 생성자에서 검증한다.', '불변식은 생성자에서만 검증한다.'))
  const plan = planNodeWrites(before, after, schema, memory(files))
  assert.deepEqual(plan.write.map((file) => file.path), [`principle/${NAME}/norm/${NODE_FILE}`])
  assert.deepEqual(plan.remove, [])
})

test('섹션을 빼면 그 노드 파일을 지우고 부모는 고치지 않는다 (R16.6)', () => {
  const before = parse(withCases('가', '나'))
  const plan = planNodeWrites(before, parse(withCases('가')), schema, memory(splitDocument(before, schema)))
  assert.deepEqual(plan.write, [])
  assert.deepEqual(plan.remove, [`principle/${NAME}/rationale/나/${NODE_FILE}`])
})

test('사이에 끼우면 새 노드 파일 하나만 생긴다 — 형제의 order 는 그대로다 (R16.3)', () => {
  const before = parse(withCases('다', '가'))
  const files = splitDocument(before, schema)
  const plan = planNodeWrites(before, parse(withCases('다', '나', '가')), schema, memory(files))
  assert.deepEqual(plan.write.map((file) => file.path), [`principle/${NAME}/rationale/나/${NODE_FILE}`])

  const merged = memory([...files, ...plan.write])
  assert.deepEqual(caseKeys(merged), ['다', '나', '가'])
})

test('손으로 다르게 적은 파일도 뜻이 같으면 건드리지 않는다 (R16.6)', () => {
  const before = parse(withCases('가'))
  const files = splitDocument(before, schema).map((file) =>
    file.path === `principle/${NAME}/${NODE_FILE}`
      ? { ...file, content: `---\nid: ${NAME}\ntype: principle\n---\n` }
      : file,
  )
  const after = parse(withCases('가', '나'))
  const plan = planNodeWrites(before, after, schema, memory(files))
  assert.deepEqual(plan.write.map((file) => file.path), [`principle/${NAME}/rationale/나/${NODE_FILE}`])
})

test('옛 인덱스가 남은 부모는 뜻이 같아도 다시 써서 인덱스를 뺀다', () => {
  const before = parse(withCases('가'))
  const files = splitDocument(before, schema).map((file) =>
    file.path === `principle/${NAME}/rationale/${NODE_FILE}`
      ? { ...file, content: file.content.replace('---\n---', '---\nchildren: [가]\n---') }
      : file,
  )
  const plan = planNodeWrites(before, parse(withCases('가', '나')), schema, memory(files))
  const rationale = plan.write.find((file) => file.path === `principle/${NAME}/rationale/${NODE_FILE}`)
  assert.ok(rationale !== undefined && !rationale.content.includes('children:'))
})

// ── 실제 Git 병합 (R16.10) ───────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=dockit', '-c', 'user.email=dockit@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function writeFiles(root: string, files: readonly NodeFile[]): void {
  for (const file of files) {
    mkdirSync(dirname(join(root, file.path)), { recursive: true })
    writeFileSync(join(root, file.path), file.content)
  }
}

/** apply 가 하는 일 — 고치기 전과 뒤를 비교해 바뀐 노드 파일만 쓰고 지운다. */
function applyEdit(root: string, before: string, after: string): void {
  const plan = planNodeWrites(parse(before), parse(after), schema, nodeFilesAt(root))
  writeFiles(root, plan.write)
  for (const path of plan.remove) rmSync(join(root, path))
}

function withRepository(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dockit-merge-'))
  try {
    git(root, 'init', '-q', '-b', 'main')
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function commitAll(root: string, message: string): void {
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
}

test('같은 부모 아래에 노드를 하나씩 더한 두 브랜치는 충돌 없이 합쳐진다 (R16.10)', () => {
  withRepository((root) => {
    const base = withCases('가', '라')
    writeFiles(root, splitDocument(parse(base), schema))
    commitAll(root, 'base')

    git(root, 'checkout', '-q', '-b', 'a')
    applyEdit(root, base, withCases('가', '나', '라'))
    commitAll(root, 'a')

    git(root, 'checkout', '-q', 'main')
    git(root, 'checkout', '-q', '-b', 'b')
    applyEdit(root, base, withCases('가', '라', '마'))
    // 같은 브랜치에서 다른 노드의 블록도 고친다
    applyEdit(root, withCases('가', '라', '마'), withCases('가', '라', '마').replace('검증한다.', '검증하고 실패하면 만들지 않는다.'))
    commitAll(root, 'b')

    git(root, 'checkout', '-q', 'a')
    // 충돌이 나면 execFileSync 가 던진다
    git(root, 'merge', '-q', '--no-edit', 'b')

    const merged = assemble(nodeFilesAt(root))
    assert.deepEqual(merged.diagnostics, [])
    assert.deepEqual(caseKeys(nodeFilesAt(root)), ['가', '나', '라', '마'])
    assert.match(
      readFileSync(join(root, `principle/${NAME}/norm/${NODE_FILE}`), 'utf8'),
      /실패하면 만들지 않는다/,
    )
  })
})

test('같은 자리에 끼운 두 브랜치도 충돌 없이 합쳐지고 순서가 하나로 정해진다 (R16.4)', () => {
  withRepository((root) => {
    const base = withCases('다', '가')
    writeFiles(root, splitDocument(parse(base), schema))
    commitAll(root, 'base')

    git(root, 'checkout', '-q', '-b', 'a')
    applyEdit(root, base, withCases('다', '나', '가'))
    commitAll(root, 'a')

    git(root, 'checkout', '-q', 'main')
    applyEdit(root, base, withCases('다', '라', '가'))
    commitAll(root, 'main')

    git(root, 'merge', '-q', '--no-edit', 'a')
    // 두 노드가 같은 order 를 얻었고 이름이 가른다
    assert.deepEqual(caseKeys(nodeFilesAt(root)), ['다', '나', '라', '가'])
  })
})

test('텍스트로는 깨끗하게 합쳐져도 뜻이 깨지면 check 가 잡는다 (R16.10)', () => {
  withRepository((root) => {
    const rules = loadSchema({ version: 1, extends: 'preset/principle' })
    const base = withCases('가')
    writeFiles(root, splitDocument(parse(base), schema))
    commitAll(root, 'base')

    // 한쪽은 안정 식별자를 지운다
    git(root, 'checkout', '-q', '-b', 'a')
    applyEdit(root, base, base.replace('<!-- dk: id=core -->\n', ''))
    commitAll(root, 'a')

    // 다른 쪽은 그 식별자로 링크를 건다
    git(root, 'checkout', '-q', 'main')
    writeFileSync(
      join(root, 'principle/링크.md'),
      '---\ntype: principle\nid: 링크\nrefines: principle/불변식#core\n---\n\n## 기준\n\n진술.\n\n## 근거\n\n설명.\n',
    )
    commitAll(root, 'main')
    assert.ok(!loadWorkspace({ root, schema: rules }).diagnostics.some((item) => item.code === 'REF002'))

    git(root, 'merge', '-q', '--no-edit', 'a')
    assert.ok(loadWorkspace({ root, schema: rules }).diagnostics.some((item) => item.code === 'REF002'))
  })
})
