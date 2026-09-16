/** 구조가 과도한 책임을 갖지 못하게 하는 검사기들 (원칙 P3 · P4 · P6 · P9). */

import { toString as mdastToString } from 'mdast-util-to-string'
import type { Diagnostic } from '../../diagnostic/index.js'
import { Block, Document, Section, type Visit } from '../../model/index.js'
import type { CheckContext, DocumentCheck, NodeCheck } from '../check.js'

/** 문장 수를 센다. 마침표류로 끊고 빈 조각은 버린다. */
export function countSentences(text: string): number {
  return text
    .split(/[.!?。！？]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length
}

/**
 * 블록이 실제로 내놓는 진술들.
 *
 * 목록은 항목 하나가 진술 하나다. 항목을 이어 붙인 평문으로 세면
 * 항목 수만큼 문장이 늘어나 "한 가지만 말한다"가 목록을 금지하는 규칙이 되어 버린다 —
 * 규범 역할이 목록 형태를 허용하는 한 그렇게 읽을 수 없다.
 */
export function statementsOf(block: Block): readonly string[] {
  if (block.source.type !== 'list') return [block.text]
  return block.source.children.map((item) => mdastToString(item))
}

/** STR001 — 규범 진술이 한 가지만 말하는가. */
export class SentenceLimit implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'STR001'
  readonly severity = 'warning' as const
  readonly principle = '규범 진술 블록은 한 가지만 말한다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    if (!(node instanceof Block) || node.aux.role === undefined) return []
    const limit = context.schema.role(node.aux.role)?.maxSentences
    if (limit === undefined) return []
    const statements = statementsOf(node)
    const sentences = Math.max(...statements.map(countSentences))
    if (sentences <= limit) return []
    const unit = statements.length > 1 ? '목록 항목' : '블록'
    return [
      context.report(
        this,
        `'${node.aux.role}' ${unit}이 ${sentences} 문장입니다. 상한은 ${limit} 문장입니다`,
        visit,
        '근거나 예외가 섞여 있다면 해당 섹션으로 내려보내세요',
      ),
    ]
  }
}

/** STR002 — 섹션이 담을 수 있는 블록 수를 넘지 않는가. */
export class BlockLimit implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'STR002'
  readonly severity = 'error' as const
  readonly principle = '섹션은 규약이 정한 블록 수를 넘지 않는다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    if (!(node instanceof Section)) return []
    const spec = context.schema.sectionAt(context.document.type, context.sectionPath(visit))
    if (spec?.maxBlocks === undefined) return []
    const blocks = node.blocks.length
    if (blocks <= spec.maxBlocks) return []
    return [
      context.report(
        this,
        `'${node.key}' 섹션에 블록이 ${blocks} 개입니다. 상한은 ${spec.maxBlocks} 개입니다`,
        visit,
        '문서를 쪼개거나 내용을 다른 섹션으로 옮기세요',
      ),
    ]
  }
}

/** STR003 — 트리가 규약이 정한 깊이를 넘지 않는가. */
export class DepthLimit implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'STR003'
  readonly severity = 'error' as const
  readonly principle = '트리 깊이는 규약의 상한을 넘지 않는다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const limit = context.schema.documentType(context.document.type)?.maxDepth
    if (limit === undefined) return []
    // 문서를 1 로 센다. ancestors 에 문서가 들어 있으므로 길이가 곧 깊이다.
    const depth = visit.ancestors.length + 1
    if (depth <= limit) return []
    return [
      context.report(
        this,
        `깊이 ${depth} 입니다. 상한은 ${limit} 입니다`,
        visit,
        '중첩 섹션 대신 별도 문서로 나누세요',
      ),
    ]
  }
}

/** STR004 — 형제가 너무 많지 않은가. */
export class FanOutLimit implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'STR004'
  readonly severity = 'warning' as const
  readonly principle = '형제 노드 수는 임계값을 넘지 않는다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    // 문서 직속 자식도 형제다. 정작 책임이 가장 크게 불어나는 곳을 빼면 안 된다.
    if (!(node instanceof Section) && !(node instanceof Document)) return []
    const limit = context.schema.limits.maxChildren
    const count = node.children.length
    if (count <= limit) return []
    const where = node instanceof Section ? `'${node.key}' 섹션` : '문서'
    return [
      context.report(
        this,
        `${where}의 자식이 ${count} 개입니다. 임계값은 ${limit} 개입니다`,
        visit,
        '한 곳이 너무 많은 것을 담고 있다는 신호입니다',
      ),
    ]
  }
}

/** STR005 — 문서 하나가 너무 커지지 않았는가. */
export class DocumentSizeLimit implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'STR005'
  readonly severity = 'warning' as const
  readonly principle = '문서 하나가 담는 블록 수는 임계값을 넘지 않는다'

  run(context: CheckContext): readonly Diagnostic[] {
    const limit = context.schema.limits.maxBlocksPerDocument
    const blocks = [...context.document.walk()].filter((visit) => visit.node instanceof Block).length
    if (blocks <= limit) return []
    return [
      context.report(
        this,
        `문서에 블록이 ${blocks} 개입니다. 임계값은 ${limit} 개입니다`,
        null,
        '판단기준 하나가 여러 개로 나뉘어야 할 때가 됐습니다',
      ),
    ]
  }
}
