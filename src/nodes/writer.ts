/**
 * 문서 하나를 노드 파일들로 흩는다 — 조립의 반대 과정이다.
 *
 * 각 노드는 자기 디렉터리의 `node.md` 로 나간다. 부모는 자식의 이름조차 들고 있지 않고,
 * 형제 사이의 자리는 규약이 정하지 못하는 곳에서만 각자 `order` 로 적는다.
 */

import {
  Block,
  type Child,
  Document,
  EMPTY_AUX,
  Section,
  aux as makeAux,
  parseDocumentId,
} from '../model/index.js'
import type { Schema } from '../schema/index.js'
import {
  renderFrontmatterBlock,
  serializeDocument,
  writeAuxTo,
} from '../serialize/index.js'
import { childDirectory, documentDirectory, nodePath } from './layout.js'
import { assignOrder, rankerAt } from './order.js'

export interface NodeFile {
  /** 저장소 루트 기준 경로. */
  readonly path: string
  readonly content: string
}

export interface SplitOptions {
  /**
   * 그 노드 디렉터리에 앞서 적혀 있던 `order`. 순서가 맞는 한 그 값을 그대로 쓴다 —
   * 하나를 끼울 때 다른 형제의 파일이 바뀌지 않게 하려는 것이다. 처음 흩을 때는 없다.
   */
  readonly previousOrder?: (directory: string) => string | null
}

interface SplitContext {
  readonly schema: Schema
  readonly type: string
  readonly previousOrder: (directory: string) => string | null
  readonly out: NodeFile[]
}

/**
 * 부모 하나의 하위 노드들이 적을 것을 정한다.
 *
 * 규약 순서로 표현할 수 없는 순서면 (SCH003 이 이미 오류인 문서) 정보를 잃지 않도록
 * 부모에 옛 인덱스를 쓴다. 읽을 때 NODE007 이 함께 나므로 조용히 남지 않는다.
 */
function placementOf(
  sections: readonly Section[],
  directory: string,
  keyPath: readonly string[],
  context: SplitContext,
): { readonly index: readonly string[] | null; readonly order: ReadonlyMap<string, string> } {
  const names = sections.map((section) => section.key)
  const order = assignOrder(
    names,
    rankerAt(context.schema, context.type, keyPath),
    (name) => context.previousOrder(childDirectory(directory, name)),
  )
  return order === null ? { index: names, order: new Map() } : { index: null, order }
}

/**
 * 노드의 자리에서 규약이 정한 기본 역할은 적지 않는다.
 * 읽을 때 같은 자리에서 다시 얹히므로, 적어 두면 잡음이 될 뿐이다.
 */
function stripDefaultRole(
  children: readonly Child[],
  schema: Schema,
  type: string,
  keyPath: readonly string[],
): readonly Child[] {
  const fallback = schema.defaultRoleAt(type, keyPath)
  if (fallback === null) return children
  return children.map((child) => {
    if (!(child instanceof Block) || child.aux.role !== fallback) return child
    const { role: _role, ...rest } = child.aux
    return child.with({ aux: makeAux(rest) })
  })
}

/** 노드 하나의 파일 내용을 만든다. */
function renderNode(
  node: Document | Section,
  body: Record<string, unknown>,
  index: readonly string[] | null,
  schema: Schema,
  type: string,
  keyPath: readonly string[],
  path: string,
): string {
  const blocks = node.children.filter((child): child is Block => child instanceof Block)
  if (index !== null && index.length > 0) body['children'] = [...index]

  const frontmatter = renderFrontmatterBlock(body)
  const synthetic = new Document({
    id: 'node/node',
    type,
    path,
    raw: frontmatter,
    origin: { start: 0, end: frontmatter.length },
    // 여러 파일로 흩어지므로 원문 하나의 길이라는 것이 없다.
    sourceLength: null,
    aux: EMPTY_AUX,
    children: stripDefaultRole(blocks, schema, type, keyPath),
  })
  return serializeDocument(synthetic, { schema })
}

function sectionsOf(node: Document | Section): Section[] {
  return node.children.filter((child): child is Section => child instanceof Section)
}

function splitNode(
  node: Section,
  order: string | undefined,
  directory: string,
  keyPath: readonly string[],
  context: SplitContext,
): void {
  const { schema, type } = context
  const body: Record<string, unknown> = {}
  // 제목이 규약이 정한 것과 같으면 다시 적지 않는다 — 규약이 이미 아는 것이다.
  const declared = schema.sectionAt(type, keyPath)?.heading
  if (node.heading !== declared) body['title'] = node.heading
  if (node.stableId !== null) body['id'] = node.stableId
  if (order !== undefined) body['order'] = order

  const sections = sectionsOf(node)
  const placement = placementOf(sections, directory, keyPath, context)
  const path = nodePath(directory)
  context.out.push({
    path,
    content: renderNode(node, writeAuxTo(body, node.aux), placement.index, schema, type, keyPath, path),
  })

  for (const child of sections) {
    splitNode(
      child,
      placement.order.get(child.key),
      childDirectory(directory, child.key),
      [...keyPath, child.key],
      context,
    )
  }
}

/** 문서를 노드 파일들로 흩는다. 파일 쓰기는 호출자가 한다. */
export function splitDocument(
  document: Document,
  schema: Schema,
  options: SplitOptions = {},
): NodeFile[] {
  const parsed = parseDocumentId(document.id)
  const collection = parsed?.collection ?? ''
  const name = parsed?.name ?? ''
  const root = documentDirectory(collection, name)
  const context: SplitContext = {
    schema,
    type: document.type,
    previousOrder: options.previousOrder ?? (() => null),
    out: [],
  }

  const body: Record<string, unknown> = { type: document.type }
  if (name !== '') body['id'] = name

  const sections = sectionsOf(document)
  const placement = placementOf(sections, root, [], context)
  const path = nodePath(root)
  context.out.push({
    path,
    content: renderNode(document, writeAuxTo(body, document.aux), placement.index, schema, document.type, [], path),
  })

  for (const child of sections) {
    splitNode(child, placement.order.get(child.key), childDirectory(root, child.key), [child.key], context)
  }
  return context.out
}
