/**
 * 가지. 자식의 순서만 관리하고 내용은 해석하지 않는다.
 */

import { type Aux, EMPTY_AUX } from './aux.js'
import type { Block } from './block.js'
import { type Branch, NodeBase } from './node.js'

/** 트리에서 문서의 자손이 될 수 있는 것. */
export type Child = Section | Block

export interface SectionInit {
  /** 스키마가 정한 섹션 키. 매핑되지 않은 제목은 파서가 슬러그로 만든다. */
  readonly key: string
  /** 원문 제목. 왕복 보존에 쓴다. */
  readonly heading: string
  /** 제목의 깊이(`##` 은 2). */
  readonly depth: number
  readonly children?: readonly Child[]
  readonly aux?: Aux
  readonly stableId?: string | null
}

export class Section extends NodeBase implements Branch {
  readonly kind = 'section' as const
  readonly key: string
  readonly heading: string
  readonly depth: number
  readonly children: readonly Child[]

  constructor(init: SectionInit) {
    super(init.aux ?? EMPTY_AUX, init.stableId ?? null)
    this.key = init.key
    this.heading = init.heading
    this.depth = init.depth
    this.children = init.children ?? []
  }

  get sections(): readonly Section[] {
    return this.children.filter((child): child is Section => child.kind === 'section')
  }

  get blocks(): readonly Block[] {
    return this.children.filter((child): child is Block => child.kind === 'block')
  }

  with(patch: Partial<SectionInit>): Section {
    return new Section({
      key: patch.key ?? this.key,
      heading: patch.heading ?? this.heading,
      depth: patch.depth ?? this.depth,
      children: patch.children ?? this.children,
      aux: patch.aux ?? this.aux,
      stableId: patch.stableId === undefined ? this.stableId : patch.stableId,
    })
  }
}
