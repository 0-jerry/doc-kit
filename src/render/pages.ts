import type { IndexedRule } from '../index-build.js'
import type { Rule } from '../types.js'
import { SCRIPT, STYLESHEET } from './assets.js'
import {
  INDEX_PAGE,
  RELATION_LABEL,
  SCRIPT_PATH,
  SEVERITY_LABEL,
  STATUS_LABEL,
  STYLE_PATH,
  categoryPath,
  href,
  rulePath,
  type SiteContext,
} from './context.js'
import { cx, el, escapeHtml, join, text, voidEl } from './html.js'
import { renderContent } from './markdown.js'

/** 모든 페이지가 공유하는 문서 뼈대. */
export function layout(
  ctx: SiteContext,
  self: string,
  pageTitle: string,
  body: string,
): string {
  const { options } = ctx
  const inline = options.inlineAssets === true
  const head = join(
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    text('title', {}, pageTitle),
    inline
      ? el('style', {}, STYLESHEET)
      : `<link rel="stylesheet" href="${escapeHtml(href(self, STYLE_PATH))}">`,
  )
  const foot = inline
    ? el('script', {}, SCRIPT)
    : `<script src="${escapeHtml(href(self, SCRIPT_PATH))}" defer></script>`

  return join(
    '<!doctype html>',
    `<html lang="${escapeHtml(options.lang)}">`,
    '<head>',
    head,
    '</head>',
    '<body>',
    el('div', { class: 'wrap' }, body, siteFooter(ctx)),
    foot,
    '</body>',
    '</html>',
    '',
  )
}

function siteFooter(ctx: SiteContext): string {
  return el(
    'footer',
    { class: 'site' },
    escapeHtml(
      `${ctx.options.title} · 규칙 ${ctx.index.counts.total}개 · ${ctx.options.generatedAt} 생성`,
    ),
  )
}

function badge(kind: string, value: string, label = value): string {
  return text('span', { class: cx('badge', `badge--${kind}-${value}`) }, label)
}

function badges(meta: Pick<IndexedRule, 'severity' | 'status' | 'category' | 'since'>): string {
  return el(
    'p',
    { class: 'badges' },
    badge('severity', meta.severity, SEVERITY_LABEL[meta.severity] ?? meta.severity),
    badge('status', meta.status, STATUS_LABEL[meta.status] ?? meta.status),
    badge('category', meta.category),
    meta.since ? text('span', { class: 'badge' }, meta.since) : '',
  )
}

const codeList = (values: string[]): string =>
  values.map((v) => text('code', {}, v)).join(', ')

function meta(ctx: SiteContext, self: string, rule: Rule): string {
  const { meta: m } = rule
  const rows: [string, string][] = [['id', text('code', {}, m.id)]]

  rows.push([
    '카테고리',
    el(
      'a',
      { href: href(self, categoryPath(m.category)) },
      escapeHtml(m.category),
    ),
  ])
  if (m.appliesTo.length > 0) rows.push(['적용 대상', codeList(m.appliesTo)])
  for (const [dimension, values] of Object.entries(m.scope)) {
    rows.push([escapeHtml(dimension), codeList(values)])
  }
  if (m.enforcedBy.length > 0) {
    rows.push([
      '자동 강제',
      codeList(m.enforcedBy.map((e) => (e.rule ? `${e.tool}:${e.rule}` : e.tool))),
    ])
  }
  if (m.tags.length > 0) rows.push(['태그', codeList(m.tags)])

  const source = ctx.options.sourceBase
    ? el(
        'a',
        { href: `${ctx.options.sourceBase.replace(/\/$/, '')}/${rule.path}` },
        text('code', {}, rule.path),
      )
    : text('code', {}, rule.path)
  rows.push(['원문', `${source} <span class="mono">${escapeHtml(rule.digest)}</span>`])

  return el(
    'dl',
    { class: 'meta' },
    ...rows.flatMap(([key, value]) => [
      `<dt>${key}</dt>`,
      el('dd', {}, value),
    ]),
  )
}

function ruleLink(ctx: SiteContext, self: string, id: string): string {
  const target = ctx.rules.get(id)
  if (!target) return text('span', { class: 'missing', title: '없는 규칙' }, id)
  return el(
    'a',
    { href: href(self, rulePath(target.meta)) },
    escapeHtml(target.meta.title),
  )
}

function relations(ctx: SiteContext, self: string, rule: Rule): string {
  const { meta: m } = rule
  const groups: [string, string[]][] = [
    [RELATION_LABEL.extends, m.extends],
    [RELATION_LABEL.related, m.related],
    [RELATION_LABEL.conflicts, m.conflicts],
    [RELATION_LABEL.supersedes, m.supersedes],
    [RELATION_LABEL.supersededBy, m.supersededBy ? [m.supersededBy] : []],
  ]
  const referrers = (ctx.backlinks.get(m.id) ?? []).map((e) => e.from)
  if (referrers.length > 0) groups.push(['참조됨', [...new Set(referrers)]])

  const items = groups
    .filter(([, ids]) => ids.length > 0)
    .map(([label, ids]) =>
      el(
        'li',
        {},
        text('span', { class: 'kind' }, label),
        ids.map((id) => ruleLink(ctx, self, id)).join(', '),
      ),
    )
  if (items.length === 0) return ''
  return join('<h2>관계</h2>', el('ul', { class: 'relations' }, ...items))
}

function sections(rule: Rule): string {
  return rule.sections
    .map((section) => {
      const body = renderContent(section.content)
      if (section.key === '') return body
      return join(
        `<h2 id="section-${escapeHtml(section.key)}">${escapeHtml(section.heading)}</h2>`,
        body,
      )
    })
    .filter((html) => html.trim() !== '')
    .join('\n')
}

/** 규칙 한 건의 상세 페이지. */
export function renderRulePage(ctx: SiteContext, rule: Rule): string {
  const self = rulePath(rule.meta)
  const body = join(
    el(
      'nav',
      { class: 'breadcrumb' },
      el('a', { href: href(self, INDEX_PAGE) }, escapeHtml(ctx.options.title)),
      ' / ',
      el(
        'a',
        { href: href(self, categoryPath(rule.meta.category)) },
        escapeHtml(rule.meta.category),
      ),
    ),
    text('h1', {}, rule.meta.title),
    badges(rule.meta),
    rule.meta.summary ? text('p', { class: 'summary' }, rule.meta.summary) : '',
    meta(ctx, self, rule),
    sections(rule),
    relations(ctx, self, rule),
  )
  return layout(ctx, self, `${rule.meta.title} · ${ctx.options.title}`, body)
}

function card(ctx: SiteContext, self: string, entry: IndexedRule): string {
  const haystack = [
    entry.id,
    entry.title,
    entry.summary ?? '',
    entry.statement,
    entry.category,
    ...entry.tags,
  ]
    .join(' ')
    .toLowerCase()

  return el(
    'li',
    {
      class: 'rule-card',
      'data-search': haystack,
      'data-category': entry.category,
      'data-severity': entry.severity,
      'data-status': entry.status,
      'data-tags': entry.tags.join(' '),
    },
    el(
      'p',
      { class: 'title' },
      el(
        'a',
        { href: href(self, rulePath(entry)) },
        escapeHtml(entry.title),
      ),
    ),
    text('p', { class: 'statement' }, entry.summary ?? entry.statement),
    badges(entry),
  )
}

function cardsByCategory(ctx: SiteContext, self: string): string {
  return Object.keys(ctx.index.byCategory)
    .sort()
    .map((category) => {
      const entries = ctx.index.rules.filter((r) => r.category === category)
      return el(
        'section',
        { class: 'group', 'data-category': category },
        el(
          'h2',
          {},
          el(
            'a',
            { href: href(self, categoryPath(category)) },
            escapeHtml(category),
          ),
          text('span', { class: 'n' }, `${entries.length}개`),
        ),
        el('ul', { class: 'rules' }, ...entries.map((e) => card(ctx, self, e))),
      )
    })
    .join('\n')
}

function option(value: string, label = value): string {
  return text('option', { value }, label)
}

function select(name: string, label: string, values: string[]): string {
  return el(
    'select',
    { 'data-filter': name, 'aria-label': label },
    option('', label),
    ...values.map((v) => option(v, labelFor(name, v))),
  )
}

function labelFor(name: string, value: string): string {
  if (name === 'severity') return SEVERITY_LABEL[value] ?? value
  if (name === 'status') return STATUS_LABEL[value] ?? value
  return value
}

function stats(ctx: SiteContext): string {
  const { counts } = ctx.index
  const cells: [string, number][] = [
    ['규칙', counts.total],
    ['카테고리', Object.keys(ctx.index.byCategory).length],
    ['태그', Object.keys(ctx.index.byTag).length],
    ...(['error', 'warning', 'info'] as const)
      .filter((s) => (counts.bySeverity[s] ?? 0) > 0)
      .map((s): [string, number] => [SEVERITY_LABEL[s]!, counts.bySeverity[s]!]),
  ]
  return el(
    'ul',
    { class: 'stats' },
    ...cells.map(([key, n]) =>
      el('li', {}, text('span', { class: 'n' }, String(n)), text('span', { class: 'k' }, key)),
    ),
  )
}

function diagnostics(ctx: SiteContext): string {
  const { graph } = ctx
  const rows = join(
    graph.orphans.length > 0
      ? el(
          'p',
          {},
          `고립 규칙 ${graph.orphans.length}개: `,
          codeList(graph.orphans),
        )
      : '',
    graph.dangling.length > 0
      ? el(
          'p',
          {},
          `끊긴 참조 ${graph.dangling.length}건: `,
          codeList(graph.dangling.map((e) => `${e.from} → ${e.to}`)),
        )
      : '',
    graph.cycles.length > 0
      ? el(
          'p',
          {},
          `extends 순환 ${graph.cycles.length}건: `,
          codeList(graph.cycles.map((c) => c.join(' → '))),
        )
      : '',
  )
  if (rows === '') return ''
  return el(
    'details',
    { class: 'diagnostics' },
    '<summary>그래프 진단</summary>',
    rows,
  )
}

/** 규칙 전체를 훑고 걸러 보는 첫 페이지. */
export function renderIndexPage(ctx: SiteContext): string {
  const self = INDEX_PAGE
  const severities = (['error', 'warning', 'info'] as const).filter(
    (s) => (ctx.index.counts.bySeverity[s] ?? 0) > 0,
  )
  const statuses = Object.keys(ctx.index.counts.byStatus).sort()

  const body = join(
    text('h1', {}, ctx.options.title),
    stats(ctx),
    el(
      'div',
      { 'data-filterable': true },
      el(
        'div',
        { class: 'toolbar' },
        voidEl('input', {
          id: 'filter-q',
          type: 'search',
          placeholder: '제목 · 요약 · 태그 검색',
          'aria-label': '규칙 검색',
        }),
        select('category', '카테고리', Object.keys(ctx.index.byCategory).sort()),
        select('severity', '심각도', [...severities]),
        select('status', '상태', statuses),
        select('tags', '태그', Object.keys(ctx.index.byTag).sort()),
        text('button', { type: 'button', id: 'filter-reset' }, '초기화'),
      ),
      text('p', { class: 'count', id: 'filter-count', role: 'status' }, ''),
      cardsByCategory(ctx, self),
      text('p', { class: 'empty', id: 'filter-empty', hidden: true }, '조건에 맞는 규칙이 없습니다.'),
    ),
    diagnostics(ctx),
  )
  return layout(ctx, self, ctx.options.title, body)
}

/** 카테고리 하나에 속한 규칙 목록. */
export function renderCategoryPage(ctx: SiteContext, category: string): string {
  const self = categoryPath(category)
  const entries = ctx.index.rules.filter((r) => r.category === category)
  const body = join(
    el(
      'nav',
      { class: 'breadcrumb' },
      el('a', { href: href(self, INDEX_PAGE) }, escapeHtml(ctx.options.title)),
    ),
    text('h1', {}, category),
    text('p', { class: 'count' }, `규칙 ${entries.length}개`),
    el('ul', { class: 'rules' }, ...entries.map((e) => card(ctx, self, e))),
  )
  return layout(ctx, self, `${category} · ${ctx.options.title}`, body)
}
