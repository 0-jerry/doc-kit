/**
 * 문서 하나의 트리를 소유하고 그 안의 노드를 조회한다.
 * 다른 문서를 모른다 — 문서 간의 것은 전부 인덱스가 담당한다.
 */

import { type Aux, EMPTY_AUX, resolveAux } from './aux.js'
import {
  type Address,
  type DocumentId,
  type Fragment,
  type PathStep,
  indexStep,
  parseStep,
  pathFragment,
  sectionStep,
} from './id.js'
import { type Branch, NodeBase } from './node.js'
import type { Child, Section } from './section.js'

/** 자식을 가질 수 있는 노드. */
export type Parent = Document | Section

export interface Visit {
  /** 문서 자신도 노드다 — `Document.self()` 가 내는 방문이 그것이다. */
  readonly node: Child | Document
  /** 루트(문서)부터 직계 부모까지. 문서 자신의 방문에서는 비어 있다. */
  readonly ancestors: readonly Parent[]
  /** 문서 루트 기준 위치 주소. 문서 자신은 비어 있다. */
  readonly path: readonly PathStep[]
}

export interface DocumentInit {
  readonly id: DocumentId
  /** 스키마가 정의한 문서 타입 이름. */
  readonly type: string
  /** 저장소 루트 기준 원본 파일 경로. */
  readonly path: string
  readonly children?: readonly Child[]
  /** frontmatter 가 차지한 원문 조각. 첫 자식 앞까지다. */
  readonly raw?: string | null
  readonly aux?: Aux
}

export class Document extends NodeBase implements Branch {
  readonly kind = 'document' as const
  readonly id: DocumentId
  readonly type: string
  readonly path: string
  readonly children: readonly Child[]
  readonly raw: string | null

  #stableIndex: ReadonlyMap<string, Visit> | null = null

  constructor(init: DocumentInit) {
    super(init.aux ?? EMPTY_AUX, null)
    this.id = init.id
    this.type = init.type
    this.path = init.path
    this.children = init.children ?? []
    this.raw = init.raw ?? null
  }

  get sections(): readonly Section[] {
    return this.children.filter((child): child is Section => child.kind === 'section')
  }

  /**
   * 문서 자신을 가리키는 방문. 문서에 붙은 보조데이터도 검사 대상이므로
   * 순회와 별개로 이것을 낸다.
   */
  self(): Visit {
    return { node: this, ancestors: [], path: [] }
  }

  /** 깊이 우선 순회. 문서 자신은 포함하지 않는다 — 그것은 `self()` 가 낸다. */
  *walk(): Generator<Visit> {
    yield* walkChildren(this, [this], [])
  }

  /** 위치 주소 또는 안정 주소로 노드를 찾는다. 없으면 null. */
  resolve(fragment: Fragment): Visit | null {
    if (fragment.kind === 'stable') {
      const found = this.stableIndex().get(fragment.id)
      if (found) return found
      // 걸음이 하나뿐인 주소는 안정 식별자와 위치 걸음을 문법으로 가릴 수 없다.
      // 안정 식별자를 먼저 보고, 없으면 위치 걸음으로 한 번 더 읽는다.
      const step = parseStep(fragment.id)
      return step === null ? null : this.resolvePath([step])
    }
    return this.resolvePath(fragment.steps)
  }

  resolvePath(steps: readonly PathStep[]): Visit | null {
    let parent: Parent = this
    const ancestors: Parent[] = [this]
    const path: PathStep[] = []
    let node: Child | null = null

    for (const step of steps) {
      const child = childAt(parent, step)
      if (child === null) return null
      if (node !== null) ancestors.push(parent)
      path.push(normalizeStep(parent, child, step))
      node = child
      if (child.kind !== 'section') {
        // 리프에 닿았는데 걸음이 남았으면 주소가 틀린 것이다.
        if (path.length !== steps.length) return null
        break
      }
      parent = child
    }

    if (node === null) return null
    return { node, ancestors, path }
  }

  /** 안정 식별자 → 노드. 문서가 불변이므로 한 번만 만든다. */
  stableIndex(): ReadonlyMap<string, Visit> {
    if (this.#stableIndex === null) {
      const index = new Map<string, Visit>()
      for (const visit of this.walk()) {
        const id = visit.node.stableId
        // 중복은 먼저 나온 쪽이 이긴다. 중복 자체는 검증기가 보고한다.
        if (id !== null && !index.has(id)) index.set(id, visit)
      }
      this.#stableIndex = index
    }
    return this.#stableIndex
  }

  address(path: readonly PathStep[]): Address {
    return {
      document: this.id,
      fragment: path.length === 0 ? null : pathFragment(path),
    }
  }

  /** frontmatter 에 적히는 것이 바뀌면 원문 조각을 버린다 — id 와 type 도 거기 적힌다. */
  with(patch: Partial<DocumentInit>): Document {
    const frontmatterChanged =
      patch.aux !== undefined || patch.id !== undefined || patch.type !== undefined
    return new Document({
      id: patch.id ?? this.id,
      type: patch.type ?? this.type,
      path: patch.path ?? this.path,
      children: patch.children ?? this.children,
      raw: patch.raw !== undefined ? patch.raw : frontmatterChanged ? null : this.raw,
      aux: patch.aux ?? this.aux,
    })
  }
}

function* walkChildren(
  parent: Parent,
  ancestors: readonly Parent[],
  prefix: readonly PathStep[],
): Generator<Visit> {
  const seen = new Map<string, number>()
  for (const [index, child] of parent.children.entries()) {
    const step =
      child.kind === 'section'
        ? sectionStep(child.key, nextOccurrence(seen, child.key))
        : indexStep(index)
    const path = [...prefix, step]
    yield { node: child, ancestors, path }
    if (child.kind === 'section') {
      yield* walkChildren(child, [...ancestors, child], path)
    }
  }
}

function nextOccurrence(seen: Map<string, number>, key: string): number {
  const occurrence = (seen.get(key) ?? 0) + 1
  seen.set(key, occurrence)
  return occurrence
}

function childAt(parent: Parent, step: PathStep): Child | null {
  if (step.kind === 'index') return parent.children[step.index] ?? null
  let occurrence = 0
  for (const child of parent.children) {
    if (child.kind !== 'section' || child.key !== step.key) continue
    occurrence += 1
    if (occurrence === step.occurrence) return child
  }
  return null
}

/** 인덱스로 찾은 섹션은 키 기반 걸음으로 바꿔 주소를 안정적으로 만든다. */
function normalizeStep(parent: Parent, child: Child, step: PathStep): PathStep {
  if (child.kind !== 'section') return step
  if (step.kind === 'section') return step
  let occurrence = 0
  for (const sibling of parent.children) {
    if (sibling.kind !== 'section' || sibling.key !== child.key) continue
    occurrence += 1
    if (sibling === child) break
  }
  return sectionStep(child.key, occurrence)
}

/** 방문한 노드의 상속을 반영한 보조데이터. */
export function effectiveAux(visit: Visit): Aux {
  return resolveAux([...visit.ancestors.map((node) => node.aux), visit.node.aux])
}
