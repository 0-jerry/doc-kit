/**
 * 객체의 바이너리 표현. 같은 내용이 반드시 같은 바이트가 되어야 하므로
 * 여기서 정하는 것은 전부 결정적이다 — 맵 순회 순서나 키 순서에 기대지 않는다.
 *
 * tree 의 항목 순서는 **주어진 순서를 지킨다**. Git 은 이름으로 정렬하지만
 * 여기서는 순서가 곧 문서 순서라서 정렬하면 뜻이 바뀐다.
 */

import { HASH_BYTES, type ObjectId, fromRaw, toRaw } from './hash.js'

/** tree 항목이 가리키는 것. */
export type EntryKind = 'blob' | 'tree'

const KIND_BLOB = 0x01
const KIND_TREE = 0x02

export interface TreeEntry {
  readonly kind: EntryKind
  /** 이름. 블록처럼 이름이 없는 항목은 빈 문자열이고, 자리로 구분된다. */
  readonly name: string
  /** 이 항목에만 붙는 메타데이터. 없으면 생략한다. */
  readonly meta?: unknown
  readonly id: ObjectId
}

export interface Tree {
  /** 노드 자신의 메타데이터. */
  readonly meta?: unknown
  readonly entries: readonly TreeEntry[]
}

export interface Snapshot {
  readonly parents: readonly ObjectId[]
  readonly root: ObjectId
  readonly meta?: unknown
}

/* ── LEB128 ──────────────────────────────────────────────────────────── */

export function writeVarint(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`varint 은 음이 아닌 정수여야 합니다: ${value}`)
  }
  const bytes: number[] = []
  let rest = value
  do {
    const byte = rest & 0x7f
    rest = Math.floor(rest / 128)
    bytes.push(rest > 0 ? byte | 0x80 : byte)
  } while (rest > 0)
  return Buffer.from(bytes)
}

/** `offset` 에서 varint 하나를 읽는다. 끊겼으면 RangeError. */
export function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 1
  for (let at = offset; ; at += 1) {
    const byte = bytes[at]
    if (byte === undefined) throw new RangeError('varint 이 끊겼습니다')
    value += (byte & 0x7f) * shift
    if ((byte & 0x80) === 0) return { value, next: at + 1 }
    shift *= 128
  }
}

class Cursor {
  private offset = 0
  constructor(private readonly bytes: Buffer) {}

  varint(): number {
    const { value, next } = readVarint(this.bytes, this.offset)
    this.offset = next
    return value
  }

  byte(): number {
    const byte = this.bytes[this.offset]
    if (byte === undefined) throw new RangeError('바이트가 모자랍니다')
    this.offset += 1
    return byte
  }

  take(length: number): Buffer {
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    if (slice.byteLength !== length) throw new RangeError('바이트가 모자랍니다')
    this.offset += length
    return slice
  }

  get done(): boolean {
    return this.offset >= this.bytes.byteLength
  }
}

/* ── 정규 JSON ───────────────────────────────────────────────────────── */

/**
 * 키를 재귀적으로 정렬한 JSON. 선언 순서가 달라도 같은 메타데이터면 같은 해시가
 * 되도록 하려면 이것이 필요하다. `undefined` 항목은 떨어뜨린다.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]))
}

function writeMeta(meta: unknown): Buffer {
  if (meta === undefined) return writeVarint(0)
  const json = Buffer.from(canonicalJson(meta), 'utf8')
  return Buffer.concat([writeVarint(json.byteLength), json])
}

function readMeta(cursor: Cursor): unknown {
  const length = cursor.varint()
  if (length === 0) return undefined
  return JSON.parse(cursor.take(length).toString('utf8'))
}

/* ── blob ────────────────────────────────────────────────────────────── */

export function encodeBlob(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

export function decodeBlob(payload: Uint8Array): string {
  return Buffer.from(payload).toString('utf8')
}

/* ── tree ────────────────────────────────────────────────────────────── */

export function encodeTree(tree: Tree): Buffer {
  const parts: Buffer[] = [writeMeta(tree.meta), writeVarint(tree.entries.length)]

  for (const entry of tree.entries) {
    const name = Buffer.from(entry.name, 'utf8')
    parts.push(
      Buffer.from([entry.kind === 'blob' ? KIND_BLOB : KIND_TREE]),
      writeVarint(name.byteLength),
      name,
      writeMeta(entry.meta),
      toRaw(entry.id),
    )
  }
  return Buffer.concat(parts)
}

export function decodeTree(payload: Uint8Array): Tree {
  const cursor = new Cursor(Buffer.from(payload))
  const meta = readMeta(cursor)
  const count = cursor.varint()
  const entries: TreeEntry[] = []

  for (let index = 0; index < count; index += 1) {
    const kindByte = cursor.byte()
    if (kindByte !== KIND_BLOB && kindByte !== KIND_TREE) {
      throw new RangeError(`알 수 없는 항목 종류입니다: ${kindByte}`)
    }
    const name = cursor.take(cursor.varint()).toString('utf8')
    const entryMeta = readMeta(cursor)
    entries.push({
      kind: kindByte === KIND_BLOB ? 'blob' : 'tree',
      name,
      ...(entryMeta === undefined ? {} : { meta: entryMeta }),
      id: fromRaw(cursor.take(HASH_BYTES)),
    })
  }
  return { ...(meta === undefined ? {} : { meta }), entries }
}

/* ── snapshot ────────────────────────────────────────────────────────── */

export function encodeSnapshot(snapshot: Snapshot): Buffer {
  return Buffer.concat([
    writeVarint(snapshot.parents.length),
    ...snapshot.parents.map(toRaw),
    toRaw(snapshot.root),
    writeMeta(snapshot.meta),
  ])
}

export function decodeSnapshot(payload: Uint8Array): Snapshot {
  const cursor = new Cursor(Buffer.from(payload))
  const count = cursor.varint()
  const parents: ObjectId[] = []
  for (let index = 0; index < count; index += 1) parents.push(fromRaw(cursor.take(HASH_BYTES)))

  const root = fromRaw(cursor.take(HASH_BYTES))
  const meta = readMeta(cursor)
  return { parents, root, ...(meta === undefined ? {} : { meta }) }
}
