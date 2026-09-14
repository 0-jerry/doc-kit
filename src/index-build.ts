import type { Rule, RuleSet } from './types.js'

export interface IndexedRule {
  id: string
  title: string
  summary?: string
  category: string
  severity: Rule['meta']['severity']
  status: Rule['meta']['status']
  since?: string
  tags: string[]
  appliesTo: string[]
  scope: Record<string, string[]>
  enforcedBy: { tool: string; rule?: string }[]
  statement: string
  sections: { key: string; heading: string; text: string }[]
  examples: {
    polarity: 'right' | 'wrong' | null
    lang: string | null
    value: string
  }[]
  relations: {
    extends: string[]
    related: string[]
    conflicts: string[]
    supersedes: string[]
    supersededBy?: string
  }
  path: string
  digest: string
}

export interface RuleIndex {
  schemaVersion: 1
  generatedAt: string
  root: string
  counts: {
    total: number
    byCategory: Record<string, number>
    bySeverity: Record<string, number>
    byStatus: Record<string, number>
  }
  byCategory: Record<string, string[]>
  byTag: Record<string, string[]>
  /** 적용 범위 차원 → 값 → 규칙 id. 프로젝트가 정의한 축으로 좁혀 볼 때 쓴다. */
  byScope: Record<string, Record<string, string[]>>
  /** 자동 강제 도구 → 규칙 id. 린터 설정과 문서가 어긋나는지 대조할 때 쓴다. */
  byEnforcer: Record<string, string[]>
  rules: IndexedRule[]
}

function push(map: Record<string, string[]>, key: string, id: string): void {
  ;(map[key] ??= []).push(id)
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

/** 검증된 규칙 모음을 조회·탐색용 인덱스로 직렬화한다. */
export function buildIndex(set: RuleSet): RuleIndex {
  const byCategory: Record<string, string[]> = {}
  const byTag: Record<string, string[]> = {}
  const byScope: Record<string, Record<string, string[]>> = {}
  const byEnforcer: Record<string, string[]> = {}
  const counts = {
    total: set.rules.length,
    byCategory: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
  }

  const rules: IndexedRule[] = set.rules.map((rule) => {
    const { meta } = rule
    push(byCategory, meta.category, meta.id)
    for (const tag of meta.tags) push(byTag, tag, meta.id)
    for (const [dimension, values] of Object.entries(meta.scope)) {
      byScope[dimension] ??= {}
      for (const value of values) push(byScope[dimension]!, value, meta.id)
    }
    for (const e of meta.enforcedBy) {
      push(byEnforcer, e.rule ? `${e.tool}:${e.rule}` : e.tool, meta.id)
    }
    bump(counts.byCategory, meta.category)
    bump(counts.bySeverity, meta.severity)
    bump(counts.byStatus, meta.status)

    return {
      id: meta.id,
      title: meta.title,
      summary: meta.summary,
      category: meta.category,
      severity: meta.severity,
      status: meta.status,
      since: meta.since,
      tags: meta.tags,
      appliesTo: meta.appliesTo,
      scope: meta.scope,
      enforcedBy: meta.enforcedBy,
      statement: rule.statement,
      sections: rule.sections
        .filter((s) => s.key !== '')
        .map((s) => ({ key: s.key, heading: s.heading, text: s.text })),
      examples: rule.sections
        .flatMap((s) => s.codeBlocks)
        .map((b) => ({ polarity: b.polarity, lang: b.lang, value: b.value })),
      relations: {
        extends: meta.extends,
        related: meta.related,
        conflicts: meta.conflicts,
        supersedes: meta.supersedes,
        supersededBy: meta.supersededBy,
      },
      path: rule.path,
      digest: rule.digest,
    }
  })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: set.root,
    counts,
    byCategory,
    byTag,
    byScope,
    byEnforcer,
    rules,
  }
}
