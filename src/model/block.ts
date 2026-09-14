/**
 * 리프. 마크다운 블록 하나를 담는다.
 * 자식을 가질 수 없고(P1), 역할은 보조데이터의 `role` 하나뿐이다(P2).
 */

import type { RootContent } from 'mdast'
import { type Aux, EMPTY_AUX } from './aux.js'
import { type Leaf, NodeBase } from './node.js'

/**
 * 블록의 거친 분류. 스키마가 역할별 요구사항을 걸 때 쓴다(예: `example` 은 `code` 필요).
 * 세밀한 종류는 `source.type` 에 그대로 남아 있다.
 */
export type BlockForm = 'paragraph' | 'list' | 'code' | 'table' | 'quote' | 'other'

export interface BlockInit {
  readonly form: BlockForm
  /** 서식을 제거한 평문. 추출은 파서가 하고 모델은 보관만 한다. */
  readonly text: string
  /** 원문 mdast 노드. 왕복 보존의 근거이자 계보(원본 위치)의 출처다. */
  readonly source: RootContent
  readonly aux?: Aux
  readonly stableId?: string | null
}

export class Block extends NodeBase implements Leaf {
  readonly kind = 'block' as const
  readonly form: BlockForm
  readonly text: string
  readonly source: RootContent

  constructor(init: BlockInit) {
    super(init.aux ?? EMPTY_AUX, init.stableId ?? null)
    this.form = init.form
    this.text = init.text
    this.source = init.source
  }

  /** 원문에서의 시작 줄. 없으면 null. */
  get line(): number | null {
    return this.source.position?.start.line ?? null
  }

  with(patch: Partial<BlockInit>): Block {
    return new Block({
      form: patch.form ?? this.form,
      text: patch.text ?? this.text,
      source: patch.source ?? this.source,
      aux: patch.aux ?? this.aux,
      stableId: patch.stableId === undefined ? this.stableId : patch.stableId,
    })
  }
}
