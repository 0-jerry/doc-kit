/**
 * 정적 규칙집을 만든다. 인덱스 산출물과 모델만 읽는다.
 */

import { documentHtml, escapeHtml } from './html.js'
import type { NodeRecord } from '../workspace/record.js'
import type { Workspace } from '../workspace/workspace.js'

const STYLE = `
:root { --ink:#1b1b1f; --dim:#6b6b76; --line:#e2e2e8; --bg:#fff; --accent:#2f5dd6; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8e8ec; --dim:#9a9aa6; --line:#33333c; --bg:#151519; --accent:#8fb0ff; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
.wrap { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 6rem; }
a { color: var(--accent); }
h1 { font-size: 1.6rem; margin: 0 0 1rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 1.5rem 0 .5rem; color: var(--dim); }
nav.top { display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:2rem; font-size:.875rem; }
.aux { display:flex; gap:.375rem; flex-wrap:wrap; margin:.5rem 0; }
.chip { font-size:.7rem; letter-spacing:.02em; padding:.1rem .45rem; border-radius:.75rem;
  border:1px solid var(--line); color:var(--dim); text-decoration:none; }
.chip-role { border-color: var(--accent); color: var(--accent); }
.block { margin: .5rem 0 1rem; }
.block[data-role="norm"] { border-left: 3px solid var(--accent); padding-left: .875rem; }
pre.raw { border-style: dashed; color: var(--dim); }
pre { overflow-x:auto; padding:.875rem; border:1px solid var(--line); border-radius:.375rem; }
code { font-size:.875em; }
table { border-collapse: collapse; width:100%; display:block; overflow-x:auto; }
th, td { border:1px solid var(--line); padding:.375rem .625rem; text-align:left; }
ul.list { list-style:none; padding:0; }
ul.list li { padding:.4rem 0; border-bottom:1px solid var(--line); }
.dim { color: var(--dim); font-size:.875rem; }
`

function page(title: string, body: string, depth: number): string {
  const up = depth === 0 ? '' : '../'.repeat(depth)
  return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
<div class="wrap">
<nav class="top"><a href="${up}index.html">전체</a><a href="${up}subject.html">대상별</a><a href="${up}topic.html">주제별</a></nav>
${body}
</div>
`
}

export interface RenderedFile {
  readonly path: string
  readonly content: string
}

function documentLink(id: string, depth: number): string {
  const up = depth === 0 ? '' : '../'.repeat(depth)
  return `${up}${id}.html`
}

function listOf(records: readonly NodeRecord[], depth: number): string {
  const norms = records.filter((record) => record.role === 'norm')
  return `<ul class="list">${norms
    .map(
      (record) =>
        `<li><a href="${documentLink(record.document, depth)}#${escapeHtml(
          record.stableId ?? '',
        )}">${escapeHtml(record.text)}</a><div class="dim">${escapeHtml(
          record.document,
        )}</div></li>`,
    )
    .join('')}</ul>`
}

function groupPage(
  title: string,
  index: ReadonlyMap<string, readonly string[]>,
  workspace: Workspace,
): string {
  const groups = [...index.keys()].sort()
  const body = groups
    .map((key) => {
      const records = (index.get(key) ?? [])
        .map((address) => workspace.record(address))
        .filter((record): record is NodeRecord => record !== null)
      const norms = listOf(records, 0)
      return norms.includes('<li>') ? `<h2>${escapeHtml(key)}</h2>${norms}` : ''
    })
    .filter((section) => section !== '')
    .join('\n')
  return page(title, `<h1>${escapeHtml(title)}</h1>${body || '<p class="dim">아직 없습니다.</p>'}`, 0)
}

/** 작업공간 전체를 정적 파일 목록으로 만든다. 파일 쓰기는 호출자가 한다. */
export function renderSite(workspace: Workspace, options: { title?: string } = {}): RenderedFile[] {
  const title = options.title ?? '판단기준'
  const files: RenderedFile[] = []

  for (const entry of workspace.entries) {
    const depth = entry.document.id.split('/').length - 1
    files.push({
      path: `${entry.document.id}.html`,
      content: page(entry.document.id, documentHtml(entry.document, workspace.schema), depth),
    })
  }

  const byCollection = [...workspace.byCollection.keys()].sort()
  const overview = byCollection
    .map((collection) => {
      const documents = workspace.entries
        .filter((entry) => entry.document.id.startsWith(`${collection}/`))
        .map(
          (entry) =>
            `<li><a href="${documentLink(entry.document.id, 0)}">${escapeHtml(
              entry.document.id.slice(collection.length + 1),
            )}</a></li>`,
        )
        .join('')
      return `<h2>${escapeHtml(collection)}</h2><ul class="list">${documents}</ul>`
    })
    .join('\n')

  files.push({ path: 'index.html', content: page(title, `<h1>${escapeHtml(title)}</h1>${overview}`, 0) })
  files.push({ path: 'subject.html', content: groupPage('대상별', workspace.bySubject, workspace) })
  files.push({ path: 'topic.html', content: groupPage('주제별', workspace.byTopic, workspace) })
  return files
}
