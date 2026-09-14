import fs from 'node:fs/promises'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { slugifyHeading } from './schema.js'
import type { EnforcementRef, Severity } from './types.js'

/**
 * 단일 파일 스타일 가이드를 규칙 파일로 분해한다.
 *
 * 대상 규약은 Airbnb 계열 스타일 가이드가 공유하는 형태다.
 *   `- <a id='rule-id'></a>(<a href='#rule-id'>link</a>) **규범 진술.** 부연`
 * 이어지는 `<details>` 블록에 예시 코드와 `#### Why?` 근거가 들어간다.
 */
export interface ImportOptions {
  /** 원문 파일 경로. */
  source: string
  /** 규칙 파일을 쓸 루트. */
  out: string
  /** 원문을 가리키는 링크의 기준 경로. `## References` 에 남긴다. */
  sourceLink?: string
  /** 실제로 파일을 쓰지 않고 계획만 돌려준다. */
  dryRun?: boolean
}

export interface ImportedRule {
  id: string
  title: string
  category: string
  tags: string[]
  severity: Severity
  enforcedBy: EnforcementRef[]
  related: string[]
  aliases: string[]
  /** 원문에서의 앵커 이름. id 를 정규화해도 원문 링크는 이것을 써야 한다. */
  sourceAnchor: string
  statement: string
  why: string
  examples: string
  exceptions: string
  sourceLine: number
  targetPath: string
}

export interface ImportReport {
  source: string
  out: string
  rules: ImportedRule[]
  /** 앵커는 있으나 규범 진술을 뽑지 못한 항목. */
  skipped: { line: number; reason: string; text: string }[]
  categories: string[]
}

const RULE_START = /^[-*]\s+<a id='([^']+)'>/

/** 앵커 이름을 규약상의 kebab-case id 로 정규화한다. `forEach` → `for-each`. */
export function toKebabId(anchor: string): string {
  return anchor
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
const ANCHOR = /<a id='([^']+)'><\/a>/g
const HEADING = /^(#{1,4})\s+(.*)$/
const BADGE = /\[!\[(SwiftFormat|SwiftLint|swiftformat|swiftlint):\s*([^\]]+)\]\([^)]*\)\]\([^)]*\)/g
const CROSS_LINK = /\[[^\]]*\]\(#([a-z0-9-]+)\)/g
const EXCEPTION = /^_Exceptions?:\s*([\s\S]*?)_$/

/** 첫 줄에서 규범 진술(굵은 글씨)과 그 뒤 부연을 분리한다. */
function splitStatement(line: string): { statement: string; trailing: string } | null {
  // 앵커와 `(link)` 표식을 통째로 걷어내면 남는 것이 규범 진술이다.
  const withoutLink = line
    .replace(/^[-*]\s+/, '')
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/^\s*\(\s*\)\s*/, '')
    .trimStart()
  const bold = /^\*\*([\s\S]*?)\*\*\s*/.exec(withoutLink)
  if (!bold) return null
  return {
    statement: bold[1]!.trim(),
    trailing: withoutLink.slice(bold[0]!.length).trim(),
  }
}

/** 마크다운 강조를 걷어내 제목으로 쓸 평문을 만든다. */
function toTitle(statement: string): string {
  const plain = statement
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const firstSentence = /^(.*?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain
  const candidate = firstSentence.replace(/[.]$/, '')
  return candidate.length <= 120 ? candidate : `${candidate.slice(0, 119)}…`
}

/** `<details>` 안쪽의 2칸 들여쓰기를 제거한다. */
function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => /^\s*/.exec(l)![0].length)
  if (indents.length === 0) return lines
  const min = Math.min(...indents)
  return lines.map((l) => (l.trim().length === 0 ? '' : l.slice(min)))
}

function trimBlank(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') start += 1
  while (end > start && lines[end - 1]!.trim() === '') end -= 1
  return lines.slice(start, end)
}

/** 본문에서 배지를 걷어내고 강제 도구 참조로 환원한다. */
function extractEnforcement(text: string): EnforcementRef[] {
  const refs: EnforcementRef[] = []
  for (const match of text.matchAll(BADGE)) {
    refs.push({ tool: match[1]!.toLowerCase(), rule: match[2]!.trim() })
  }
  return refs
}

interface Body {
  why: string[]
  examples: string[]
  exceptions: string[]
}

/**
 * 규칙 본문을 섹션별로 나눈다.
 * `#### Why?` 이후는 근거, 그 앞의 코드가 있는 구간은 예시,
 * `_Exception:_` 문단은 예외로 보낸다.
 */
function splitBody(lines: string[]): Body {
  const clean = dedent(lines).filter((line) => {
    if (line.trim() === '') return true
    if (/^\s*<\/?(details|summary)/.test(line)) return false
    // 배지만 있는 줄은 enforced-by 로 이미 환원했으므로 본문에서 뺀다.
    return line.replace(BADGE, '').trim() !== ''
  })

  const whyAt = clean.findIndex((l) => /^#{3,4}\s*Why\??/i.test(l.trim()))
  const head = whyAt >= 0 ? clean.slice(0, whyAt) : clean
  const tail = whyAt >= 0 ? clean.slice(whyAt + 1) : []

  const exceptions: string[] = []
  const rest: string[] = []
  for (const line of head) {
    if (EXCEPTION.test(line.trim())) {
      exceptions.push(line.trim().replace(EXCEPTION, '$1').trim())
    } else {
      rest.push(line)
    }
  }

  // 코드가 없는 앞구간은 예시가 아니라 부연이므로 근거로 합친다.
  const hasCode = rest.some((l) => l.trimStart().startsWith('```'))
  const why = hasCode ? tail : [...rest, '', ...tail]
  return {
    why: trimBlank(why),
    examples: hasCode ? trimBlank(rest) : [],
    exceptions: trimBlank(exceptions),
  }
}

/** 강제 도구가 있으면 빌드가 깨지므로 error, 아니면 리뷰 대상이므로 warning. */
function severityOf(enforcedBy: EnforcementRef[]): Severity {
  return enforcedBy.length > 0 ? 'error' : 'warning'
}

function renderRule(rule: ImportedRule, sourceLink?: string): string {
  const meta: Record<string, unknown> = {
    id: rule.id,
    title: rule.title,
    category: rule.category,
    severity: rule.severity,
    status: 'active',
  }
  if (rule.tags.length > 0) meta.tags = rule.tags
  if (rule.enforcedBy.length > 0) {
    meta['enforced-by'] = rule.enforcedBy.map((e) =>
      e.rule ? `${e.tool}:${e.rule}` : e.tool,
    )
  }
  if (rule.related.length > 0) meta.related = rule.related

  const parts = [
    `---\n${stringifyYaml(meta).trimEnd()}\n---`,
    `## Rule\n\n${rule.statement}`,
  ]
  if (rule.why) parts.push(`## Why\n\n${rule.why}`)
  if (rule.examples) parts.push(`## Examples\n\n${rule.examples}`)
  if (rule.exceptions) parts.push(`## Exceptions\n\n${rule.exceptions}`)

  const references = [
    sourceLink
      ? `- 원문: [${path.basename(sourceLink)}#${rule.sourceAnchor}](${sourceLink}#${rule.sourceAnchor}) (L${rule.sourceLine})`
      : `- 원문 라인: L${rule.sourceLine}`,
    ...rule.aliases.map((a) => `- 별칭 앵커: \`#${a}\``),
  ]
  parts.push(`## References\n\n${references.join('\n')}`)

  return `${parts.join('\n\n')}\n`
}

/** 단일 파일 가이드를 읽어 규칙 파일 트리로 분해한다. */
export async function importGuide(options: ImportOptions): Promise<ImportReport> {
  const source = path.resolve(options.source)
  const out = path.resolve(options.out)
  const text = await fs.readFile(source, 'utf8')
  const lines = text.split('\n')

  const rules: ImportedRule[] = []
  const skipped: ImportReport['skipped'] = []
  let h2 = ''
  let h3 = ''
  let inFence = false

  /** 규칙 하나의 시작 인덱스들을 훑으며 구간을 잘라 낸다. */
  const starts: { index: number; h2: string; h3: string }[] = []
  for (const [index, raw] of lines.entries()) {
    const line = raw ?? ''
    if (line.trimStart().startsWith('```')) inFence = !inFence
    if (inFence) continue
    const heading = HEADING.exec(line)
    if (heading) {
      const depth = heading[1]!.length
      if (depth === 2) {
        h2 = heading[2]!.trim()
        h3 = ''
      } else if (depth === 3) {
        h3 = heading[2]!.trim()
      }
      continue
    }
    if (RULE_START.test(line)) starts.push({ index, h2, h3 })
  }

  for (const [i, start] of starts.entries()) {
    const firstLine = lines[start.index]!
    const endExclusive = findEnd(lines, start.index, starts[i + 1]?.index ?? lines.length)
    const bodyLines = lines.slice(start.index + 1, endExclusive)

    const anchors = [...firstLine.matchAll(ANCHOR)].map((m) => m[1]!)
    const rawId = anchors[0] ?? RULE_START.exec(firstLine)![1]!
    const id = toKebabId(rawId)
    const aliases = [
      ...anchors.slice(1),
      ...(id === rawId ? [] : [rawId]),
    ]
    const parsed = splitStatement(firstLine)
    if (!parsed) {
      skipped.push({
        line: start.index + 1,
        reason: '규범 진술(굵은 글씨)을 찾지 못했습니다',
        text: firstLine.slice(0, 120),
      })
      continue
    }

    const bodyText = bodyLines.join('\n')
    const enforcedBy = [
      ...extractEnforcement(firstLine),
      ...extractEnforcement(bodyText),
    ]
    const body = splitBody(bodyLines)
    const why = trimBlank([
      ...(parsed.trailing ? [parsed.trailing, ''] : []),
      ...body.why,
    ]).join('\n')

    const related = [
      ...new Set(
        [...bodyText.matchAll(CROSS_LINK), ...firstLine.matchAll(CROSS_LINK)]
          .map((m) => m[1]!)
          .filter((target) => target !== rawId && !anchors.includes(target)),
      ),
    ]

    const category = slugifyHeading(start.h2) || 'general'
    const tags = start.h3 ? [slugifyHeading(start.h3)] : []

    rules.push({
      id,
      title: toTitle(parsed.statement),
      category,
      tags,
      severity: severityOf(enforcedBy),
      enforcedBy: dedupe(enforcedBy),
      related,
      aliases,
      sourceAnchor: rawId,
      statement: stripBadges(parsed.statement),
      why: stripBadges(why),
      examples: body.examples.join('\n'),
      exceptions: stripBadges(body.exceptions.join('\n')),
      sourceLine: start.index + 1,
      targetPath: path.join(out, category, `${id}.md`),
    })
  }

  // 상호 참조는 실제로 수입된 규칙으로만 좁힌다.
  const known = new Set(rules.map((r) => r.id))
  const aliasMap = new Map<string, string>()
  for (const rule of rules) {
    for (const alias of rule.aliases) aliasMap.set(toKebabId(alias), rule.id)
  }
  for (const rule of rules) {
    rule.related = [
      ...new Set(
        rule.related
          .map((r) => aliasMap.get(toKebabId(r)) ?? toKebabId(r))
          .filter((r) => known.has(r) && r !== rule.id),
      ),
    ]
  }

  if (!options.dryRun) {
    await fs.mkdir(out, { recursive: true })
    for (const rule of rules) {
      await fs.mkdir(path.dirname(rule.targetPath), { recursive: true })
      await fs.writeFile(rule.targetPath, renderRule(rule, options.sourceLink))
    }
  }

  return {
    source,
    out,
    rules,
    skipped,
    categories: [...new Set(rules.map((r) => r.category))].sort(),
  }
}

/** 다음 규칙 또는 다음 제목 중 먼저 오는 곳에서 구간을 끊는다. */
function findEnd(lines: string[], from: number, limit: number): number {
  let inFence = false
  for (let i = from + 1; i < limit; i += 1) {
    const line = lines[i] ?? ''
    if (line.trimStart().startsWith('```')) inFence = !inFence
    if (inFence) continue
    if (/^#{1,3}\s+/.test(line)) return i
  }
  return limit
}

function dedupe(refs: EnforcementRef[]): EnforcementRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const key = `${r.tool}:${r.rule ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const stripBadges = (text: string): string =>
  text.replace(BADGE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
