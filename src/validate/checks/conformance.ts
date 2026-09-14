/** 문서가 규약을 벗어나지 않는지 보는 검사기들 (원칙 P5). */

import type { Diagnostic } from '../../diagnostic/index.js'
import { Block, Section, type Visit } from '../../model/index.js'
import type { SectionSpec } from '../../schema/index.js'
import type { CheckContext, DocumentCheck, NodeCheck } from '../check.js'

/** SCH001 — 규약에 없는 섹션을 쓰지 않았는가. */
export class KnownSection implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'SCH001'
  readonly severity = 'error' as const
  readonly principle = '섹션 구성은 규약을 벗어날 수 없다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    if (!(node instanceof Section)) return []
    if (context.schema.sectionAt(context.document.type, context.sectionPath(visit)) !== null) {
      return []
    }
    return [
      context.report(
        this,
        `'${context.document.type}' 타입에 없는 섹션입니다: ${node.heading}`,
        visit,
        '규약의 sections 에 더하거나 제목을 규약에 맞추세요',
      ),
    ]
  }
}

/** SCH002 — 필수 섹션이 모두 있는가. */
export class RequiredSections implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'SCH002'
  readonly severity = 'error' as const
  readonly principle = '규약이 필수로 정한 섹션은 있어야 한다'

  run(context: CheckContext): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = []

    // 중첩 섹션도 required 를 가질 수 있으므로 층마다 내려가며 본다.
    const visit = (
      specs: readonly SectionSpec[],
      sections: readonly Section[],
      under: string | null,
    ): void => {
      const present = new Map<string, Section[]>()
      for (const section of sections) {
        present.set(section.key, [...(present.get(section.key) ?? []), section])
      }
      for (const spec of specs) {
        const found = present.get(spec.key) ?? []
        if (spec.required && found.length === 0) {
          const where = under === null ? '' : ` ('${under}' 아래)`
          diagnostics.push(
            context.report(
              this,
              `필수 섹션이 없습니다: ${spec.heading}${where}`,
              null,
              `'${'#'.repeat(under === null ? 2 : 3)} ${spec.heading}' 을 더하세요`,
            ),
          )
        }
        for (const section of found) visit(spec.sections, section.sections, spec.heading)
      }
    }

    visit(context.schema.sectionsOf(context.document.type), context.document.sections, null)
    return diagnostics
  }
}

/** SCH003 — 섹션 순서가 규약을 따르는가. */
export class SectionOrder implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'SCH003'
  readonly severity = 'error' as const
  readonly principle = '섹션 순서는 규약을 따른다'

  run(context: CheckContext): readonly Diagnostic[] {
    const type = context.schema.documentType(context.document.type)
    if (type === null || type.order !== 'strict') return []

    const expected = type.sections.map((spec) => spec.key)
    const rank = new Map(expected.map((key, index) => [key, index]))
    const diagnostics: Diagnostic[] = []
    let highest = -1

    for (const section of context.document.sections) {
      const position = rank.get(section.key)
      if (position === undefined) continue // 규약 밖 섹션은 SCH001 이 본다
      if (position < highest) {
        diagnostics.push(
          context.report(
            this,
            `'${section.heading}' 섹션이 규약 순서보다 뒤에 있습니다`,
            null,
            `순서: ${expected.join(' → ')}`,
          ),
        )
      }
      highest = Math.max(highest, position)
    }
    return diagnostics
  }
}

/** SCH004 — 반복할 수 없는 섹션이 거듭 쓰이지 않았는가. */
export class SectionRepetition implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'SCH004'
  readonly severity = 'error' as const
  readonly principle = '규약이 허락하지 않은 섹션은 한 번만 쓴다'

  run(context: CheckContext): readonly Diagnostic[] {
    const counts = new Map<string, number>()
    for (const visit of context.document.walk()) {
      if (!(visit.node instanceof Section)) continue
      const path = context.sectionPath(visit).join('/')
      counts.set(path, (counts.get(path) ?? 0) + 1)
    }
    const diagnostics: Diagnostic[] = []
    for (const [path, count] of counts) {
      if (count < 2) continue
      const spec = context.schema.sectionAt(context.document.type, path.split('/'))
      if (spec === null || spec.repeatable) continue
      diagnostics.push(
        context.report(
          this,
          `'${spec.heading}' 섹션이 ${count} 번 쓰였습니다`,
          null,
          '규약에서 repeatable 로 선언하거나 하나로 합치세요',
        ),
      )
    }
    return diagnostics
  }
}

/** SCH005 — 규약이 아는 역할만 쓰는가. */
export class KnownRole implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'SCH005'
  readonly severity = 'error' as const
  readonly principle = '역할은 규약이 선언한 것만 쓴다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const role = visit.node.aux.role
    if (role === undefined || context.schema.role(role) !== null) return []
    return [
      context.report(
        this,
        `규약에 없는 역할입니다: ${role}`,
        visit,
        `쓸 수 있는 역할: ${context.schema.roleNames.join(' · ')}`,
      ),
    ]
  }
}

/** SCH006 — 섹션이 허용한 역할인가. */
export class AllowedRole implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'SCH006'
  readonly severity = 'error' as const
  readonly principle = '섹션은 규약이 허용한 역할만 담는다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    if (!(node instanceof Block) || node.aux.role === undefined) return []
    const spec = context.schema.sectionAt(context.document.type, context.sectionPath(visit))
    const allowed = spec?.allowedRoles
    if (allowed === undefined || allowed.includes(node.aux.role)) return []
    return [
      context.report(
        this,
        `'${spec?.heading}' 섹션에 쓸 수 없는 역할입니다: ${node.aux.role}`,
        visit,
        `허용된 역할: ${allowed.join(' · ')}`,
      ),
    ]
  }
}

/** SCH007 — 역할이 요구하는 블록 형태인가. */
export class RoleForm implements NodeCheck {
  readonly kind = 'node' as const
  readonly code = 'SCH007'
  readonly severity = 'error' as const
  readonly principle = '역할이 요구하는 형태로만 쓴다'

  run(visit: Visit, context: CheckContext): readonly Diagnostic[] {
    const { node } = visit
    if (!(node instanceof Block) || node.aux.role === undefined) return []
    const forms = context.schema.role(node.aux.role)?.forms
    if (forms === undefined || forms.includes(node.form)) return []
    return [
      context.report(
        this,
        `'${node.aux.role}' 역할은 ${forms.join(' · ')} 형태여야 하는데 ${node.form} 입니다`,
        visit,
      ),
    ]
  }
}

/** SCH008 — 규약이 아는 문서 타입인가. */
export class KnownDocumentType implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'SCH008'
  readonly severity = 'error' as const
  readonly principle = '문서 타입은 규약이 선언한 것만 쓴다'

  run(context: CheckContext): readonly Diagnostic[] {
    if (context.schema.documentType(context.document.type) !== null) return []
    return [
      context.report(
        this,
        `규약에 없는 문서 타입입니다: ${context.document.type}`,
        null,
        `쓸 수 있는 타입: ${context.schema.documentTypeNames.join(' · ')}`,
      ),
    ]
  }
}

/** SCH009 — 파일 이름과 문서 식별자가 같은가. */
export class FileNameMatchesId implements DocumentCheck {
  readonly kind = 'document' as const
  readonly code = 'SCH009'
  readonly severity = 'error' as const
  readonly principle = '이름만 보고 문서를 찾을 수 있어야 한다'

  run(context: CheckContext): readonly Diagnostic[] {
    const { document } = context
    const segments = document.path.split('/')
    /*
     * 식별자는 파일 이름이거나 그것을 담은 디렉터리 이름이어야 한다.
     * 한 파일에 담긴 문서는 앞쪽이, 노드 디렉터리로 흩어진 문서는 뒤쪽이 정체성을 진다.
     * 검사기는 저장 형태를 알 필요 없이 둘 중 하나만 맞으면 된다고 본다.
     */
    const fileName = (segments[segments.length - 1] ?? '').replace(/\.md$/, '')
    const directoryName = segments[segments.length - 2] ?? ''
    const name = document.id.slice(document.id.indexOf('/') + 1)
    if (fileName === '' || fileName === name || directoryName === name) return []
    return [
      context.report(
        this,
        `이름(${fileName})과 문서 식별자(${name})가 다릅니다`,
        null,
        `파일이나 담긴 디렉터리를 ${name} 로 바꾸거나 frontmatter 의 id 를 고치세요`,
      ),
    ]
  }
}
