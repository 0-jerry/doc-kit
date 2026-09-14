import type { RelationKind, Rule, RuleSet, RuleStatus, Severity } from './types.js'
import { findCycles } from './validate.js'

export interface GraphNode {
  id: string
  title: string
  category: string
  severity: Severity
  status: RuleStatus
  tags: string[]
  path: string
  degree: { in: number; out: number }
}

export interface GraphEdge {
  from: string
  to: string
  kind: RelationKind
  /** 대상 규칙이 존재하지 않는 간선. */
  dangling: boolean
}

export interface RuleGraph {
  schemaVersion: 1
  generatedAt: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 어떤 간선에도 닿지 않는 규칙. 고립된 규칙은 대개 분류가 잘못된 신호다. */
  orphans: string[]
  /** extends 관계의 순환. */
  cycles: string[][]
  dangling: GraphEdge[]
  /** extends 를 따라 계산한 상속 깊이. 루트는 0. */
  depth: Record<string, number>
}

const RELATIONS: { kind: RelationKind; pick: (r: Rule) => string[] }[] = [
  { kind: 'extends', pick: (r) => r.meta.extends },
  { kind: 'related', pick: (r) => r.meta.related },
  { kind: 'conflicts', pick: (r) => r.meta.conflicts },
  { kind: 'supersedes', pick: (r) => r.meta.supersedes },
  {
    kind: 'supersededBy',
    pick: (r) => (r.meta.supersededBy ? [r.meta.supersededBy] : []),
  },
]

/** 규칙 모음을 방향 그래프로 환원한다. 순환·고아·끊긴 링크가 함께 계산된다. */
export function buildGraph(set: RuleSet): RuleGraph {
  const ids = new Set(set.rules.map((r) => r.meta.id))
  const edges: GraphEdge[] = []

  for (const rule of set.rules) {
    for (const { kind, pick } of RELATIONS) {
      for (const to of pick(rule)) {
        edges.push({ from: rule.meta.id, to, kind, dangling: !ids.has(to) })
      }
    }
  }

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const edge of edges) {
    if (edge.dangling) continue
    outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1)
    inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1)
  }

  const nodes: GraphNode[] = set.rules.map((rule) => ({
    id: rule.meta.id,
    title: rule.meta.title,
    category: rule.meta.category,
    severity: rule.meta.severity,
    status: rule.meta.status,
    tags: rule.meta.tags,
    path: rule.path,
    degree: {
      in: inDeg.get(rule.meta.id) ?? 0,
      out: outDeg.get(rule.meta.id) ?? 0,
    },
  }))

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    orphans: nodes
      .filter((n) => n.degree.in === 0 && n.degree.out === 0)
      .map((n) => n.id),
    cycles: findCycles(set.rules, 'extends'),
    dangling: edges.filter((e) => e.dangling),
    depth: computeDepth(set.rules),
  }
}

function computeDepth(rules: Rule[]): Record<string, number> {
  const parents = new Map(rules.map((r) => [r.meta.id, r.meta.extends]))
  const depth: Record<string, number> = {}
  const resolving = new Set<string>()

  const of = (id: string): number => {
    if (depth[id] !== undefined) return depth[id]!
    if (resolving.has(id)) return 0
    resolving.add(id)
    const ps = (parents.get(id) ?? []).filter((p) => parents.has(p))
    const value = ps.length === 0 ? 0 : Math.max(...ps.map(of)) + 1
    resolving.delete(id)
    depth[id] = value
    return value
  }

  for (const rule of rules) of(rule.meta.id)
  return depth
}

const ARROW: Record<RelationKind, string> = {
  extends: '-->|extends|',
  related: '-.->|related|',
  conflicts: '---|conflicts|',
  supersedes: '==>|supersedes|',
  supersededBy: '-.->|superseded by|',
}

/** 그래프를 Mermaid 플로차트로 직렬화한다. 카테고리는 서브그래프로 묶인다. */
export function toMermaid(graph: RuleGraph): string {
  const lines = ['flowchart LR']
  const byCategory = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) {
    const list = byCategory.get(node.category) ?? []
    list.push(node)
    byCategory.set(node.category, list)
  }

  for (const [category, nodes] of [...byCategory].sort()) {
    lines.push(`  subgraph ${category}`)
    for (const node of nodes) {
      const mark = node.status === 'active' ? '' : ` (${node.status})`
      lines.push(`    ${safe(node.id)}["${escape(node.title)}${mark}"]`)
    }
    lines.push('  end')
  }

  for (const edge of graph.edges) {
    if (edge.dangling) continue
    lines.push(`  ${safe(edge.from)} ${ARROW[edge.kind]} ${safe(edge.to)}`)
  }
  return lines.join('\n')
}

/** 그래프를 DOT 으로 직렬화한다(Graphviz). */
export function toDot(graph: RuleGraph): string {
  const lines = ['digraph rules {', '  rankdir=LR;', '  node [shape=box];']
  for (const node of graph.nodes) {
    lines.push(`  ${safe(node.id)} [label="${escape(node.title)}"];`)
  }
  for (const edge of graph.edges) {
    if (edge.dangling) continue
    lines.push(`  ${safe(edge.from)} -> ${safe(edge.to)} [label="${edge.kind}"];`)
  }
  lines.push('}')
  return lines.join('\n')
}

const safe = (id: string): string => id.replace(/[^a-zA-Z0-9_]/g, '_')
const escape = (text: string): string => text.replace(/"/g, "'")
