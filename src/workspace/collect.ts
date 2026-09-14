/** 디렉터리에서 문서를 모아 읽는다. 파싱도 검증도 하지 않고 파일만 찾는다. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface SourceFile {
  /** 루트 기준 상대 경로. */
  readonly path: string
  readonly collection: string
  readonly name: string
  readonly text: string
}

/**
 * `<root>/<collection>/<name>.md` 를 모은다.
 * 컬렉션 디렉터리 안의 더 깊은 계층은 컬렉션 이름에 `/` 로 이어 붙이지 않는다 —
 * 컬렉션은 한 겹이고, 더 깊은 구조는 문서 안의 트리가 맡는다.
 */
export function collectSources(root: string): SourceFile[] {
  const sources: SourceFile[] = []
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

    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith('.md')) continue
      const path = `${collection}/${file}`
      sources.push({
        path,
        collection,
        name: file.slice(0, -'.md'.length),
        text: readFileSync(join(root, path), 'utf8'),
      })
    }
  }
  return sources
}
