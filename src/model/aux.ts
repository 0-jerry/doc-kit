/**
 * 맥락 파악용 보조데이터의 보관과 상속 병합만 담당한다.
 * 값이 유효한지는 판단하지 않는다 — 어휘는 스키마가, 판정은 검증기가 소유한다.
 */

/** 블록이 문서 안에서 맡은 기능. 어휘는 스키마가 정한다. */
export type RoleId = string

/** 대상 — 이 노드가 적용되는 곳. */
export type SubjectId = string

/** 주제 — 이 노드가 무엇에 관한 것인지. */
export type TopicId = string

/** 수명주기와 강제 수준. 값의 어휘는 스키마가 소유하므로 모델은 문자열로 둔다. */
export interface Lifecycle {
  readonly status?: string
  readonly since?: string
  readonly until?: string
  /** 강제 수준. 예: `must` · `should` · `may` */
  readonly level?: string
}

/** 다른 노드로의 링크. 트리 간선이 아니라 그래프 간선이다. */
export interface Relation {
  readonly kind: string
  /** 대상의 주소 문자열. 해석은 인덱스가 한다. */
  readonly target: string
}

/** 노드에 선언된 보조데이터. */
export interface Aux {
  /** 역할은 단수다 — 한 블록이 두 역할을 겸할 수 없다 (원칙 P2). */
  readonly role?: RoleId
  readonly subject: readonly SubjectId[]
  readonly topic: readonly TopicId[]
  readonly lifecycle: Lifecycle
  readonly relations: readonly Relation[]
}

export const EMPTY_AUX: Aux = Object.freeze({
  subject: Object.freeze([]) as readonly SubjectId[],
  topic: Object.freeze([]) as readonly TopicId[],
  lifecycle: Object.freeze({}),
  relations: Object.freeze([]) as readonly Relation[],
})

/** 부분 선언으로부터 보조데이터를 만든다. 빠진 항목은 비어 있는 것으로 둔다. */
export function aux(partial: Partial<Aux> = {}): Aux {
  return {
    ...(partial.role === undefined ? {} : { role: partial.role }),
    subject: partial.subject ?? [],
    topic: partial.topic ?? [],
    lifecycle: partial.lifecycle ?? {},
    relations: partial.relations ?? [],
  }
}

function unique<T>(values: readonly T[]): readonly T[] {
  return values.length <= 1 ? values : [...new Set(values)]
}

function intersect<T>(a: readonly T[], b: readonly T[]): readonly T[] {
  const set = new Set(a)
  return b.filter((value) => set.has(value))
}

function mergeLifecycle(parent: Lifecycle, child: Lifecycle): Lifecycle {
  return {
    ...parent,
    ...(child.status === undefined ? {} : { status: child.status }),
    ...(child.since === undefined ? {} : { since: child.since }),
    ...(child.until === undefined ? {} : { until: child.until }),
    ...(child.level === undefined ? {} : { level: child.level }),
  }
}

/**
 * 조상의 보조데이터 위에 자손의 선언을 얹는다.
 *
 * | 키 | 규칙 |
 * | --- | --- |
 * | `role` | 상속하지 않는다 |
 * | `subject` | 상속. 양쪽이 모두 선언되면 **교집합** — 자손은 좁히기만 할 수 있다 |
 * | `topic` | 상속. 합집합 |
 * | `lifecycle` | 상속. 선언된 항목만 덮어쓴다 |
 * | `relations` | 상속하지 않는다 |
 *
 * `subject` 가 좁아지기만 하는 것이 책임 확장을 구조적으로 막는 장치다.
 * 자손이 조상 밖의 대상을 주장하면 여기서 조용히 사라지고, 검증기가 `AUX001` 로 보고한다.
 */
export function mergeAux(parent: Aux, child: Aux): Aux {
  const subject =
    parent.subject.length === 0
      ? child.subject
      : child.subject.length === 0
        ? parent.subject
        : intersect(parent.subject, child.subject)

  return {
    ...(child.role === undefined ? {} : { role: child.role }),
    subject: unique(subject),
    topic: unique([...parent.topic, ...child.topic]),
    lifecycle: mergeLifecycle(parent.lifecycle, child.lifecycle),
    relations: child.relations,
  }
}

/** 루트에서 대상 노드까지의 선언 체인을 하나로 해석한다. */
export function resolveAux(chain: readonly Aux[]): Aux {
  return chain.reduce(mergeAux, EMPTY_AUX)
}

/**
 * 자손이 조상 밖으로 넓히려 한 대상들. 비어 있지 않으면 원칙 P7 위반이다.
 * 판정은 하지 않고 사실만 돌려준다.
 */
export function widenedSubjects(parent: Aux, child: Aux): readonly SubjectId[] {
  if (parent.subject.length === 0 || child.subject.length === 0) return []
  const allowed = new Set(parent.subject)
  return child.subject.filter((subject) => !allowed.has(subject))
}
