/**
 * 트리 노드의 공통 모양.
 *
 * `Leaf` 에 `children?: never` 를 둔 것이 원칙 P1 의 강제 장치다.
 * 리프가 자식을 갖는 코드는 컴파일되지 않으므로 검사기를 따로 만들지 않는다.
 */

import type { Aux } from './aux.js'

export type NodeKind = 'document' | 'section' | 'block'

/**
 * 원문에서 이 노드의 조각이 차지한 범위.
 *
 * 조각을 다시 이을 때 **원래 이웃이었는지** 가리는 데 쓴다. 원래 이웃이었으면
 * 작성자가 쓴 간격을 그대로 두고, 아니면 직렬화기가 빈 줄을 보장한다 —
 * 빈 줄 없이 이으면 두 블록이 하나로 읽혀 분리해 둔 책임이 사라지기 때문이다.
 *
 * 위치는 **한 문서의 원문 안에서만** 뜻이 있다. 노드를 다른 문서로 옮기는 일이
 * 생기면 그때 이 값을 버려야 한다 — 남의 파일의 좌표가 우연히 맞아떨어지면
 * 이웃이 아닌 것을 이웃이라고 보게 된다.
 */
export interface Origin {
  readonly start: number
  /** 조각이 끝난 위치. 원문에서 다음 노드가 시작한 곳이다. */
  readonly end: number
}

export interface Node {
  readonly kind: NodeKind
  /** 이 노드에 **선언된** 보조데이터. 상속을 반영한 값은 `resolveAux` 로 얻는다. */
  readonly aux: Aux
  /** 관계 링크의 대상이 될 수 있는 안정 식별자. 없으면 위치 주소로만 가리킨다. */
  readonly stableId: string | null
}

export interface Branch extends Node {
  readonly children: readonly Node[]
}

export interface Leaf extends Node {
  readonly children?: never
}

/** 모든 노드가 공유하는 상태. 행동은 두지 않는다 — 모델은 데이터이고 판단하지 않는다. */
export abstract class NodeBase implements Node {
  abstract readonly kind: NodeKind
  readonly aux: Aux
  readonly stableId: string | null

  protected constructor(aux: Aux, stableId: string | null) {
    this.aux = aux
    this.stableId = stableId
  }
}
