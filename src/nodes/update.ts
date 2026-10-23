/**
 * 고친 문서를 노드 파일들로 되쓸 계획을 세운다. 파일을 쓰고 지우는 것은 호출자가 한다.
 *
 * 뜻이 바뀐 노드 파일만 쓴다. 디스크와 비교하지 않고 **고치기 전 문서를 흩은 결과**와
 * 비교하므로, 작성자가 키 순서나 줄바꿈을 달리 적은 파일도 뜻이 같으면 손대지 않는다.
 * 블록 하나를 고친 일이 그 노드 파일 하나의 변경으로 남아야 다른 브랜치와 충돌하지 않는다.
 */

import { parse as parseYaml } from 'yaml'
import type { Document } from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { nodePath } from './layout.js'
import type { NodeFiles } from './reader.js'
import { type NodeFile, splitDocument } from './writer.js'

export interface NodeWritePlan {
  /** 새로 쓰거나 고쳐 쓸 파일. */
  readonly write: readonly NodeFile[]
  /** 지울 노드 파일의 경로. 비게 된 디렉터리를 치우는 것은 호출자의 일이다. */
  readonly remove: readonly string[]
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n/

function frontmatterOf(text: string): Record<string, unknown> | null {
  const match = FRONTMATTER.exec(text)
  if (match === null) return null
  try {
    const body: unknown = parseYaml(match[1]!)
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 노드 파일에 적힌 `order`. 없거나 읽을 수 없으면 null. */
export function orderIn(text: string): string | null {
  const order = frontmatterOf(text)?.['order']
  return order === undefined || order === null ? null : String(order)
}

/** 옛 `children` 인덱스가 남은 노드 파일인가. */
function hasLegacyIndex(text: string | null): boolean {
  return text !== null && frontmatterOf(text)?.['children'] !== undefined
}

export function planNodeWrites(
  before: Document,
  after: Document,
  schema: Schema,
  files: NodeFiles,
): NodeWritePlan {
  const previousOrder = (directory: string): string | null => {
    const text = files.read(nodePath(directory))
    return text === null ? null : orderIn(text)
  }
  const old = new Map(
    splitDocument(before, schema, { previousOrder }).map((file) => [file.path, file.content]),
  )
  const next = splitDocument(after, schema, { previousOrder })

  const written = new Set(next.map((file) => file.path))
  return {
    // 옛 인덱스가 남은 파일은 뜻이 같아도 쓴다. 두면 새로 더한 형제가 인덱스 밖에 남는다.
    write: next.filter(
      (file) => old.get(file.path) !== file.content || hasLegacyIndex(files.read(file.path)),
    ),
    remove: [...old.keys()].filter((path) => !written.has(path)),
  }
}
