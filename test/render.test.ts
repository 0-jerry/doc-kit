import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectRules } from '../src/collect.js'
import { escapeHtml } from '../src/render/html.js'
import { renderContent, rewriteMarkdownLink } from '../src/render/markdown.js'
import { renderRuleDocument, renderSite } from '../src/render/site.js'
import { validateRuleSet } from '../src/validate.js'
import type { ParseResult, RuleSet } from '../src/types.js'
import { RULES_ROOT, parseAt } from './helpers.js'

const AT = '2026-01-01T00:00:00.000Z'

function setOf(...results: ParseResult[]): RuleSet {
  return {
    root: RULES_ROOT,
    rules: results.map((r) => r.rule!).filter(Boolean),
    files: results.map((r) => r.file),
  }
}

const sectionOf = (result: ParseResult, key: string) =>
  result.rule!.sections.find((s) => s.key === key)!

const find = (files: { path: string; content: string }[], path: string) =>
  files.find((f) => f.path === path)!

test('escapeHtml 은 태그와 따옴표를 막는다', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
})

test('규칙 파일을 가리키는 상대 링크만 .html 로 바꾼다', () => {
  assert.equal(rewriteMarkdownLink('../naming/bool-names.md'), '../naming/bool-names.html')
  assert.equal(rewriteMarkdownLink('./a.md#why'), './a.html#why')
  assert.equal(rewriteMarkdownLink('https://example.com/a.md'), 'https://example.com/a.md')
  assert.equal(rewriteMarkdownLink('#section-rule'), '#section-rule')
})

test('섹션 mdast 를 서식을 살려 렌더한다', () => {
  const result = parseAt(`---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
---

## Rule

**굵은** 진술과 [다른 규칙](../naming/bool-names.md).

- 첫째
- 둘째

## Why

이유.
`)
  const html = renderContent(sectionOf(result, 'rule').content)
  assert.match(html, /<strong>굵은<\/strong>/)
  assert.match(html, /<a href="\.\.\/naming\/bool-names\.html">/)
  assert.match(html, /<li>첫째<\/li>/)
})

test('코드 블록은 예시 극성을 마크업에 남긴다', () => {
  const result = parseAt(`---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
---

## Rule

진술.

## Why

이유.

## Examples

\`\`\`swift
// WRONG
var Ships = 0
\`\`\`
`)
  const html = renderContent(sectionOf(result, 'examples').content)
  assert.match(html, /class="example example--wrong"/)
  assert.match(html, /data-polarity="wrong"/)
  assert.match(html, /<code class="language-swift">/)
  assert.match(html, /지양/)
})

test('본문의 원시 HTML 은 렌더 결과에 들어가지 않는다', () => {
  const result = parseAt(`---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
---

## Rule

<script>alert(1)</script>

진술.

## Why

이유.
`)
  const html = renderContent(sectionOf(result, 'rule').content)
  assert.doesNotMatch(html, /<script>/)
})

test('사이트는 인덱스·카테고리·규칙 페이지와 자산을 낸다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const files = renderSite(set, { generatedAt: AT })
  const paths = files.map((f) => f.path)

  assert.ok(paths.includes('index.html'))
  assert.ok(paths.includes('assets/style.css'))
  assert.ok(paths.includes('assets/app.js'))
  for (const rule of set.rules) {
    assert.ok(
      paths.includes(`rules/${rule.meta.category}/${rule.meta.id}.html`),
      `${rule.meta.id} 페이지가 없습니다`,
    )
    assert.ok(paths.includes(`categories/${rule.meta.category}.html`))
  }
})

test('인덱스 페이지는 모든 규칙을 거를 수 있게 카드로 싣는다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const index = find(renderSite(set, { generatedAt: AT }), 'index.html').content

  assert.equal(index.match(/class="rule-card"/g)?.length, set.rules.length)
  assert.match(index, /data-filterable/)
  assert.match(index, /<option value="naming">/)
  assert.match(index, new RegExp(`href="rules/naming/use-camel-case\\.html"`))
  assert.match(index, new RegExp(AT))
})

test('규칙 페이지는 관계를 상대 경로 링크로 잇는다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const files = renderSite(set, { generatedAt: AT })
  const page = find(files, 'rules/naming/use-camel-case.html').content

  assert.match(page, /<h1>타입·프로토콜은/)
  assert.match(page, /href="\.\.\/\.\.\/categories\/naming\.html"/)
  assert.match(page, /<li><span class="kind">관련<\/span><a href="bool-names\.html">/)
  assert.match(page, /참조됨/)
  assert.match(page, /<link rel="stylesheet" href="\.\.\/\.\.\/assets\/style\.css">/)
})

test('없는 규칙을 가리키는 관계는 링크 대신 표시만 남긴다', () => {
  const result = parseAt(`---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
related: [ghost-rule]
---

## Rule

진술.

## Why

이유.
`)
  const html = renderRuleDocument(setOf(result), 'sample', { generatedAt: AT })
  assert.match(html, /<span class="missing" title="없는 규칙">ghost-rule<\/span>/)
})

test('제목의 특수문자는 이스케이프된다', () => {
  const result = parseAt(`---
id: sample
title: "<script> 는 쓰지 않는다"
category: naming
severity: warning
status: active
---

## Rule

진술.

## Why

이유.
`)
  const html = renderRuleDocument(setOf(result), 'sample', { generatedAt: AT })
  assert.match(html, /<h1>&lt;script&gt; 는 쓰지 않는다<\/h1>/)
  assert.doesNotMatch(html, /<h1><script>/)
})

test('--inline-assets 는 자산 파일 없이 문서 안에 넣는다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const files = renderSite(set, { generatedAt: AT, inlineAssets: true })

  assert.equal(files.filter((f) => f.path.startsWith('assets/')).length, 0)
  const index = find(files, 'index.html').content
  assert.match(index, /<style>/)
  assert.doesNotMatch(index, /<link rel="stylesheet"/)
})

test('sourceBase 를 주면 원문 링크가 붙는다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const files = renderSite(set, {
    generatedAt: AT,
    sourceBase: 'https://example.com/blob/main/rules/',
  })
  const page = find(files, 'rules/naming/use-camel-case.html').content
  assert.match(
    page,
    /href="https:\/\/example\.com\/blob\/main\/rules\/naming\/use-camel-case\.md"/,
  )
})

test('같은 입력은 같은 HTML 을 낸다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const a = renderSite(set, { generatedAt: AT })
  const b = renderSite(set, { generatedAt: AT })
  assert.deepEqual(a, b)
})

test('없는 규칙 id 로 단일 문서를 요청하면 실패한다', () => {
  const result = parseAt(VALID_MIN)
  assert.throws(() => renderRuleDocument(setOf(result), 'nope'), /규칙을 찾을 수 없습니다/)
})

const VALID_MIN = `---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
---

## Rule

진술.

## Why

이유.
`
