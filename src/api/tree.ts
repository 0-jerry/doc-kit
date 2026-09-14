/**
 * 불변 트리를 고쳐 쓰는 순수 함수들. 명령이 공유하는 재료이고,
 * 자기 자신은 규약도 진단도 모른다.
 */

import {
  type Child,
  Document,
  type Parent,
  type PathStep,
  Section,
} from '../model/index.js'

function withChildren<P extends Parent>(parent: P, children: readonly Child[]): P {
  return (parent instanceof Document
    ? parent.with({ children })
    : parent.with({ children })) as P
}

/** 걸음이 가리키는 자식의 위치. 없으면 -1. */
export function indexOfStep(parent: Parent, step: PathStep): number {
  if (step.kind === 'index') {
    return step.index >= 0 && step.index < parent.children.length ? step.index : -1
  }
  let occurrence = 0
  for (const [index, child] of parent.children.entries()) {
    if (child.kind !== 'section' || child.key !== step.key) continue
    occurrence += 1
    if (occurrence === step.occurrence) return index
  }
  return -1
}

/** 경로가 가리키는 부모를 찾는다. 경로가 빈 배열이면 자신. */
export function parentAt(parent: Parent, path: readonly PathStep[]): Parent | null {
  const [head, ...rest] = path
  if (head === undefined) return parent
  const index = indexOfStep(parent, head)
  if (index === -1) return null
  const child = parent.children[index]
  if (child === undefined || child.kind !== 'section') return null
  return parentAt(child, rest)
}

/** 경로가 가리키는 노드를 바꾼다. `next` 가 null 이면 지운다. */
export function replaceAt<P extends Parent>(
  parent: P,
  path: readonly PathStep[],
  next: Child | null,
): P | null {
  const [head, ...rest] = path
  if (head === undefined) return null
  const index = indexOfStep(parent, head)
  if (index === -1) return null
  const child = parent.children[index]!

  if (rest.length === 0) {
    const children =
      next === null
        ? [...parent.children.slice(0, index), ...parent.children.slice(index + 1)]
        : [...parent.children.slice(0, index), next, ...parent.children.slice(index + 1)]
    return withChildren(parent, children)
  }

  if (child.kind !== 'section') return null
  const updated = replaceAt(child, rest, next)
  if (updated === null) return null
  return withChildren(parent, [
    ...parent.children.slice(0, index),
    updated,
    ...parent.children.slice(index + 1),
  ])
}

/** 경로가 가리키는 부모의 자식 목록에 노드를 끼워 넣는다. */
export function insertAt<P extends Parent>(
  parent: P,
  path: readonly PathStep[],
  index: number,
  node: Child,
): P | null {
  const [head, ...rest] = path
  if (head === undefined) {
    const at = Math.max(0, Math.min(index, parent.children.length))
    return withChildren(parent, [
      ...parent.children.slice(0, at),
      node,
      ...parent.children.slice(at),
    ])
  }
  const position = indexOfStep(parent, head)
  if (position === -1) return null
  const child = parent.children[position]
  if (child === undefined || child.kind !== 'section') return null
  const updated = insertAt(child, rest, index, node)
  if (updated === null) return null
  return withChildren(parent, [
    ...parent.children.slice(0, position),
    updated,
    ...parent.children.slice(position + 1),
  ])
}

/** 섹션이 있어야 할 자리. 규약이 정한 순서를 따라 끼울 위치를 고른다. */
export function orderedInsertIndex(
  parent: Parent,
  key: string,
  order: readonly string[],
): number {
  const rank = order.indexOf(key)
  if (rank === -1) return parent.children.length
  for (const [index, child] of parent.children.entries()) {
    if (!(child instanceof Section)) continue
    const childRank = order.indexOf(child.key)
    if (childRank !== -1 && childRank > rank) return index
  }
  return parent.children.length
}
