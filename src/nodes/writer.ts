/**
 * 문서 하나를 노드 파일들로 흩는다 — 조립의 반대 과정이다.
 *
 * 각 노드는 자기 디렉터리의 `node.md` 로 나가고, 부모는 자식의 내용 대신
 * 이름만 인덱스로 들고 있게 된다.
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

export interface NodeFile {
  /** 저장소 루트 기준 경로. */
  readonly path: string
  readonly content: string
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
  schema: Schema,
  type: string,
  keyPath: readonly string[],
  path: string,
): string {
  const blocks = node.children.filter((child): child is Block => child instanceof Block)
  const index = node.children
    .filter((child): child is Section => child instanceof Section)
    .map((child) => child.key)
  if (index.length > 0) body['children'] = index

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

function splitNode(
  node: Section,
  schema: Schema,
  type: string,
  directory: string,
  keyPath: readonly string[],
  out: NodeFile[],
): void {
  const body: Record<string, unknown> = {}
  // 제목이 규약이 정한 것과 같으면 다시 적지 않는다 — 규약이 이미 아는 것이다.
  const declared = schema.sectionAt(type, keyPath)?.heading
  if (node.heading !== declared) body['title'] = node.heading
  if (node.stableId !== null) body['id'] = node.stableId

  out.push({
    path: nodePath(directory),
    content: renderNode(node, writeAuxTo(body, node.aux), schema, type, keyPath, nodePath(directory)),
  })

  for (const child of node.children) {
    if (!(child instanceof Section)) continue
    splitNode(child, schema, type, childDirectory(directory, child.key), [...keyPath, child.key], out)
  }
}

/** 문서를 노드 파일들로 흩는다. 파일 쓰기는 호출자가 한다. */
export function splitDocument(document: Document, schema: Schema): NodeFile[] {
  const parsed = parseDocumentId(document.id)
  const collection = parsed?.collection ?? ''
  const name = parsed?.name ?? ''
  const root = documentDirectory(collection, name)

  const body: Record<string, unknown> = { type: document.type }
  if (name !== '') body['id'] = name

  const out: NodeFile[] = [
    {
      path: nodePath(root),
      content: renderNode(document, writeAuxTo(body, document.aux), schema, document.type, [], nodePath(root)),
    },
  ]

  for (const child of document.children) {
    if (!(child instanceof Section)) continue
    splitNode(child, schema, document.type, childDirectory(root, child.key), [child.key], out)
  }
  return out
}
