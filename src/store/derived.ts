/**
 * 파생 데이터 캐시. 원본에서 다시 만들 수 있는 것만 담는다 — 지워도 느려질 뿐 틀리지 않는다.
 *
 *   .dockit/derived/ab/cdef….z    zlib deflate 된 JSON
 *
 * 객체 저장소와 나눠 둔 이유는 수명이 다르기 때문이다. 객체는 문서의 내용이고,
 * 이쪽은 그 내용을 특정 규약으로 해석한 결과다 — 규약이 바뀌면 전부 무효가 된다.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { countOf, listDirectory } from './fs.js'
import { type ObjectId, contentHash, isObjectId } from './hash.js'

export interface DerivedStats {
  hits: number
  misses: number
}

export class DerivedCache {
  readonly stats: DerivedStats = { hits: 0, misses: 0 }

  constructor(private readonly directory: string) {}

  /** 열쇠는 원본 해시와 규약 해시를 함께 접어 만든다. */
  key(parts: readonly string[]): ObjectId {
    return contentHash(parts.join('\0'))
  }

  private pathOf(key: ObjectId): string {
    return join(this.directory, 'derived', key.slice(0, 2), `${key.slice(2)}.z`)
  }

  get<T>(key: ObjectId): T | null {
    const path = this.pathOf(key)
    if (!existsSync(path)) {
      this.stats.misses += 1
      return null
    }
    try {
      const value = JSON.parse(inflateSync(readFileSync(path)).toString('utf8')) as T
      this.stats.hits += 1
      return value
    } catch {
      this.stats.misses += 1
      return null
    }
  }

  /** 담긴 열쇠를 모두 돌려준다. 거두기가 쓸어낼 대상을 찾을 때 쓴다. */
  *keys(): Generator<ObjectId> {
    const root = join(this.directory, 'derived')
    for (const prefix of listDirectory(root).sort()) {
      if (prefix.length !== 2) continue
      for (const rest of listDirectory(join(root, prefix)).sort()) {
        if (!rest.endsWith('.z')) continue
        const key = `${prefix}${rest.slice(0, -2)}`
        if (isObjectId(key)) yield key
      }
    }
  }

  /** 담긴 열쇠 수. */
  count(): number {
    return countOf(this.keys())
  }

  /** 열쇠 하나를 버린다. 지워도 느려질 뿐 틀리지 않는다. */
  remove(key: ObjectId): boolean {
    try {
      rmSync(this.pathOf(key))
      return true
    } catch {
      return false
    }
  }

  put(key: ObjectId, value: unknown): void {
    const path = this.pathOf(key)
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, deflateSync(Buffer.from(JSON.stringify(value), 'utf8')))
    renameSync(temporary, path)
  }
}

