/**
 * 객체 식별자. 내용을 해싱해 주소로 삼으므로, 같은 내용은 같은 주소를 갖는다.
 *
 * Git 과 같은 테두리(`<타입> <길이>\0<내용>`)를 쓰되 해시는 SHA-256 이다.
 * SHA-1 의 충돌 내력을 물려받을 이유가 없고, 저장소를 옮길 계획도 없다.
 */

import { createHash } from 'node:crypto'

/** 객체 종류. 저장소가 아는 것은 이 셋뿐이다. */
export type ObjectType = 'blob' | 'tree' | 'snapshot'

/** 64 자 소문자 16진수. */
export type ObjectId = string

export const HASH_BYTES = 32

/** 테두리를 두른 바이트. 길이를 함께 해싱하므로 내용 경계가 섞이지 않는다. */
export function frame(type: ObjectType, payload: Uint8Array): Uint8Array {
  const header = Buffer.from(`${type} ${payload.byteLength}\0`, 'utf8')
  return Buffer.concat([header, payload])
}

/** 테두리를 풀어 종류와 내용으로 나눈다. 형식이 아니면 null. */
export function unframe(framed: Uint8Array): { type: ObjectType; payload: Uint8Array } | null {
  const bytes = Buffer.from(framed)
  const end = bytes.indexOf(0)
  if (end < 0) return null

  const [type, size] = bytes.subarray(0, end).toString('utf8').split(' ')
  if (type !== 'blob' && type !== 'tree' && type !== 'snapshot') return null

  const payload = bytes.subarray(end + 1)
  if (size === undefined || Number(size) !== payload.byteLength) return null
  return { type, payload }
}

export function objectId(type: ObjectType, payload: Uint8Array): ObjectId {
  return createHash('sha256').update(frame(type, payload)).digest('hex')
}

/** 내용만 해싱한다. 작업 파일의 동일성 판정에 쓴다 — 객체 주소가 아니다. */
export function contentHash(bytes: Uint8Array | string): ObjectId {
  return createHash('sha256').update(bytes).digest('hex')
}

export function toRaw(id: ObjectId): Buffer {
  return Buffer.from(id, 'hex')
}

export function fromRaw(raw: Uint8Array): ObjectId {
  return Buffer.from(raw).toString('hex')
}

export function isObjectId(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}
