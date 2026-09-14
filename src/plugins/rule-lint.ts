import type { Root } from 'mdast'
import type { Plugin } from 'unified'
import type { VFile } from 'vfile'
import { SECTION_ORDER, SECTION_SPEC } from '../schema.js'
import type { Rule, RuleSection } from '../types.js'

export interface RuleLintOptions {
  /** 산문형 `## Rule` 섹션이 가질 수 있는 최대 문장 수. 기본 3. */
  maxStatementSentences?: number
  /** 열거형 `## Rule` 섹션이 가질 수 있는 최대 항목 수. 기본 8. */
  maxStatementClauses?: number
}

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?。])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)

function lintHeadings(tree: Root, file: VFile): void {
  for (const node of tree.children) {
    if (node.type !== 'heading') continue
    if (node.depth === 1) {
      file.message(
        'H1 은 사용하지 않습니다. 제목은 frontmatter.title 이 소유합니다',
        node,
        'rulekit:DOC001',
      )
    }
  }
}

function lintSections(sections: RuleSection[], file: VFile): void {
  const named = sections.filter((s) => s.key !== '')

  const preamble = sections.find((s) => s.key === '' && s.text.length > 0)
  if (preamble) {
    file.message(
      '첫 섹션 제목 앞에 본문이 있습니다. 모든 내용은 섹션 안에 있어야 합니다',
      undefined,
      'rulekit:DOC010',
    )
  }

  const seen = new Set<string>()
  for (const section of named) {
    if (section.depth !== 2) {
      file.message(
        `섹션 제목 '${section.heading}' 은 H2 여야 합니다`,
        undefined,
        'rulekit:DOC011',
      )
    }
    if (!SECTION_ORDER.includes(section.key)) {
      file.message(
        `알 수 없는 섹션 '${section.heading}'. 허용: ${SECTION_ORDER.join(', ')}`,
        undefined,
        'rulekit:DOC003',
      )
      continue
    }
    if (seen.has(section.key)) {
      file.message(
        `섹션 '${section.heading}' 이 중복됩니다`,
        undefined,
        'rulekit:DOC005',
      )
    }
    seen.add(section.key)
  }

  for (const spec of SECTION_SPEC) {
    if (spec.required && !seen.has(spec.key)) {
      const msg = file.message(
        `필수 섹션 '## ${spec.heading}' 이 없습니다`,
        undefined,
        'rulekit:DOC002',
      )
      msg.fatal = spec.key === 'rule'
    }
  }

  const known = named
    .map((s) => SECTION_ORDER.indexOf(s.key))
    .filter((i) => i >= 0)
  for (let i = 1; i < known.length; i += 1) {
    if (known[i]! < known[i - 1]!) {
      file.message(
        `섹션 순서가 규약과 다릅니다. 기대 순서: ${SECTION_ORDER.join(' → ')}`,
        undefined,
        'rulekit:DOC004',
      )
      break
    }
  }
}

function lintStatement(
  sections: RuleSection[],
  file: VFile,
  maxSentences: number,
  maxClauses: number,
): void {
  const rule = sections.find((s) => s.key === 'rule')
  if (!rule) return
  if (rule.text.length === 0) {
    file.message('## Rule 섹션이 비어 있습니다', undefined, 'rulekit:DOC006')
    return
  }
  // 규범 진술은 한 명제이거나 열거된 조항 묶음이다. 둘의 크기 예산은 다르다.
  if (rule.listItems > 0) {
    if (rule.listItems > maxClauses) {
      file.message(
        `규범 진술이 ${rule.listItems}개 조항입니다. ${maxClauses}개 이하로 나누세요`,
        undefined,
        'rulekit:DOC006',
      )
    }
    return
  }
  const count = sentences(rule.text).length
  if (count > maxSentences) {
    file.message(
      `규범 진술이 ${count}문장입니다. ${maxSentences}문장 이하로 줄이고 근거는 ## Why 로 옮기세요`,
      undefined,
      'rulekit:DOC006',
    )
  }
}

function lintCode(sections: RuleSection[], file: VFile): void {
  for (const section of sections) {
    for (const block of section.codeBlocks) {
      if (!block.lang) {
        file.message(
          '코드블록에 언어 태그가 없습니다',
          { line: block.line, column: 1 },
          'rulekit:DOC007',
        )
      }
    }
  }

  const examples = sections.find((s) => s.key === 'examples')
  if (!examples) return
  if (examples.codeBlocks.length === 0) {
    file.message(
      '## Examples 섹션에 코드블록이 없습니다',
      undefined,
      'rulekit:DOC008',
    )
    return
  }
  const polarities = new Set(examples.codeBlocks.flatMap((b) => b.markers))
  if (polarities.size === 1) {
    const only = [...polarities][0]
    file.message(
      `예시가 '${only}' 한쪽만 있습니다. // WRONG 과 // RIGHT 를 짝으로 보여주세요`,
      undefined,
      'rulekit:DOC009',
    )
  }
}

function lintLifecycle(rule: Rule, file: VFile): void {
  const { status, supersededBy } = rule.meta
  if (status === 'superseded' && !supersededBy) {
    file.message(
      "status: superseded 인 규칙은 superseded-by 를 지정해야 합니다",
      undefined,
      'rulekit:FM006',
    )
  }
  if (status !== 'superseded' && supersededBy) {
    file.message(
      "superseded-by 가 있으면 status 는 superseded 여야 합니다",
      undefined,
      'rulekit:FM006',
    )
  }
  if (status === 'active' && rule.meta.severity === 'error') {
    const hasEvidence =
      rule.sections.some((s) => s.key === 'why' && s.text.length > 0)
    if (!hasEvidence) {
      file.message(
        'severity: error 인 활성 규칙은 ## Why 에 근거가 있어야 합니다',
        undefined,
        'rulekit:DOC012',
      )
    }
  }
}

/**
 * 구조 규약을 검사하는 unified 플러그인.
 * `ruleExtract` 다음에 실행되어야 하며, 결과는 vfile 메시지로 남는다.
 */
export const ruleLint: Plugin<[RuleLintOptions?], Root> = (options = {}) => {
  const maxSentences = options.maxStatementSentences ?? 3
  const maxClauses = options.maxStatementClauses ?? 8
  return (tree, file) => {
    lintHeadings(tree, file)
    const sections = file.data.sections
    if (!sections) return
    lintSections(sections, file)
    lintStatement(sections, file, maxSentences, maxClauses)
    lintCode(sections, file)
    const rule = file.data.rule
    if (rule) lintLifecycle(rule, file)
  }
}
