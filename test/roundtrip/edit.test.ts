/** 고친 노드만 새로 쓰이고 나머지는 원문 그대로 남는지 본다. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Block, aux, parseFragment } from '../../src/model/index.js'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset } from '../../src/schema/index.js'
import { serializeDocument } from '../../src/serialize/index.js'

const schema = loadPreset('preset/principle')

const TEXT = `---
type: principle
id: sample
---

## 기준

<!-- dk: id=core -->
원래 진술.

## 근거

건드리지 않는 근거 문단.

| 표도 | 그대로 |
| --- | --- |
| a | b |
`

function read() {
  const { document } = parseDocument(TEXT, {
    schema,
    path: 'principle/sample.md',
    collection: 'principle',
    name: 'sample',
  })
  return document!
}

function replaceBlock(fragment: string, next: Block) {
  const document = read()
  const visit = document.resolve(parseFragment(fragment)!)!
  const section = visit.ancestors[visit.ancestors.length - 1]!
  const children = section.children.map((child) => (child === visit.node ? next : child))
  const updated = section.kind === 'document' ? section.with({ children }) : section.with({ children })
  if (updated.kind === 'document') return updated
  return document.with({
    children: document.children.map((child) => (child === section ? updated : child)),
  })
}

test('본문을 고치면 그 블록만 달라진다', () => {
  const document = read()
  const visit = document.resolve(parseFragment('core')!)!
  const edited = (visit.node as Block).with({
    text: '고친 진술.',
    source: {
      type: 'paragraph',
      children: [{ type: 'text', value: '고친 진술.' }],
    },
  })
  const output = serializeDocument(replaceBlock('core', edited), { schema })

  assert.match(output, /<!-- dk: id=core -->\n고친 진술\./)
  assert.doesNotMatch(output, /원래 진술/)
  // 손대지 않은 부분은 원문 그대로
  assert.ok(output.includes('| 표도 | 그대로 |'))
  assert.ok(output.includes('건드리지 않는 근거 문단.'))
  assert.ok(output.startsWith('---\ntype: principle\nid: sample\n---\n\n## 기준\n'))
})

test('보조데이터만 고치면 본문은 원문 그대로다', () => {
  const document = read()
  const visit = document.resolve(parseFragment('core')!)!
  const edited = (visit.node as Block).with({
    aux: aux({ role: 'norm', subject: ['domain'], lifecycle: { level: 'must' } }),
  })
  const output = serializeDocument(replaceBlock('core', edited), { schema })

  // 역할이 섹션 기본값과 같으면 다시 쓰지 않는다
  assert.match(output, /<!-- dk: id=core subject=\[domain\] level=must -->\n원래 진술\./)
  assert.ok(output.includes('| 표도 | 그대로 |'))
})

test('규약을 주지 않으면 해소된 기본 역할도 그대로 적는다', () => {
  const document = read()
  const visit = document.resolve(parseFragment('core')!)!
  const edited = (visit.node as Block).with({ aux: aux({ role: 'norm' }) })
  const output = serializeDocument(replaceBlock('core', edited))
  assert.match(output, /<!-- dk: id=core role=norm -->/)
})

test('문서 타입을 바꾸면 frontmatter 를 다시 쓴다', () => {
  const output = serializeDocument(read().with({ type: 'convention' }), { schema })
  assert.match(output, /type: convention/)
  assert.doesNotMatch(output, /type: principle/)
  assert.ok(output.includes('원래 진술.'))
})
