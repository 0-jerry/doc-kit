/**
 * 느슨한 객체 저장소. 객체 하나가 파일 하나이고, 주소의 앞 두 자가 디렉터리다.
 *
 *   .dockit/objects/ab/cdef…      zlib deflate 된 `<타입> <길이>\0<내용>`
 *   .dockit/HEAD                  마지막 스냅샷의 주소
 *
 * 이미 있는 주소에는 다시 쓰지 않는다 — 같은 주소면 같은 내용이므로 쓸 필요가 없고,
 * 이것이 중복 저장을 막는 유일한 장치다.
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
import {
  type ObjectId,
  type ObjectType,
  frame,
  isObjectId,
  objectId,
  unframe,
} from './hash.js'
import {
  type Snapshot,
  type Tree,
  decodeBlob,
  decodeSnapshot,
  decodeTree,
  encodeBlob,
  encodeSnapshot,
  encodeTree,
} from './wire.js'

export interface StoreStats {
  /** 이번 세션에 새로 쓴 객체 수. */
  written: number
  /** 이미 있어서 쓰지 않은 객체 수. 공유된 만큼이다. */
  reused: number
  /** 디스크에서 연 객체 수. 비교가 바뀐 곳만 읽는지 재는 데 쓴다. */
  read: number
}

export interface ObjectStoreOptions {
  /**
   * 참이면 디스크에 아무것도 쓰지 않는다. 새 객체와 HEAD 는 메모리에만 담겨
   * 이 인스턴스 안에서만 읽힌다 — 거두기의 `--dry-run` 이 계획을 세울 때 쓴다.
   */
  readonly dryRun?: boolean
}

export class ObjectStore {
  readonly directory: string
  readonly stats: StoreStats = { written: 0, reused: 0, read: 0 }
  readonly dryRun: boolean
  private readonly pending = new Map<ObjectId, { type: ObjectType; payload: Uint8Array }>()
  private pendingHead: ObjectId | null = null

  constructor(directory: string, options: ObjectStoreOptions = {}) {
    this.directory = directory
    this.dryRun = options.dryRun === true
  }

  private pathOf(id: ObjectId): string {
    return join(this.directory, 'objects', id.slice(0, 2), id.slice(2))
  }

  has(id: ObjectId): boolean {
    return this.pending.has(id) || existsSync(this.pathOf(id))
  }

  /** 객체를 쓰고 주소를 돌려준다. 이미 있으면 쓰지 않는다. */
  write(type: ObjectType, payload: Uint8Array): ObjectId {
    const id = objectId(type, payload)
    const path = this.pathOf(id)
    if (this.has(id)) {
      this.stats.reused += 1
      return id
    }
    if (this.dryRun) {
      this.pending.set(id, { type, payload })
      this.stats.written += 1
      return id
    }

    mkdirSync(dirname(path), { recursive: true })
    // 같은 객체를 동시에 쓰더라도 반쯤 쓰인 파일이 남지 않도록 옮겨 담는다.
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, deflateSync(frame(type, payload)))
    renameSync(temporary, path)
    this.stats.written += 1
    return id
  }

  read(id: ObjectId): { type: ObjectType; payload: Uint8Array } | null {
    if (!isObjectId(id)) return null
    const pending = this.pending.get(id)
    if (pending !== undefined) return pending
    try {
      const bytes = readFileSync(this.pathOf(id))
      this.stats.read += 1
      return unframe(inflateSync(bytes))
    } catch {
      // 없거나 망가진 객체. 둘 다 "읽을 수 없다" 로 다룬다 — 끊긴 링크와 같다.
      return null
    }
  }

  /**
   * 주소의 앞부분으로 객체를 찾는다. 겹치는 주소를 모두 돌려준다 —
   * 하나면 그것이고, 여럿이면 부르는 쪽이 더 길게 달라고 해야 한다.
   */
  matching(prefix: string): ObjectId[] {
    const lowered = prefix.toLowerCase()
    if (!/^[0-9a-f]{4,64}$/.test(lowered)) return []
    if (lowered.length === 64) return this.has(lowered) ? [lowered] : []

    const directory = join(this.directory, 'objects', lowered.slice(0, 2))
    return listDirectory(directory)
      .filter((rest) => !rest.endsWith('.tmp'))
      .map((rest) => `${lowered.slice(0, 2)}${rest}`)
      .filter((id) => isObjectId(id) && id.startsWith(lowered))
      .sort()
  }

  writeBlob(text: string): ObjectId {
    return this.write('blob', encodeBlob(text))
  }

  writeTree(tree: Tree): ObjectId {
    return this.write('tree', encodeTree(tree))
  }

  writeSnapshot(snapshot: Snapshot): ObjectId {
    return this.write('snapshot', encodeSnapshot(snapshot))
  }

  blob(id: ObjectId): string | null {
    const object = this.read(id)
    return object?.type === 'blob' ? decodeBlob(object.payload) : null
  }

  tree(id: ObjectId): Tree | null {
    const object = this.read(id)
    return object?.type === 'tree' ? decodeTree(object.payload) : null
  }

  snapshot(id: ObjectId): Snapshot | null {
    const object = this.read(id)
    return object?.type === 'snapshot' ? decodeSnapshot(object.payload) : null
  }

  /* ── HEAD ──────────────────────────────────────────────────────────── */

  private get headPath(): string {
    return join(this.directory, 'HEAD')
  }

  head(): ObjectId | null {
    if (this.pendingHead !== null) return this.pendingHead
    try {
      const id = readFileSync(this.headPath, 'utf8').trim()
      return isObjectId(id) ? id : null
    } catch {
      return null
    }
  }

  setHead(id: ObjectId): void {
    if (this.dryRun) {
      this.pendingHead = id
      return
    }
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(this.headPath, `${id}\n`, 'utf8')
  }

  /** HEAD 에서 조상으로 거슬러 올라간다. 첫 부모만 따른다. */
  *history(from: ObjectId | null = this.head()): Generator<{ id: ObjectId; snapshot: Snapshot }> {
    let id = from
    const seen = new Set<ObjectId>()
    while (id !== null && !seen.has(id)) {
      seen.add(id)
      const snapshot = this.snapshot(id)
      if (snapshot === null) return
      yield { id, snapshot }
      id = snapshot.parents[0] ?? null
    }
  }

  /** 저장된 객체 수. 저장소 크기를 보고할 때만 쓴다. */
  count(): number {
    return countOf(this.ids())
  }

  /** 저장된 객체 주소를 모두 돌려준다. 거두기(`gc`)가 쓸어낼 대상을 찾을 때 쓴다. */
  *ids(): Generator<ObjectId> {
    const root = join(this.directory, 'objects')
    for (const prefix of listDirectory(root).sort()) {
      if (prefix.length !== 2) continue
      for (const rest of listDirectory(join(root, prefix)).sort()) {
        if (rest.endsWith('.tmp')) continue
        const id = `${prefix}${rest}`
        if (isObjectId(id)) yield id
      }
    }
  }

  /** 객체 하나를 지운다. 없으면 false. 거두기만 부른다. */
  remove(id: ObjectId): boolean {
    if (this.dryRun) return false
    try {
      rmSync(this.pathOf(id))
      return true
    } catch {
      return false
    }
  }
}
