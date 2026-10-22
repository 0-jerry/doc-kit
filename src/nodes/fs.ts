/** 실제 파일 시스템 위의 노드 파일 접근. */

import { type Dirent, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { NodeFiles } from './reader.js'

export interface DirectoryEntry {
  readonly name: string
  readonly isDirectory: boolean
}

/**
 * 디렉터리 항목을 이름 순으로 읽는다. 점으로 시작하는 항목은 뺀다. 없거나 읽을 수 없으면 빈 목록.
 *
 * 항목의 종류는 `readdir` 가 함께 돌려주는 것을 쓴다 — 항목마다 `stat` 을 다시 부르지 않는다.
 * 심볼릭 링크만은 가리키는 곳을 따라가야 종류를 알 수 있으므로 `stat` 하고,
 * 가리키는 곳이 없는 링크는 없는 항목으로 본다.
 */
export function readEntries(path: string): DirectoryEntry[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => {
      if (!entry.isSymbolicLink()) return [{ name: entry.name, isDirectory: entry.isDirectory() }]
      const isDirectory = targetIsDirectory(join(path, entry.name))
      return isDirectory === null ? [] : [{ name: entry.name, isDirectory }]
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 링크가 가리키는 곳이 디렉터리인가. 가리키는 곳이 없으면 null. */
function targetIsDirectory(path: string): boolean | null {
  try {
    return statSync(path).isDirectory()
  } catch {
    return null
  }
}

export function nodeFilesAt(root: string): NodeFiles {
  return {
    read(path) {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch {
        return null
      }
    },
    directories(path) {
      return readEntries(join(root, path))
        .filter((entry) => entry.isDirectory)
        .map((entry) => entry.name)
    },
  }
}
