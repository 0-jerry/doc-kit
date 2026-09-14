/**
 * 트리 노드의 공통 모양.
 *
 * `Leaf` 에 `children?: never` 를 둔 것이 원칙 P1 의 강제 장치다.
 * 리프가 자식을 갖는 코드는 컴파일되지 않으므로 검사기를 따로 만들지 않는다.
 */

import type { Aux } from './aux.js'

export type NodeKind = 'document' | 'section' | 'block'

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
