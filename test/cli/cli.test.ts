/** CLI 와 렌더는 아래 층 위에 얹혀 있을 뿐이므로, 여기서는 이어 붙인 결과만 본다. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArgv, flag, flagList, hasFlag } from '../../src/cli/options.js'
import { loadSchemaFile } from '../../src/schema/index.js'
import { loadWorkspace } from '../../src/workspace/index.js'
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

/** rule-kit 자신의 판단기준으로 전 층을 이어 본다 (도그푸딩). */
function ownWorkspace() {
  return loadWorkspace({ root: 'rules', schema: loadSchemaFile('.rulekit/schema.yaml') })
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
  const files = renderSite(workspace, { title: 'rule-kit 판단기준' })
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
    { schema: loadSchemaFile('.rulekit/schema.yaml'), path: 'principle/x.md', collection: 'principle', name: 'x' },
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
    { schema: loadSchemaFile('.rulekit/schema.yaml'), path: 'principle/x.md', collection: 'principle', name: 'x' },
  ).document!
  assert.equal(blockHtml(document.sections[0]!.blocks[0]!), '')
})
