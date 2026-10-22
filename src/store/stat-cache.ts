/**
 * 작업 파일의 stat 캐시. 경로마다 (수정시각, 크기, 내용해시) 를 들고 있다가
 * 수정시각과 크기가 그대로면 파일을 읽지 않고 해시를 돌려준다.
 *
 * 인덱싱 비용이 실제로 떨어지는 자리는 여기다 — 해싱을 아끼는 것이 아니라,
 * 바뀐 파일이 무엇인지 **읽기 전에** 알아내서 파싱과 검증을 건너뛰는 것이 목적이다.
 *
 *   .dockit/index    "RKIX" + 버전 + 개수 + 항목들 (리틀엔디언 고정폭 + LEB128 경로)
 *
 * **수정시각이 캐시 파일보다 늦지 않은 항목은 믿지 않는다.** 해싱한 바로 그 시각 단위
 * 안에서 같은 크기로 다시 고쳐진 파일은 stat 만으로 구별할 수 없다(Git 의 racy-git 과 같은 문제).
 * 수정시각이 거친 파일 시스템일수록 이 창이 넓다.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HASH_BYTES, type ObjectId, contentHash, fromRaw, toRaw } from './hash.js'
import { readVarint, writeVarint } from './wire.js'

const MAGIC = 'RKIX'
const VERSION = 1

interface Entry {
  readonly mtimeMs: number
  readonly size: number
  readonly hash: ObjectId
}

export interface StatCacheStats {
  /** 수정시각과 크기가 그대로여서 읽지 않은 파일 수. */
  hits: number
  /** 새로 읽어 해싱한 파일 수. */
  misses: number
}

export class StatCache {
  private readonly entries = new Map<string, Entry>()
  private readonly fresh = new Map<string, Entry>()
  /** 캐시 파일을 마지막으로 쓴 시각. 이보다 늦지 않게 고쳐진 항목은 의심한다. */
  private savedAtMs = -Infinity
  readonly stats: StatCacheStats = { hits: 0, misses: 0 }

  private constructor(
    private readonly root: string,
    private readonly path: string,
  ) {}

  static open(root: string, directory: string): StatCache {
    const cache = new StatCache(root, join(directory, 'index'))
    cache.load()
    return cache
  }

  private load(): void {
    if (!existsSync(this.path)) return
    let bytes: Buffer
    try {
      bytes = readFileSync(this.path)
      this.savedAtMs = statSync(this.path).mtimeMs
    } catch {
      return
    }
    if (bytes.subarray(0, 4).toString('utf8') !== MAGIC) return
    if (bytes.readUInt32LE(4) !== VERSION) return

    const count = bytes.readUInt32LE(8)
    let offset = 12
    for (let index = 0; index < count; index += 1) {
      if (offset + 8 + 4 + HASH_BYTES > bytes.byteLength) return
      const mtimeMs = bytes.readDoubleLE(offset)
      const size = bytes.readUInt32LE(offset + 8)
      const hash = fromRaw(bytes.subarray(offset + 12, offset + 12 + HASH_BYTES))
      offset += 12 + HASH_BYTES

      let varint: { value: number; next: number }
      try {
        varint = readVarint(bytes, offset)
      } catch {
        return
      }
      const length = varint.value
      offset = varint.next
      const path = bytes.subarray(offset, offset + length).toString('utf8')
      offset += length
      this.entries.set(path, { mtimeMs, size, hash })
    }
  }

  /**
   * 루트 기준 상대 경로의 내용 해시. 파일이 없으면 null.
   * 캐시가 맞으면 파일을 읽지 않는다.
   */
  hashOf(path: string): ObjectId | null {
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(join(this.root, path))
    } catch {
      return null
    }

    const cached = this.entries.get(path)
    if (
      cached !== undefined &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.mtimeMs < this.savedAtMs
    ) {
      this.stats.hits += 1
      this.fresh.set(path, cached)
      return cached.hash
    }

    let bytes: Buffer
    try {
      bytes = readFileSync(join(this.root, path))
    } catch {
      return null
    }
    const entry: Entry = { mtimeMs: stat.mtimeMs, size: stat.size, hash: contentHash(bytes) }
    this.stats.misses += 1
    this.fresh.set(path, entry)
    return entry.hash
  }

  /** 이번에 본 경로만 남겨 쓴다. 사라진 파일의 항목은 저절로 빠진다. */
  save(): void {
    const paths = [...this.fresh.keys()].sort()
    const parts: Buffer[] = []
    const header = Buffer.alloc(12)
    header.write(MAGIC, 0, 'utf8')
    header.writeUInt32LE(VERSION, 4)
    header.writeUInt32LE(paths.length, 8)
    parts.push(header)

    for (const path of paths) {
      const entry = this.fresh.get(path)!
      const fixed = Buffer.alloc(12 + HASH_BYTES)
      fixed.writeDoubleLE(entry.mtimeMs, 0)
      fixed.writeUInt32LE(entry.size, 8)
      toRaw(entry.hash).copy(fixed, 12)
      const name = Buffer.from(path, 'utf8')
      parts.push(fixed, writeVarint(name.byteLength), name)
    }

    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporary, Buffer.concat(parts))
    renameSync(temporary, this.path)
  }
}
