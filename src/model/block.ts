/**
 * 리프. 마크다운 블록 하나를 담는다.
 * 자식을 가질 수 없고(P1), 역할은 보조데이터의 `role` 하나뿐이다(P2).
 */

import type { RootContent } from 'mdast'
import { type Aux, EMPTY_AUX } from './aux.js'
import { type Leaf, NodeBase, type Origin } from './node.js'

/**
 * 블록의 거친 분류. 스키마가 역할별 요구사항을 걸 때 쓴다(예: `example` 은 `code` 필요).
 * 세밀한 종류는 `source.type` 에 그대로 남아 있다.
 */
export type BlockForm = 'paragraph' | 'list' | 'code' | 'table' | 'quote' | 'other'

export interface BlockInit {
  readonly form: BlockForm
  /** 서식을 제거한 평문. 추출은 파서가 하고 모델은 보관만 한다. */
  readonly text: string
  /** 원문 mdast 노드. 계보(원본 위치)의 출처다. */
  readonly source: RootContent
  /**
   * 본문이 차지한 원문 조각. 뒤따르는 빈 줄까지 포함한다.
   * 노드들의 조각을 문서 순서대로 이으면 원문이 그대로 나온다 — 왕복 보존의 근거다.
   * 내용을 고쳤거나 새로 만든 노드는 null 이고, 직렬화기가 새로 쓴다.
   */
  readonly raw?: string | null
  /** 앞에 붙은 디렉티브 주석의 원문 조각. 보조데이터가 바뀌면 버린다. */
  readonly directiveRaw?: string | null
  /** 원문에서 이 조각이 차지한 범위. 본문이 바뀌면 버린다. */
  readonly origin?: Origin | null
  readonly aux?: Aux
  readonly stableId?: string | null
}

export class Block extends NodeBase implements Leaf {
  readonly kind = 'block' as const
  readonly form: BlockForm
  readonly text: string
  readonly source: RootContent
  readonly raw: string | null
  readonly directiveRaw: string | null
  readonly origin: Origin | null

  constructor(init: BlockInit) {
    super(init.aux ?? EMPTY_AUX, init.stableId ?? null)
    this.form = init.form
    this.text = init.text
    this.source = init.source
    this.raw = init.raw ?? null
    this.directiveRaw = init.directiveRaw ?? null
    this.origin = init.origin ?? null
  }

  /** 원문에서의 시작 줄. 없으면 null. */
  get line(): number | null {
    return this.source.position?.start.line ?? null
  }

  /**
   * 고친 사본을 만든다. 바뀐 쪽의 원문 조각만 버린다 —
   * 본문은 그대로 두고 보조데이터만 고치면 본문은 원문 그대로 다시 쓰인다.
   */
  with(patch: Partial<BlockInit>): Block {
    const bodyChanged =
      patch.form !== undefined || patch.text !== undefined || patch.source !== undefined
    const auxChanged = patch.aux !== undefined || patch.stableId !== undefined
    return new Block({
      form: patch.form ?? this.form,
      text: patch.text ?? this.text,
      source: patch.source ?? this.source,
      raw: patch.raw !== undefined ? patch.raw : bodyChanged ? null : this.raw,
      origin: patch.origin !== undefined ? patch.origin : bodyChanged ? null : this.origin,
      directiveRaw:
        patch.directiveRaw !== undefined
          ? patch.directiveRaw
          : auxChanged
            ? null
            : this.directiveRaw,
      aux: patch.aux ?? this.aux,
      stableId: patch.stableId === undefined ? this.stableId : patch.stableId,
    })
  }
}
