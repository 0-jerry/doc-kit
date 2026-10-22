/** 저장소 디렉터리를 걷는 작은 도구들. */

import { readdirSync } from 'node:fs'

/** 디렉터리 항목. 없거나 읽을 수 없으면 빈 목록이다 — 저장소는 비어 있어도 된다. */
export function listDirectory(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** 이터러블의 길이. 디렉터리를 걷는 생성기를 셀 때 쓴다. */
export function countOf(items: Iterable<unknown>): number {
  let total = 0
  for (const _ of items) total += 1
  return total
}
