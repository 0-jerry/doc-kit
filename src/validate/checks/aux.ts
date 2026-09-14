/** 보조데이터가 책임을 넓히지 못하게 하는 검사기들 (원칙 P7 · P8). */

import type { Diagnostic } from '../../diagnostic/index.js'
import {
  type Parent,
  Section,
  type Visit,
  resolveAux,
  widenedSubjects,
} from '../../model/index.js'
import type { CheckContext, DocumentCheck, NodeCheck } from '../check.js'

/** 조상들의 선언만 합친 보조데이터. 자기 선언은 빼고 본다. */
function inherited(ancestors: readonly Parent[]) {
  return resolveAux(ancestors.map((node) => node.aux))
}

/** AUX001 — 자손이 조상보다 넓은 대상을 주장하지 않는가. */
export class SubjectNarrowing implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'AUX001'
  readonly severity = 'error' as const
  readonly principle = '자손의 대상은 조상보다 넓을 수 없다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const widened = widenedSubjects(inherited(visit.ancestors), visit.node.aux)
    if (widened.length === 0) return []
    return [
      context.report(
        this,
        `조상이 다루지 않는 대상을 주장합니다: ${widened.join(' · ')}`,
        visit,
        '상위 문서나 섹션의 subject 를 먼저 넓히거나, 별도 문서로 분리하세요',
      ),
    ]
  }
}

/** AUX002 — 닫힌 어휘 밖의 값을 쓰지 않았는가. */
export class ClosedVocabulary implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'AUX002'
  readonly severity = 'error' as const
  readonly principle = '닫힌 어휘 밖의 값은 쓸 수 없다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { aux } = visit.node
    const pairs: [string, string][] = [
      ...aux.subject.map((value): [string, string] => ['subject', value]),
      ...aux.topic.map((value): [string, string] => ['topic', value]),
      // since·until 은 날짜라 어휘가 없다. 어휘를 갖는 것만 본다.
      ...(['status', 'level'] as const).flatMap((key): [string, string][] => {
        const value = aux.lifecycle[key]
        return value === undefined ? [] : [[key, value]]
      }),
    ]

    return pairs
      .filter(([name, value]) => !context.schema.allowsValue(name, value))
      .map(([name, value]) =>
        context.report(
          this,
          `'${name}' 어휘에 없는 값입니다: ${value}`,
          visit,
          `쓸 수 있는 값: ${context.schema.vocabulary(name)?.values.join(' · ')}`,
        ),
      )
  }
}

/** AUX003 — 자손이 조상보다 강한 수명주기·강제 수준을 주장하지 않는가. */
export class StrengthNarrowing implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'AUX003'
  readonly severity = 'error' as const
  readonly principle = '자손은 조상보다 강하게 적용될 수 없다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const ancestors = inherited(visit.ancestors)
    const diagnostics: Diagnostic[] = []

    for (const key of ['status', 'level'] as const) {
      const declared = visit.node.aux.lifecycle[key]
      const above = ancestors.lifecycle[key]
      if (declared === undefined || above === undefined) continue
      const declaredRank = context.schema.rankOf(key, declared)
      const aboveRank = context.schema.rankOf(key, above)
      if (declaredRank === null || aboveRank === null) continue
      if (declaredRank >= aboveRank) continue
      diagnostics.push(
        context.report(
          this,
          `조상이 '${above}' 인데 '${declared}' 로 더 강하게 주장합니다 (${key})`,
          visit,
          '상위의 값을 먼저 올리세요',
        ),
      )
    }
    return diagnostics
  }
}

/** AUX004 — 안정 식별자가 문서 안에서 유일하고 섹션 키와 충돌하지 않는가. */
export class StableIdUniqueness implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'AUX004'
  readonly severity = 'error' as const
  readonly principle = '안정 주소는 한 노드만 가리킨다'

  run(context: CheckContext): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = []
    const seen = new Map<string, Visit>()
    const topLevelKeys = new Set(
      context.document.children
        .filter((child): child is Section => child.kind === 'section')
        .map((child) => child.key),
    )

    for (const visit of context.document.walk()) {
      const id = visit.node.stableId
      if (id === null) continue
      if (seen.has(id)) {
        diagnostics.push(
          context.report(this, `안정 식별자가 중복됩니다: ${id}`, visit, '문서 안에서 유일해야 합니다'),
        )
        continue
      }
      seen.set(id, visit)
      if (topLevelKeys.has(id)) {
        diagnostics.push(
          context.report(
            this,
            `안정 식별자가 최상위 섹션 키와 같습니다: ${id}`,
            visit,
            '`#id` 주소가 어느 쪽을 가리키는지 가릴 수 없게 됩니다. 다른 이름을 쓰세요',
          ),
        )
      }
    }
    return diagnostics
  }
}

/** AUX005 — 관계 링크의 대상 주소가 형식을 지키는가. */
export class RelationTargetForm implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'AUX005'
  readonly severity = 'error' as const
  readonly principle = '관계 링크의 대상은 주소 형식을 지킨다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    return visit.node.aux.relations
      .filter((relation) => !/^[^\s#]+\/[^\s#]+(?:#\S+)?$/.test(relation.target))
      .map((relation) =>
        context.report(
          this,
          `관계 대상이 주소 형식이 아닙니다: ${relation.target}`,
          visit,
          '`<컬렉션>/<문서>` 또는 `<컬렉션>/<문서>#<노드>` 로 적으세요',
        ),
      )
  }
}
