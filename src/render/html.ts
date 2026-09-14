/**
 * 모델에서 바로 HTML 을 만든다. 마크다운을 다시 읽지 않는다.
 * 렌더러는 모델을 읽기만 하고 고치지 않는다.
 */

import { toHtml } from 'hast-util-to-html'
import { toHast } from 'mdast-util-to-hast'
import type { Root } from 'mdast'
import { Block, type Child, Document, Section } from '../model/index.js'
import type { Schema } from '../schema/index.js'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 블록 하나를 서식을 살려 HTML 로 만든다.
 *
 * 원문에 적힌 HTML 은 그대로 내보내지 않는다. 다만 버리기만 하면 판단기준 한 줄이
 * 아무 흔적 없이 사라지므로, 지운 자리에 원문을 글자 그대로 보여 준다.
 */
export function blockHtml(block: Block): string {
  const root: Root = { type: 'root', children: [block.source] }
  const html = toHtml(toHast(root, { allowDangerousHtml: false }))
  if (html !== '') return html

  const source = block.source
  const value = source.type === 'html' ? source.value : block.text
  // 주석은 원래 보이지 않는 것이므로 그대로 비워 둔다.
  if (value.trim() === '' || /^<!--[\s\S]*-->$/.test(value.trim())) return ''
  return `<pre class="raw">${escapeHtml(value)}</pre>`
}

function auxHtml(node: Child | Document, inheritedRole: string | null): string {
  const { aux } = node
  const chips: string[] = []
  const add = (kind: string, label: string): void => {
    chips.push(`<span class="chip chip-${kind}">${escapeHtml(label)}</span>`)
  }

  if (aux.role !== undefined && aux.role !== inheritedRole) add('role', aux.role)
  for (const subject of aux.subject) add('subject', subject)
  for (const topic of aux.topic) add('topic', topic)
  const status = aux.lifecycle.status
  if (status !== undefined) add('status', status)
  const level = aux.lifecycle.level
  if (level !== undefined) add('level', level)
  for (const relation of aux.relations) {
    chips.push(
      `<a class="chip chip-relation" href="#${escapeHtml(relation.target)}">${escapeHtml(
        `${relation.kind} → ${relation.target}`,
      )}</a>`,
    )
  }
  return chips.length === 0 ? '' : `<div class="aux">${chips.join('')}</div>`
}

function childHtml(
  child: Child,
  document: Document,
  schema: Schema,
  keyPath: readonly string[],
): string {
  if (child instanceof Section) {
    const path = [...keyPath, child.key]
    const inner = child.children
      .map((grandchild) => childHtml(grandchild, document, schema, path))
      .join('\n')
    const anchor = child.stableId === null ? '' : ` id="${escapeHtml(child.stableId)}"`
    const level = Math.min(6, child.depth)
    return [
      `<section class="section"${anchor}>`,
      `<h${level}>${escapeHtml(child.heading)}</h${level}>`,
      auxHtml(child, null),
      inner,
      '</section>',
    ]
      .filter((line) => line !== '')
      .join('\n')
  }

  const defaultRole = schema.defaultRoleAt(document.type, keyPath)
  const anchor = child.stableId === null ? '' : ` id="${escapeHtml(child.stableId)}"`
  const role = child.aux.role === undefined ? '' : ` data-role="${escapeHtml(child.aux.role)}"`
  return [
    `<div class="block"${anchor}${role}>`,
    auxHtml(child, defaultRole),
    blockHtml(child),
    '</div>',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** 문서 하나의 본문 HTML. */
export function documentHtml(document: Document, schema: Schema): string {
  return [
    `<article class="document" data-type="${escapeHtml(document.type)}">`,
    `<h1>${escapeHtml(document.id.slice(document.id.indexOf('/') + 1))}</h1>`,
    auxHtml(document, null),
    ...document.children.map((child) => childHtml(child, document, schema, [])),
    '</article>',
  ].join('\n')
}
