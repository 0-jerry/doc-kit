/**
 * 표시하고 쓸어낸다. 주소만 알고 문서는 모른다 — 무엇을 뿌리로 삼을지는 부르는 쪽이 정한다.
 *
 * 내용 주소 저장소에서는 도달성이 곧 필요성이다. 뿌리에서 닿지 않는 객체는
 * 어떤 스냅샷으로도 되살릴 수 없으므로 지워도 잃는 것이 없다.
 */

import type { ObjectId } from './hash.js'
import type { ObjectStore } from './objects.js'
import { decodeSnapshot, decodeTree } from './wire.js'

export interface SweepPlan {
  /** 뿌리에서 닿는 객체. 지우지 않는다. */
  readonly keep: ReadonlySet<ObjectId>
  /** 닿지 않는 객체. 쓸어낼 대상이다. */
  readonly remove: readonly ObjectId[]
}

/**
 * 뿌리들에서 닿는 객체를 모두 표시한다.
 *
 * 스냅샷의 **부모는 따르지 않는다**. 이력을 얼마나 거슬러 올라갈지는 정책이고,
 * 부르는 쪽이 뿌리 목록으로 표현한다 — 이 함수는 정책을 모른다.
 */
export function markFrom(store: ObjectStore, roots: readonly ObjectId[]): Set<ObjectId> {
  const marked = new Set<ObjectId>()
  const pending: ObjectId[] = []

  const push = (id: ObjectId): void => {
    if (!marked.has(id)) {
      marked.add(id)
      pending.push(id)
    }
  }
  for (const root of roots) push(root)

  while (pending.length > 0) {
    const id = pending.pop()!
    const object = store.read(id)
    if (object === null) continue // 끊긴 링크. 이미 없는 것은 표시할 것도 없다

    // 이미 읽은 내용을 그대로 푼다. store.tree() 를 다시 부르면 같은 파일을 두 번 읽는다.
    try {
      if (object.type === 'snapshot') push(decodeSnapshot(object.payload).root)
      else if (object.type === 'tree') {
        for (const entry of decodeTree(object.payload).entries) push(entry.id)
      }
    } catch {
      // 망가진 객체. 자식을 알 수 없으니 끊긴 링크처럼 다룬다
    }
    // blob 은 자식이 없다
  }
  return marked
}

/** 무엇을 지울지 정한다. 아직 지우지는 않는다 — `--dry-run` 이 이것만 쓴다. */
export function planSweep(store: ObjectStore, roots: readonly ObjectId[]): SweepPlan {
  const keep = markFrom(store, roots)
  const remove: ObjectId[] = []
  for (const id of store.ids()) {
    if (!keep.has(id)) remove.push(id)
  }
  return { keep, remove }
}

/** 계획대로 쓸어낸다. 지운 개수를 돌려준다. */
export function sweep(store: ObjectStore, plan: SweepPlan): number {
  let removed = 0
  for (const id of plan.remove) {
    if (store.remove(id)) removed += 1
  }
  return removed
}
