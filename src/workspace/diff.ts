/**
 * 두 스냅샷의 비교 (0004). 저장소만 읽는다 — 작업 트리도 규약도 모른다.
 *
 * 위에서 아래로 내려가며 tree 주소가 같으면 열지 않는다. 내용 주소이므로 주소 하나가
 * 그 아래 모든 바이트를 대표하고, 비교 비용은 문서 수가 아니라 바뀐 곳에 비례한다.
 *
 * 문서·섹션 안에서는 항목을 세 단계로 짝짓는다 (0004 §3.2).
 *
 *   1. 이름으로   블록은 안정 식별자, 섹션은 양쪽에 하나씩뿐인 키
 *   2. 내용으로   종류·이름·meta·주소가 모두 같은 항목
 *   3. 자리로     1·2 의 제자리 짝 사이 같은 틈에서, 남은 블록끼리·같은 키 섹션끼리
 *
 * 1·2 의 짝 가운데 최장 증가 부분수열 밖에 있는 것이 옮김이다.
 */

import {
  type PathStep,
  formatAddress,
  indexStep,
  pathFragment,
  sectionStep,
} from '../model/index.js'
import {
  type ObjectId,
  type ObjectStore,
  type Snapshot,
  type TreeEntry,
  canonicalJson,
} from '../store/index.js'
import { blockMetaOf, documentMetaOf, sectionMetaOf } from './encode.js'
import { formatPatch, lineDiff } from './patch.js'

export type ChangeKind = 'added' | 'removed' | 'modified' | 'moved'

/** 바뀜·옮김에서 무엇이 바뀌었는가. */
export type ChangedPart = 'body' | 'aux' | 'heading' | 'type'

export interface Change {
  readonly kind: ChangeKind
  /** 생김·바뀜·옮김은 뒤의 주소, 사라짐은 앞의 주소. */
  readonly address: string
  /** 옮김, 그리고 주소가 달라진 바뀜에서 앞의 주소. */
  readonly before?: string
  readonly stableId?: string
  readonly changed?: readonly ChangedPart[]
  /** `patch` 옵션일 때, 본문이 바뀐 블록의 줄 단위 차이. */
  readonly patch?: string
}

export interface DiffOptions {
  /** 본문이 바뀐 블록에 줄 단위 차이를 붙인다. 이때만 blob 을 읽는다. */
  readonly patch?: boolean
}

/* ── 스냅샷 찾기 ─────────────────────────────────────────────────────── */

export type SnapshotLookup =
  | { readonly ok: true; readonly id: ObjectId; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly error: string }

/**
 * 주소의 앞부분으로 스냅샷을 찾는다. 겹친 것 중 스냅샷만 남긴다 —
 * 사용자는 `log` 에서 본 앞부분을 줬을 것이다.
 */
export function findSnapshot(store: ObjectStore, prefix: string): SnapshotLookup {
  const matches = store.matching(prefix)
  const snapshots = matches.flatMap((id) => {
    const snapshot = store.snapshot(id)
    return snapshot === null ? [] : [{ id, snapshot }]
  })
  if (snapshots.length === 1) return { ok: true, ...snapshots[0]! }
  if (snapshots.length > 1) {
    return {
      ok: false,
      error: `주소가 여럿과 겹칩니다: ${prefix}\n${snapshots.map(({ id }) => `  ${id}`).join('\n')}`,
    }
  }
  if (matches.length > 0) {
    const type = store.read(matches[0]!)?.type ?? '알 수 없음'
    return { ok: false, error: `스냅샷이 아닙니다: ${prefix} (${type})` }
  }
  return {
    ok: false,
    error: historyTruncated(store)
      ? `그런 스냅샷이 없습니다: ${prefix}\n이력이 잘려 있습니다 — 거둔 이력일 수 있습니다`
      : `그런 스냅샷이 없습니다: ${prefix}`,
  }
}

/**
 * HEAD 에서 거슬러 올라가다 읽을 수 없는 부모를 만나는가 (R11.10 의 끊긴 부모).
 * 거둔 주소는 기록하지 않으므로 (0003 §2.2) 아는 것은 이것뿐이다.
 */
export function historyTruncated(store: ObjectStore): boolean {
  let last: Snapshot | null = null
  for (const { snapshot } of store.history()) last = snapshot
  const parent = last?.parents[0]
  return parent !== undefined && store.snapshot(parent) === null
}

/* ── 비교 ─────────────────────────────────────────────────────────────── */

export function diffSnapshots(
  store: ObjectStore,
  before: Snapshot,
  after: Snapshot,
  options: DiffOptions = {},
): Change[] {
  if (before.root === after.root) return []
  return new Comparison(store, options).root(before.root, after.root)
}

/** 항목 하나를 짝짓기에 쓰는 모양으로 편 것. */
interface Item {
  readonly entry: TreeEntry
  readonly index: number
  readonly step: PathStep
  /** 내용으로 짝지을 때의 열쇠 — 종류·이름·meta·주소. */
  readonly identity: string
}

function itemsOf(entries: readonly TreeEntry[]): Item[] {
  const seen = new Map<string, number>()
  return entries.map((entry, index) => {
    let step: PathStep
    if (entry.kind === 'tree') {
      const occurrence = (seen.get(entry.name) ?? 0) + 1
      seen.set(entry.name, occurrence)
      step = sectionStep(entry.name, occurrence)
    } else {
      step = indexStep(index)
    }
    const identity = `${entry.kind}\0${entry.name}\0${canonicalJson(entry.meta ?? null)}\0${entry.id}`
    return { entry, index, step, identity }
  })
}

/** 정렬된 이름 목록 둘을 병합하듯 맞춘다. 컬렉션과 문서 자리에서 쓴다. */
function mergeByName(
  a: readonly TreeEntry[],
  b: readonly TreeEntry[],
): { name: string; before: TreeEntry | null; after: TreeEntry | null }[] {
  const names = [...new Set([...a, ...b].map((entry) => entry.name))].sort((x, y) =>
    x < y ? -1 : x > y ? 1 : 0,
  )
  const byName = (entries: readonly TreeEntry[]) => new Map(entries.map((entry) => [entry.name, entry]))
  const left = byName(a)
  const right = byName(b)
  return names.map((name) => ({ name, before: left.get(name) ?? null, after: right.get(name) ?? null }))
}

/**
 * 짝들 가운데 제자리인 것을 고른다 — 뒤 자리의 최장 증가 부분수열.
 * "가장 적게 옮겼다" 고 보는 해석이다 (0004 §3.3).
 */
function inPlace(pairs: readonly (readonly [number, number])[]): Set<number> {
  const sorted = [...pairs].sort((x, y) => x[0] - y[0])
  const tails: number[] = []
  const previous = new Array<number>(sorted.length).fill(-1)
  for (let k = 0; k < sorted.length; k += 1) {
    const value = sorted[k]![1]
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (sorted[tails[middle]!]![1] < value) low = middle + 1
      else high = middle
    }
    if (low > 0) previous[k] = tails[low - 1]!
    tails[low] = k
  }
  const kept = new Set<number>()
  for (let k = tails[tails.length - 1] ?? -1; k !== -1; k = previous[k]!) kept.add(sorted[k]![0])
  return kept
}

class Comparison {
  constructor(
    private readonly store: ObjectStore,
    private readonly options: DiffOptions,
  ) {}

  private entriesOf(id: ObjectId): readonly TreeEntry[] {
    return this.store.tree(id)?.entries ?? []
  }

  root(before: ObjectId, after: ObjectId): Change[] {
    const changes: Change[] = []
    for (const collection of mergeByName(this.entriesOf(before), this.entriesOf(after))) {
      if (collection.before?.id === collection.after?.id) continue
      const documents = mergeByName(
        collection.before === null ? [] : this.entriesOf(collection.before.id),
        collection.after === null ? [] : this.entriesOf(collection.after.id),
      )
      for (const document of documents) {
        const id = `${collection.name}/${document.name}`
        if (document.before?.id === document.after?.id) continue
        // 한쪽에만 있는 문서는 한 줄로 낸다. 그 안의 블록을 늘어놓는 것은 소음이다.
        if (document.before === null) changes.push({ kind: 'added', address: id })
        else if (document.after === null) changes.push({ kind: 'removed', address: id })
        else changes.push(...this.document(id, document.before.id, document.after.id))
      }
    }
    return changes
  }

  private document(id: string, before: ObjectId, after: ObjectId): Change[] {
    const left = this.store.tree(before)
    const right = this.store.tree(after)
    const changes: Change[] = []
    const a = left === null ? null : documentMetaOf(left)
    const b = right === null ? null : documentMetaOf(right)
    const changed: ChangedPart[] = []
    if (a?.type !== b?.type) changed.push('type')
    if (canonicalJson(a?.aux ?? null) !== canonicalJson(b?.aux ?? null)) changed.push('aux')
    if (changed.length > 0) changes.push({ kind: 'modified', address: id, changed })

    changes.push(...this.entries(id, [], [], left?.entries ?? [], right?.entries ?? []))
    return changes
  }

  /** 문서나 섹션 하나의 항목 목록을 비교한다. 변경은 뒤 목록 순서로 낸다 (0004 §4.3). */
  private entries(
    document: string,
    prefixBefore: readonly PathStep[],
    prefixAfter: readonly PathStep[],
    entriesBefore: readonly TreeEntry[],
    entriesAfter: readonly TreeEntry[],
  ): Change[] {
    const a = itemsOf(entriesBefore)
    const b = itemsOf(entriesAfter)
    const partner = new Map<number, number>()
    const taken = new Set<number>()
    const pair = (i: number, j: number): void => {
      partner.set(i, j)
      taken.add(j)
    }

    // 1. 이름으로
    const named = (items: readonly Item[], kind: TreeEntry['kind']) => {
      const map = new Map<string, Item[]>()
      for (const item of items) {
        if (item.entry.kind !== kind || item.entry.name === '') continue
        map.set(item.entry.name, [...(map.get(item.entry.name) ?? []), item])
      }
      return map
    }
    for (const kind of ['blob', 'tree'] as const) {
      const right = named(b, kind)
      for (const [name, left] of named(a, kind)) {
        const candidates = right.get(name) ?? []
        // 블록의 안정 식별자는 하나뿐이어야 한다(AUX004). 섹션 키는 양쪽에 하나씩일 때만 정체다.
        if (kind === 'tree' && (left.length !== 1 || candidates.length !== 1)) continue
        if (candidates.length === 0) continue
        pair(left[0]!.index, candidates[0]!.index)
      }
    }

    // 2. 내용으로 — 같은 것이 여럿이면 앞에서부터
    const byIdentity = new Map<string, number[]>()
    for (const item of b) {
      if (taken.has(item.index)) continue
      byIdentity.set(item.identity, [...(byIdentity.get(item.identity) ?? []), item.index])
    }
    for (const item of a) {
      if (partner.has(item.index)) continue
      const queue = byIdentity.get(item.identity)
      const j = queue?.shift()
      if (j !== undefined) pair(item.index, j)
    }

    const kept = inPlace([...partner])

    // 3. 자리로 — 제자리 짝 사이의 같은 틈 안에서만
    const anchors = [...kept].sort((x, y) => x - y).map((i) => [i, partner.get(i)!] as const)
    const bounds = [[-1, -1] as const, ...anchors, [a.length, b.length] as const]
    const positional = new Set<number>()
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      const [startA, startB] = bounds[k]!
      const [endA, endB] = bounds[k + 1]!
      const leftGap = a.filter((item) => item.index > startA && item.index < endA && !partner.has(item.index))
      const rightGap = b.filter((item) => item.index > startB && item.index < endB && !taken.has(item.index))
      const used = new Set<number>()
      for (const item of leftGap) {
        const match = rightGap.find(
          (other) =>
            !used.has(other.index) &&
            other.entry.kind === item.entry.kind &&
            (item.entry.kind === 'blob' || other.entry.name === item.entry.name),
        )
        if (match === undefined) continue
        used.add(match.index)
        pair(item.index, match.index)
        positional.add(item.index)
      }
    }

    // 변경을 모은다. 칸 열쇠: 뒤 자리 j, 사라진 것은 앞에서 바로 앞 짝의 뒤 자리 다음.
    const slots: { key: readonly [number, number, number]; changes: Change[] }[] = []
    let lastPartner = -1
    for (const item of a) {
      const j = partner.get(item.index)
      if (j !== undefined) {
        lastPartner = j
        const moved = !kept.has(item.index) && !positional.has(item.index)
        slots.push({ key: [j, 0, 0], changes: this.pair(document, prefixBefore, prefixAfter, item, b[j]!, moved) })
        continue
      }
      slots.push({
        key: [lastPartner, 1, item.index],
        changes: [{ kind: 'removed', address: this.address(document, [...prefixBefore, item.step]), ...this.stableIdOf(item.entry) }],
      })
    }
    for (const item of b) {
      if (taken.has(item.index)) continue
      slots.push({
        key: [item.index, 0, 0],
        changes: [{ kind: 'added', address: this.address(document, [...prefixAfter, item.step]), ...this.stableIdOf(item.entry) }],
      })
    }
    slots.sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1] || x.key[2] - y.key[2])
    return slots.flatMap((slot) => slot.changes)
  }

  /** 짝 하나. 바뀐 것이 없고 제자리면 아무것도 내지 않는다. */
  private pair(
    document: string,
    prefixBefore: readonly PathStep[],
    prefixAfter: readonly PathStep[],
    left: Item,
    right: Item,
    moved: boolean,
  ): Change[] {
    const before = this.address(document, [...prefixBefore, left.step])
    const after = this.address(document, [...prefixAfter, right.step])
    const changed: ChangedPart[] = []
    const nested: Change[] = []
    let patch: string | undefined
    let stableId: string | null = null

    if (left.entry.kind === 'blob' && right.entry.kind === 'blob') {
      const a = blockMetaOf(left.entry)!
      const b = blockMetaOf(right.entry)!
      stableId = b.stableId ?? a.stableId
      if (left.entry.id !== right.entry.id || a.form !== b.form) changed.push('body')
      if (a.stableId !== b.stableId || canonicalJson(a.aux) !== canonicalJson(b.aux)) changed.push('aux')
      if (this.options.patch === true && left.entry.id !== right.entry.id) {
        patch = formatPatch(lineDiff(this.store.blob(left.entry.id) ?? '', this.store.blob(right.entry.id) ?? ''))
      }
    } else if (left.entry.id !== right.entry.id) {
      // 섹션은 자기 제목·보조데이터가 바뀌었을 때만 바뀜이다. 항목이 바뀐 것은 안으로 내려간다.
      const a = this.store.tree(left.entry.id)
      const b = this.store.tree(right.entry.id)
      const metaA = a === null ? null : sectionMetaOf(a)
      const metaB = b === null ? null : sectionMetaOf(b)
      stableId = metaB?.stableId ?? metaA?.stableId ?? null
      if (metaA?.heading !== metaB?.heading) changed.push('heading')
      if (
        metaA?.stableId !== metaB?.stableId ||
        canonicalJson(metaA?.aux ?? null) !== canonicalJson(metaB?.aux ?? null)
      ) {
        changed.push('aux')
      }
      nested.push(
        ...this.entries(
          document,
          [...prefixBefore, left.step],
          [...prefixAfter, right.step],
          a?.entries ?? [],
          b?.entries ?? [],
        ),
      )
    }

    if (changed.length === 0 && !moved) return nested
    const own: Change = {
      kind: moved ? 'moved' : 'modified',
      address: after,
      ...(moved || before !== after ? { before } : {}),
      ...(stableId === null ? {} : { stableId }),
      ...(changed.length === 0 ? {} : { changed }),
      ...(patch === undefined ? {} : { patch }),
    }
    return [own, ...nested]
  }

  private address(document: string, steps: readonly PathStep[]): string {
    return formatAddress({ document, fragment: steps.length === 0 ? null : pathFragment(steps) })
  }

  private stableIdOf(entry: TreeEntry): { stableId?: string } {
    return entry.kind === 'blob' && entry.name !== '' ? { stableId: entry.name } : {}
  }
}
