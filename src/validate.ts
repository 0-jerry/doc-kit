import type { VFile } from 'vfile'
import type { RelationKind, Rule, RuleSet } from './types.js'

/** 참조를 따라갈 수 있는 관계와, 그것을 담고 있는 메타 필드. */
const REFERENCE_FIELDS: { kind: RelationKind; field: keyof Rule['meta'] }[] = [
  { kind: 'extends', field: 'extends' },
  { kind: 'related', field: 'related' },
  { kind: 'conflicts', field: 'conflicts' },
  { kind: 'supersedes', field: 'supersedes' },
  { kind: 'supersededBy', field: 'supersededBy' },
]

function referencesOf(rule: Rule, field: keyof Rule['meta']): string[] {
  const value = rule.meta[field]
  if (Array.isArray(value)) return value as string[]
  return typeof value === 'string' ? [value] : []
}

function fileOf(set: RuleSet, rule: Rule): VFile | undefined {
  return set.files.find((f) => f.data.rule?.meta.id === rule.meta.id)
}

/**
 * 파일 하나만 봐서는 알 수 없는 규칙 간 무결성을 검사한다.
 * 발견된 문제는 해당 규칙의 vfile 메시지로 붙는다.
 */
export function validateRuleSet(set: RuleSet): RuleSet {
  const byId = new Map<string, Rule[]>()
  for (const rule of set.rules) {
    const list = byId.get(rule.meta.id) ?? []
    list.push(rule)
    byId.set(rule.meta.id, list)
  }

  for (const [id, rules] of byId) {
    if (rules.length < 2) continue
    for (const rule of rules) {
      const others = rules.filter((r) => r !== rule).map((r) => r.path)
      fileOf(set, rule)?.message(
        `id '${id}' 가 중복됩니다: ${others.join(', ')}`,
        undefined,
        'rulekit:REF003',
      )
    }
  }

  for (const rule of set.rules) {
    const file = fileOf(set, rule)
    for (const { kind, field } of REFERENCE_FIELDS) {
      for (const target of referencesOf(rule, field)) {
        if (target === rule.meta.id) {
          file?.message(
            `${kind} 가 자기 자신을 가리킵니다`,
            undefined,
            'rulekit:REF002',
          )
          continue
        }
        const found = byId.get(target)?.[0]
        if (!found) {
          file?.message(
            `${kind}: '${target}' 규칙을 찾을 수 없습니다`,
            undefined,
            'rulekit:REF001',
          )
          continue
        }
        if (
          rule.meta.status === 'active' &&
          kind !== 'supersedes' &&
          (found.meta.status === 'deprecated' ||
            found.meta.status === 'superseded')
        ) {
          file?.message(
            `${kind}: '${target}' 는 ${found.meta.status} 상태입니다`,
            undefined,
            'rulekit:REF005',
          )
        }
      }
    }

    for (const target of rule.meta.conflicts) {
      const other = byId.get(target)?.[0]
      if (other && !other.meta.conflicts.includes(rule.meta.id)) {
        file?.message(
          `conflicts 가 단방향입니다. '${target}' 에도 conflicts: [${rule.meta.id}] 를 추가하세요`,
          undefined,
          'rulekit:REF006',
        )
      }
    }

    if (rule.meta.supersededBy) {
      const other = byId.get(rule.meta.supersededBy)?.[0]
      if (other && !other.meta.supersedes.includes(rule.meta.id)) {
        file?.message(
          `superseded-by 가 단방향입니다. '${other.meta.id}' 에 supersedes: [${rule.meta.id}] 를 추가하세요`,
          undefined,
          'rulekit:REF007',
        )
      }
    }
  }

  for (const cycle of findCycles(set.rules, 'extends')) {
    const head = byId.get(cycle[0]!)?.[0]
    if (head) {
      fileOf(set, head)?.message(
        `extends 관계에 순환이 있습니다: ${[...cycle, cycle[0]].join(' → ')}`,
        undefined,
        'rulekit:REF004',
      )
    }
  }

  return set
}

/** 주어진 관계 필드에서 순환을 찾는다. 각 순환은 한 번만 보고된다. */
export function findCycles(
  rules: Rule[],
  field: 'extends' | 'supersedes',
): string[][] {
  const edges = new Map<string, string[]>(
    rules.map((r) => [r.meta.id, r.meta[field]]),
  )
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cycles: string[][] = []
  const seen = new Set<string>()

  const visit = (id: string): void => {
    const current = state.get(id) ?? 0
    if (current === 1) {
      const start = stack.indexOf(id)
      const cycle = stack.slice(start)
      const key = [...cycle].sort().join('|')
      if (!seen.has(key)) {
        seen.add(key)
        cycles.push(cycle)
      }
      return
    }
    if (current === 2) return
    state.set(id, 1)
    stack.push(id)
    for (const next of edges.get(id) ?? []) {
      if (edges.has(next)) visit(next)
    }
    stack.pop()
    state.set(id, 2)
  }

  for (const rule of rules) visit(rule.meta.id)
  return cycles
}
