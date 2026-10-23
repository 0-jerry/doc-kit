/**
 * 형제 노드의 순서. 부모가 목록을 들고 있지 않으므로 순서는 각 노드가 스스로 안다.
 *
 * 정렬 열쇠는 세 겹이다 — 규약이 선언한 순번, 자기 `order`, 디렉터리 이름.
 * 앞 열쇠가 같을 때만 다음 열쇠를 본다. 규약이 강제하는 순서는 파일에 적지 않으므로,
 * 내장 프리셋 문서에는 `order` 가 한 줄도 없다.
 *
 * `order` 는 분수 색인이다. 두 형제 사이에 끼울 때 다른 형제의 값을 바꾸지 않으므로,
 * 서로 다른 브랜치에서 노드를 끼워도 서로 다른 파일만 고친다.
 */

import type { Schema } from '../schema/index.js'

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** `order` 로 쓸 수 있는 값인가. `0` 으로 끝나면 바로 앞에 끼울 자리가 없다. */
export function isOrderKey(value: string): boolean {
  return /^[0-9a-z]+$/.test(value) && !value.endsWith('0')
}

/**
 * `low < key < high` 인 가장 짧은 열쇠. `low = ''` 는 맨 앞, `high = null` 은 맨 뒤다.
 * 두 값은 `isOrderKey` 를 만족하고 `low < high` 여야 한다.
 */
export function between(low: string, high: string | null): string {
  if (high !== null && !(low < high)) {
    throw new RangeError(`순서 열쇠의 범위가 비어 있습니다: ${low} .. ${high}`)
  }
  return midpoint(low, high)
}

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    let common = 0
    while ((low[common] ?? '0') === high[common]) common += 1
    if (common > 0) return high.slice(0, common) + midpoint(low.slice(common), high.slice(common))
  }
  const lowDigit = low === '' ? 0 : DIGITS.indexOf(low[0]!)
  const highDigit = high === null ? DIGITS.length : DIGITS.indexOf(high[0]!)
  if (highDigit - lowDigit > 1) return DIGITS[Math.round((lowDigit + highDigit) / 2)]!
  // 첫 자리 사이에 빈 자리가 없다. 아래 값의 첫 자리를 두고 한 자리 더 내려간다.
  if (high !== null && high.length > 1) return high.slice(0, 1)
  return DIGITS[lowDigit]! + midpoint(low.slice(1), null)
}

/** 정렬에 쓰이는 형제 하나의 열쇠. */
export interface SiblingKey {
  /** 규약이 선언한 순번. 선언되지 않았거나 순서가 자유로운 타입이면 Infinity. */
  readonly rank: number
  readonly order: string
  readonly name: string
}

export function compareSiblings(a: SiblingKey, b: SiblingKey): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  if (a.order !== b.order) return a.order < b.order ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * 키 경로의 자리에서 규약이 선언한 하위 섹션의 순번을 돌려주는 함수.
 * 순서가 `strict` 인 타입에서만 규약 순서가 열쇠가 된다 — 그 밖에서는 작성자가 정한다.
 */
export function rankerAt(
  schema: Schema,
  type: string,
  keyPath: readonly string[],
): (key: string) => number {
  if (schema.documentType(type)?.order !== 'strict') return () => Infinity
  const specs =
    keyPath.length === 0 ? schema.sectionsOf(type) : schema.sectionAt(type, keyPath)?.sections ?? []
  const rank = new Map(specs.map((spec, index) => [spec.key, index]))
  return (key) => rank.get(key) ?? Infinity
}

/**
 * 문서 순서대로 놓인 형제들에게 `order` 를 매긴다.
 *
 * - 규약 순번이 줄어드는 자리가 있으면 표현할 수 없으므로 null — 호출자가 옛 인덱스로 쓴다
 * - 순번이 같은 무리마다, 이름 순서가 문서 순서와 같고 앞서 적힌 값이 없으면 아무것도 적지 않는다
 * - 아니면 무리의 모두가 값을 갖는다. 앞서 적힌 값 중 증가하는 가장 긴 부분수열은 그대로 두고
 *   나머지만 이웃 사이에서 새로 만든다 — 하나를 끼우면 그 하나만 새 값을 얻는다
 *
 * 돌려주는 값은 형제 이름 → `order`. 적지 않을 형제는 빠진다.
 */
export function assignOrder(
  names: readonly string[],
  rank: (name: string) => number,
  previous: (name: string) => string | null,
): Map<string, string> | null {
  const ranks = names.map(rank)
  if (ranks.some((value, index) => index > 0 && value < ranks[index - 1]!)) return null

  const assigned = new Map<string, string>()
  let start = 0
  while (start < names.length) {
    let end = start
    while (end < names.length && ranks[end] === ranks[start]) end += 1
    const group = names.slice(start, end)
    for (const [name, key] of assignGroup(group, previous)) assigned.set(name, key)
    start = end
  }
  return assigned
}

function assignGroup(
  group: readonly string[],
  previous: (name: string) => string | null,
): Map<string, string> {
  const old = group.map((name) => {
    const value = previous(name)
    return value !== null && isOrderKey(value) ? value : null
  })
  const sortedByName = group.every((name, index) => index === 0 || group[index - 1]! < name)
  if (sortedByName && old.every((value) => value === null)) return new Map()

  const keep = longestIncreasing(old)
  const keys: (string | null)[] = old.map((value, index) => (keep.has(index) ? value : null))

  let index = 0
  while (index < keys.length) {
    if (keys[index] !== null) {
      index += 1
      continue
    }
    let next = index
    while (next < keys.length && keys[next] === null) next += 1
    let low = index === 0 ? '' : keys[index - 1]!
    const high = next === keys.length ? null : keys[next]!
    for (let gap = index; gap < next; gap += 1) {
      low = between(low, high)
      keys[gap] = low
    }
    index = next
  }
  return new Map(group.map((name, i) => [name, keys[i]!]))
}

/** 값이 있는 자리 중 엄격히 증가하는 가장 긴 부분수열의 자리들. */
function longestIncreasing(values: readonly (string | null)[]): Set<number> {
  const length: number[] = []
  const before: number[] = []
  let best = -1
  values.forEach((value, i) => {
    length[i] = 0
    before[i] = -1
    if (value === null) return
    length[i] = 1
    for (let j = 0; j < i; j += 1) {
      const other = values[j]
      if (other === null || other === undefined || !(other < value)) continue
      if (length[j]! + 1 > length[i]!) {
        length[i] = length[j]! + 1
        before[i] = j
      }
    }
    if (best === -1 || length[i]! > length[best]!) best = i
  })
  const kept = new Set<number>()
  for (let i = best; i !== -1; i = before[i]!) kept.add(i)
  return kept
}
