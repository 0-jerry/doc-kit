/**
 * 문서 트리를 마크다운으로 되돌린다.
 *
 * 손대지 않은 노드는 원문 조각을 그대로 내보낸다. 고쳤거나 새로 만든 노드만
 * 새로 쓴다. 그래서 읽고 바로 쓰면 원문과 바이트 단위로 같고, 한 블록을 고치면
 * 그 블록만 달라진다.
 */

import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { stringify as stringifyYaml } from 'yaml'
import {
  type Aux,
  Block,
  type Child,
  Document,
  type Origin,
  type Parent,
  Section,
  parseDocumentId,
} from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { type DirectiveEntry, formatDirective } from '../parse/directive.js'

export interface SerializeOptions {
  /**
   * 규약. 있으면 섹션이 정한 기본 역할은 디렉티브에 다시 쓰지 않는다 —
   * 읽는 시점에 해소된 역할이 쓰는 시점에 잡음으로 돌아오지 않게 한다.
   */
  readonly schema?: Schema
}

const LIFECYCLE_ORDER = ['status', 'since', 'until', 'level'] as const

/** 보조데이터를 디렉티브 조각들로 편다. */
function entriesOf(aux: Aux, stableId: string | null, skipRole: boolean): DirectiveEntry[] {
  const entries: DirectiveEntry[] = []
  if (stableId !== null) entries.push({ key: 'id', values: [stableId], isList: false })
  if (aux.role !== undefined && !skipRole) {
    entries.push({ key: 'role', values: [aux.role], isList: false })
  }
  if (aux.subject.length > 0) entries.push({ key: 'subject', values: [...aux.subject], isList: true })
  if (aux.topic.length > 0) entries.push({ key: 'topic', values: [...aux.topic], isList: true })
  for (const key of LIFECYCLE_ORDER) {
    const value = aux.lifecycle[key]
    if (value !== undefined) entries.push({ key, values: [value], isList: false })
  }
  for (const kind of [...new Set(aux.relations.map((relation) => relation.kind))]) {
    const targets = aux.relations
      .filter((relation) => relation.kind === kind)
      .map((relation) => relation.target)
    entries.push({ key: kind, values: targets, isList: targets.length > 1 })
  }
  return entries
}

function renderFrontmatter(document: Document): string {
  const parsed = parseDocumentId(document.id)
  const aux = document.aux
  const body: Record<string, unknown> = { type: document.type }
  if (parsed !== null) body['id'] = parsed.name
  if (aux.subject.length > 0) body['subject'] = [...aux.subject]
  if (aux.topic.length > 0) body['topic'] = [...aux.topic]
  for (const key of LIFECYCLE_ORDER) {
    const value = aux.lifecycle[key]
    if (value !== undefined) body[key] = value
  }
  for (const kind of [...new Set(aux.relations.map((relation) => relation.kind))]) {
    body[kind] = aux.relations
      .filter((relation) => relation.kind === kind)
      .map((relation) => relation.target)
  }
  return `---\n${stringifyYaml(body)}---\n\n`
}

function renderBody(node: Child): string {
  if (node instanceof Section) {
    return `${'#'.repeat(node.depth)} ${node.heading}\n\n`
  }
  const markdown = toMarkdown(
    { type: 'root', children: [node.source] },
    { extensions: [gfmToMarkdown()] },
  )
  return markdown.endsWith('\n\n') ? markdown : `${markdown.replace(/\n+$/, '')}\n\n`
}

function renderDirective(node: Child, skipRole: boolean): string {
  const line = formatDirective(entriesOf(node.aux, node.stableId, skipRole))
  return line === null ? '' : `${line}\n`
}

function isDefaultRole(
  node: Child,
  path: readonly string[],
  document: Document,
  schema: Schema | undefined,
): boolean {
  if (schema === undefined || node.aux.role === undefined) return false
  return schema.defaultRoleAt(document.type, path) === node.aux.role
}

/** 노드 하나가 내놓는 조각. 새로 쓴 조각에는 원문 범위가 없다. */
interface Chunk {
  readonly text: string
  readonly origin: Origin | null
}

function serializeChildren(
  parent: Parent,
  path: readonly string[],
  document: Document,
  options: SerializeOptions,
  out: Chunk[],
): void {
  for (const child of parent.children) {
    const childPath = child instanceof Section ? [...path, child.key] : path
    const skipRole = child instanceof Block && isDefaultRole(child, path, document, options.schema)
    const directive = child.directiveRaw ?? renderDirective(child, skipRole)
    out.push({
      text: directive + (child.raw ?? renderBody(child)),
      origin: child.raw === null ? null : child.origin,
    })
    if (child instanceof Section) {
      serializeChildren(child, childPath, document, options, out)
    }
  }
}

/**
 * 두 조각이 원문에서도 이웃이었는가.
 *
 * 이웃이었다면 앞 조각의 꼬리가 곧 작성자가 쓴 간격이므로 그대로 둔다.
 * 새로 쓴 조각이나 다른 데서 옮겨 온 조각에는 그 보장이 없다.
 */
function wereAdjacent(previous: Chunk, next: Chunk): boolean {
  if (previous.origin === null || next.origin === null) return false
  return previous.origin.end === next.origin.start
}

/**
 * 조각들을 잇는다.
 *
 * 원래 이웃이던 조각끼리는 원문의 간격을 그대로 둔다 — 그래야 왕복이 바이트 단위로 같다.
 * 그 밖의 경계에는 빈 줄을 보장한다. 빈 줄 없이 이으면 두 블록이 하나로 읽혀
 * 분리해 둔 책임과 거기 붙은 보조데이터가 사라지기 때문이다.
 */
function join(chunks: readonly Chunk[], sourceLength: number | null): string {
  let text = ''
  let previous: Chunk | null = null

  for (const chunk of chunks) {
    if (chunk.text === '') continue
    if (previous !== null && !wereAdjacent(previous, chunk) && !text.endsWith('\n\n')) {
      text += text.endsWith('\n') ? '\n' : '\n\n'
    }
    text += chunk.text
    previous = chunk
  }

  if (text === '') return text
  // 원래 마지막이던 조각으로 끝났으면 그 꼬리가 원문의 끝이다. 아니면 한 줄로 줄인다.
  const endsAsBefore =
    previous !== null && previous.origin !== null && previous.origin.end === sourceLength
  return endsAsBefore ? text : text.replace(/\n+$/, '\n')
}

/** 문서를 마크다운 문자열로 되돌린다. */
export function serializeDocument(document: Document, options: SerializeOptions = {}): string {
  const chunks: Chunk[] = [
    {
      text: document.raw ?? renderFrontmatter(document),
      origin: document.raw === null ? null : document.origin,
    },
  ]
  serializeChildren(document, [], document, options, chunks)
  return join(chunks, document.sourceLength)
}
