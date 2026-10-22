/** 디렉터리에서 문서를 모은다. 파싱도 검증도 하지 않고 파일만 찾는다 — 내용은 필요할 때 읽는다. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NODE_FILE } from '../nodes/index.js'

export interface SourceFile {
  readonly kind: 'file'
  /** 루트 기준 상대 경로. */
  readonly path: string
  readonly collection: string
  readonly name: string
  /** 처음 읽을 때 파일을 연다. 증분 인덱싱은 캐시가 맞으면 끝내 열지 않는다. */
  readonly text: string
}

/** 노드 디렉터리로 흩어진 문서. 내용은 조립기가 읽는다. */
export interface SourceTree {
  readonly kind: 'tree'
  readonly path: string
  readonly collection: string
  readonly name: string
}

export type DocumentSource = SourceFile | SourceTree

/**
 * 문서를 모은다. 두 저장 형태를 함께 받는다.
 *
 *   `<root>/<collection>/<name>.md`            한 파일에 담긴 문서
 *   `<root>/<collection>/<name>/node.md`       노드 디렉터리로 흩어진 문서
 *
 * 컬렉션은 한 겹이다. 더 깊은 구조는 문서 안의 노드 트리가 맡는다.
 */
export function collectSources(root: string): DocumentSource[] {
  const sources: DocumentSource[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return sources
  }

  for (const collection of entries.sort()) {
    if (collection.startsWith('.')) continue
    const directory = join(root, collection)
    if (!statSync(directory).isDirectory()) continue

    for (const entry of readdirSync(directory).sort()) {
      if (entry.startsWith('.')) continue
      const full = join(directory, entry)

      if (statSync(full).isDirectory()) {
        if (!existsSync(join(full, NODE_FILE))) continue
        sources.push({
          kind: 'tree',
          path: `${collection}/${entry}/${NODE_FILE}`,
          collection,
          name: entry,
        })
        continue
      }

      if (!entry.endsWith('.md')) continue
      const path = `${collection}/${entry}`
      let text: string | null = null
      sources.push({
        kind: 'file',
        path,
        collection,
        name: entry.slice(0, -'.md'.length),
        get text() {
          text ??= readFileSync(join(root, path), 'utf8')
          return text
        },
      })
    }
  }
  return sources
}
