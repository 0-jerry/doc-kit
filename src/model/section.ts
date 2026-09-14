/**
 * 가지. 자식의 순서만 관리하고 내용은 해석하지 않는다.
 */

import { type Aux, EMPTY_AUX } from './aux.js'
import type { Block } from './block.js'
import { type Branch, NodeBase, type Origin } from './node.js'

/** 트리에서 문서의 자손이 될 수 있는 것. */
export type Child = Section | Block

export interface SectionInit {
  /** 스키마가 정한 섹션 키. 매핑되지 않은 제목은 파서가 슬러그로 만든다. */
  readonly key: string
  /** 원문 제목. 왕복 보존에 쓴다. */
  readonly heading: string
  /** 제목의 깊이(`##` 은 2). */
  readonly depth: number
  /** 원문에서 제목이 있는 줄. 계보이자 진단의 좌표다. */
  readonly line?: number | null
  readonly children?: readonly Child[]
  /** 제목 줄이 차지한 원문 조각. 자식의 조각은 포함하지 않는다. */
  readonly raw?: string | null
  /** 제목 앞에 붙은 디렉티브 주석의 원문 조각. 보조데이터가 바뀌면 버린다. */
  readonly directiveRaw?: string | null
  /** 원문에서 이 조각이 차지한 범위. 제목이 바뀌면 버린다. */
  readonly origin?: Origin | null
  readonly aux?: Aux
  readonly stableId?: string | null
}

export class Section extends NodeBase implements Branch {
  readonly kind = 'section' as const
  readonly key: string
  readonly heading: string
  readonly depth: number
  readonly children: readonly Child[]
  readonly raw: string | null
  readonly directiveRaw: string | null
  readonly line: number | null
  readonly origin: Origin | null

  constructor(init: SectionInit) {
    super(init.aux ?? EMPTY_AUX, init.stableId ?? null)
    this.key = init.key
    this.heading = init.heading
    this.depth = init.depth
    this.children = init.children ?? []
    this.raw = init.raw ?? null
    this.directiveRaw = init.directiveRaw ?? null
    this.line = init.line ?? null
    this.origin = init.origin ?? null
  }

  get sections(): readonly Section[] {
    return this.children.filter((child): child is Section => child.kind === 'section')
  }

  get blocks(): readonly Block[] {
    return this.children.filter((child): child is Block => child.kind === 'block')
  }

  /** 자식이 바뀌어도 제목 조각은 유효하므로 그대로 둔다. */
  with(patch: Partial<SectionInit>): Section {
    const headingChanged = patch.heading !== undefined || patch.depth !== undefined
    const auxChanged = patch.aux !== undefined || patch.stableId !== undefined
    return new Section({
      key: patch.key ?? this.key,
      heading: patch.heading ?? this.heading,
      depth: patch.depth ?? this.depth,
      line: patch.line === undefined ? this.line : patch.line,
      children: patch.children ?? this.children,
      raw: patch.raw !== undefined ? patch.raw : headingChanged ? null : this.raw,
      origin: patch.origin !== undefined ? patch.origin : headingChanged ? null : this.origin,
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
