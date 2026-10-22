/** CLI 와 렌더는 아래 층 위에 얹혀 있을 뿐이므로, 여기서는 이어 붙인 결과만 본다. */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseArgv, flag, flagList, hasFlag } from '../../src/cli/options.js'
import { loadSchemaFile } from '../../src/schema/index.js'
import { indexWorkspace, loadWorkspace } from '../../src/workspace/index.js'
import { blockHtml, renderSite } from '../../src/render/index.js'
import { parseDocument } from '../../src/parse/index.js'
import { contextFor, query } from '../../src/query/index.js'

test('인자 파서는 하위 명령과 --키 값을 가른다', () => {
  const parsed = parseArgv(['query', 'rules', '--role', 'norm', '--topic', 'a,b', '--json'])
  assert.equal(parsed.command, 'query')
  assert.deepEqual(parsed.positional, ['rules'])
  assert.equal(flag(parsed, 'role'), 'norm')
  assert.deepEqual(flagList(parsed, 'topic'), ['a', 'b'])
  assert.equal(hasFlag(parsed, 'json'), true)
  assert.equal(hasFlag(parsed, 'strict'), false)
})

test('같은 플래그를 거듭 주면 모두 모은다', () => {
  const parsed = parseArgv(['query', '--subject', 'model', '--subject', 'api'])
  assert.deepEqual(flagList(parsed, 'subject'), ['model', 'api'])
})

/** doc-kit 자신의 판단기준으로 전 층을 이어 본다 (도그푸딩). */
function ownWorkspace() {
  return loadWorkspace({ root: 'rules', schema: loadSchemaFile('.dockit/schema.yaml') })
}

test('자기 자신의 판단기준은 규약을 지킨다', () => {
  const workspace = ownWorkspace()
  assert.ok(workspace.documents.length >= 4)
  assert.deepEqual(
    workspace.diagnostics.map((item) => `${item.code} ${item.message}`),
    [],
  )
})

test('경로로 물으면 그 층에 걸린 판단기준만 나온다', () => {
  const workspace = ownWorkspace()
  const model = contextFor(workspace, 'src/model/block.ts')
  assert.deepEqual(model.subjects, ['model'])
  assert.ok(model.hits.length > 0)
  // parse 에만 걸린 규약은 model 파일에 나오지 않는다
  assert.ok(!model.hits.some((hit) => hit.document.startsWith('convention/')))

  const parse = contextFor(workspace, 'src/serialize/writer.ts')
  assert.ok(parse.hits.some((hit) => hit.document.startsWith('convention/')))
})

test('질의는 규범 진술만 돌려준다', () => {
  const hits = query(ownWorkspace(), { role: ['norm'] })
  assert.ok(hits.length >= 4)
  assert.ok(hits.every((hit) => hit.role === 'norm'))
  assert.ok(hits.every((hit) => hit.support.length > 0))
})

test('렌더는 문서마다 한 장과 색인 세 장을 낸다', () => {
  const workspace = ownWorkspace()
  const files = renderSite(workspace, { title: 'doc-kit 판단기준' })
  const paths = files.map((file) => file.path)
  assert.ok(paths.includes('index.html'))
  assert.ok(paths.includes('subject.html'))
  assert.ok(paths.includes('topic.html'))
  assert.equal(files.length, workspace.documents.length + 3)

  const page = files.find((file) => file.path.startsWith('principle/'))!
  assert.match(page.content, /<!doctype html>/)
  assert.match(page.content, /data-role="norm"/)
  assert.match(page.content, /chip-subject/)
})

test('렌더는 마크다운 서식을 살린다', () => {
  const files = renderSite(ownWorkspace())
  const page = files.find((file) => file.path.includes('층은-한-방향으로만'))!
  assert.match(page.content, /<pre><code class="language-ts">/)
})

test('원시 HTML 블록은 사라지지 않고 글자 그대로 보인다', () => {
  const document = parseDocument(
    '---\ntype: principle\nid: x\n---\n\n## 기준\n\n<div>규범 진술</div>\n\n## 근거\n\n설명.\n',
    { schema: loadSchemaFile('.dockit/schema.yaml'), path: 'principle/x.md', collection: 'principle', name: 'x' },
  ).document!
  const block = document.sections[0]!.blocks[0]!
  const html = blockHtml(block)
  assert.match(html, /<pre class="raw">/)
  assert.match(html, /&lt;div&gt;규범 진술&lt;\/div&gt;/)
  assert.doesNotMatch(html, /<div>/)
})

test('일반 주석은 그대로 비워 둔다', () => {
  const document = parseDocument(
    '---\ntype: principle\nid: x\n---\n\n## 기준\n\n<!-- 그냥 메모 -->\n\n## 근거\n\n설명.\n',
    { schema: loadSchemaFile('.dockit/schema.yaml'), path: 'principle/x.md', collection: 'principle', name: 'x' },
  ).document!
  assert.equal(blockHtml(document.sections[0]!.blocks[0]!), '')
})

/* ── 객체 저장소 ─────────────────────────────────────────────────────── */

test('증분 인덱싱은 자기 자신의 판단기준에서도 같은 결과를 낸다', () => {
  const store = mkdtempSync(join(tmpdir(), 'dockit-cli-store-'))
  try {
    const schema = loadSchemaFile('.dockit/schema.yaml')
    const plain = loadWorkspace({ root: 'rules', schema })
    const indexed = indexWorkspace({ root: 'rules', schema, store })

    assert.deepEqual(indexed.workspace.records, plain.records)
    assert.deepEqual(indexed.workspace.diagnostics, plain.diagnostics)
    assert.deepEqual([...indexed.workspace.documentIds].sort(), [...plain.documentIds].sort())

    // 두 번째는 전부 캐시를 탄다
    const again = indexWorkspace({ root: 'rules', schema, store })
    assert.equal(again.stats.parsed, 0)
    assert.equal(again.stats.cached, plain.entries.length)
    assert.deepEqual(again.workspace.records, plain.records)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})

test('store · log · cat 은 저장소를 걸어 내려간다', () => {
  const store = mkdtempSync(join(tmpdir(), 'dockit-cli-walk-'))
  try {
    const schema = loadSchemaFile('.dockit/schema.yaml')
    const result = indexWorkspace({ root: 'rules', schema, store })

    // 뿌리 → 컬렉션 → 문서 → 노드 → 블록 까지 끊기지 않고 닿는다
    const root = result.store.tree(result.root)!
    assert.ok(root.entries.length >= 2)

    const collection = result.store.tree(root.entries[0]!.id)!
    assert.ok(collection.entries.length >= 1)

    const document = result.store.tree(collection.entries[0]!.id)!
    const meta = document.meta as { id: string; type: string }
    assert.match(meta.id, /^[^/]+\//)
    assert.equal(typeof meta.type, 'string')

    const section = result.store.tree(document.entries[0]!.id)!
    const blob = section.entries.find((entry) => entry.kind === 'blob')!
    assert.ok(result.store.blob(blob.id)!.length > 0)

    // 이력에는 방금 쓴 스냅샷이 있다
    const history = [...result.store.history()]
    assert.equal(history[0]!.id, result.snapshot)
    assert.equal(history[0]!.snapshot.root, result.root)
  } finally {
    rmSync(store, { recursive: true, force: true })
  }
})
