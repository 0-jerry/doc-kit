/** 렌더 결과가 통째로 들고 다니는 정적 자산. 외부 CDN 에 의존하지 않는다. */

export const STYLESHEET = `:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --fg: #16181d;
  --fg-muted: #5b6270;
  --line: #dfe3e8;
  --accent: #2f6feb;
  --error: #c0392b;
  --warning: #b8860b;
  --info: #2f6feb;
  --right: #1e7f4f;
  --wrong: #c0392b;
  --radius: 8px;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --bg-soft: #1b1e24;
    --fg: #e6e8ec;
    --fg-muted: #a0a7b4;
    --line: #2b2f37;
    --accent: #6ea0ff;
    --error: #ff8a80;
    --warning: #e3b341;
    --info: #6ea0ff;
    --right: #6cc48f;
    --wrong: #ff8a80;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo",
    "Segoe UI", sans-serif;
}

.wrap { max-width: 62rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.breadcrumb { color: var(--fg-muted); font-size: 0.875rem; margin-bottom: 0.75rem; }
.breadcrumb a { color: inherit; }

h1 { font-size: 1.75rem; line-height: 1.35; margin: 0 0 0.5rem; }
h2 { font-size: 1.25rem; margin: 2.5rem 0 0.75rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }

.summary { color: var(--fg-muted); margin: 0 0 1rem; }

.badges { display: flex; flex-wrap: wrap; gap: 0.375rem; margin: 0 0 1.25rem; padding: 0; list-style: none; }
.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.75rem;
  color: var(--fg-muted);
  background: var(--bg-soft);
}
.badge--severity-error { color: var(--error); border-color: currentColor; }
.badge--severity-warning { color: var(--warning); border-color: currentColor; }
.badge--severity-info { color: var(--info); border-color: currentColor; }
.badge--status-deprecated, .badge--status-superseded { text-decoration: line-through; }

dl.meta { display: grid; grid-template-columns: minmax(6rem, 10rem) 1fr; gap: 0.35rem 1rem; margin: 0 0 1rem; font-size: 0.9rem; }
dl.meta dt { color: var(--fg-muted); }
dl.meta dd { margin: 0; }
dl.meta code, .mono { font-family: var(--mono); font-size: 0.85em; }

pre {
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  overflow-x: auto;
}
pre code { font-family: var(--mono); font-size: 0.85rem; line-height: 1.6; }
:not(pre) > code {
  font-family: var(--mono);
  font-size: 0.85em;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.05em 0.3em;
}

figure.example { margin: 1rem 0; }
figure.example figcaption { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem; font-size: 0.75rem; color: var(--fg-muted); }
.polarity { font-weight: 600; }
.polarity--right { color: var(--right); }
.polarity--wrong { color: var(--wrong); }
figure.example--right pre { border-left: 3px solid var(--right); }
figure.example--wrong pre { border-left: 3px solid var(--wrong); }

.relations { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
.relations .kind { display: inline-block; min-width: 7rem; color: var(--fg-muted); font-size: 0.8rem; }
.missing { color: var(--error); text-decoration: line-through; }

.toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 1.5rem 0 0.5rem; }
.toolbar input[type="search"], .toolbar select {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.35rem 0.5rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.toolbar input[type="search"] { flex: 1 1 16rem; }
.count { color: var(--fg-muted); font-size: 0.85rem; margin: 0 0 1.5rem; }

.stats { display: flex; flex-wrap: wrap; gap: 0.75rem; padding: 0; margin: 1rem 0 0; list-style: none; }
.stats li { flex: 1 1 8rem; border: 1px solid var(--line); border-radius: var(--radius); padding: 0.6rem 0.8rem; background: var(--bg-soft); }
.stats .n { display: block; font-size: 1.35rem; font-weight: 600; }
.stats .k { color: var(--fg-muted); font-size: 0.8rem; }

.group { margin-top: 2rem; }
.group > h2 { display: flex; justify-content: space-between; align-items: baseline; }
.group > h2 .n { color: var(--fg-muted); font-size: 0.8rem; font-weight: 400; }

ul.rules { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
.rule-card { border: 1px solid var(--line); border-radius: var(--radius); padding: 0.7rem 0.9rem; }
.rule-card .title { font-weight: 600; }
.rule-card .statement { color: var(--fg-muted); font-size: 0.9rem; margin: 0.2rem 0 0; }
.rule-card .badges { margin: 0.45rem 0 0; }
[hidden] { display: none !important; }

.empty { color: var(--fg-muted); padding: 2rem 0; }

.diagnostics { border: 1px solid var(--line); border-radius: var(--radius); padding: 0.5rem 1rem; background: var(--bg-soft); }
.diagnostics summary { cursor: pointer; font-weight: 600; }

footer.site { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--fg-muted); font-size: 0.8rem; }
`

export const SCRIPT = `(() => {
  const root = document.querySelector('[data-filterable]')
  if (!root) return

  const q = document.getElementById('filter-q')
  const selects = [...root.querySelectorAll('select[data-filter]')]
  const cards = [...root.querySelectorAll('.rule-card')]
  const groups = [...root.querySelectorAll('.group')]
  const count = document.getElementById('filter-count')
  const empty = document.getElementById('filter-empty')
  const total = cards.length

  function apply() {
    const needle = (q?.value ?? '').trim().toLowerCase()
    const wanted = selects
      .map((s) => [s.dataset.filter, s.value])
      .filter(([, value]) => value !== '')

    let shown = 0
    for (const card of cards) {
      const matchText = needle === '' || (card.dataset.search ?? '').includes(needle)
      const matchFacets = wanted.every(([key, value]) =>
        (card.dataset[key] ?? '').split(' ').includes(value),
      )
      const visible = matchText && matchFacets
      card.hidden = !visible
      if (visible) shown += 1
    }

    for (const group of groups) {
      group.hidden = !group.querySelector('.rule-card:not([hidden])')
    }
    if (count) count.textContent = shown === total
      ? \`규칙 \${total}개\`
      : \`규칙 \${shown}개 / 전체 \${total}개\`
    if (empty) empty.hidden = shown !== 0
  }

  q?.addEventListener('input', apply)
  for (const select of selects) select.addEventListener('change', apply)
  document.getElementById('filter-reset')?.addEventListener('click', () => {
    if (q) q.value = ''
    for (const select of selects) select.value = ''
    apply()
  })
  apply()
})()
`
