/** 실제 파일 시스템 위의 노드 파일 접근. */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { NodeFiles } from './reader.js'

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
      try {
        return readdirSync(join(root, path))
          .filter((entry) => !entry.startsWith('.'))
          .filter((entry) => statSync(join(root, path, entry)).isDirectory())
          .sort()
      } catch {
        return []
      }
    },
  }
}
