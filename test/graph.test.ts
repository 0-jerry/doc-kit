import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectRules } from '../src/collect.js'
import { buildGraph, toMermaid } from '../src/graph.js'
import { buildIndex } from '../src/index-build.js'
import { validateRuleSet, findCycles } from '../src/validate.js'
import type { Rule, RuleSet } from '../src/types.js'
import { RULES_ROOT } from './helpers.js'

function stub(id: string, over: Partial<Rule['meta']> = {}): Rule {
  return {
    meta: {
      id,
      title: id,
      category: 'naming',
      severity: 'info',
      status: 'active',
      tags: [],
      appliesTo: [],
      enforcedBy: [],
      extends: [],
      related: [],
      conflicts: [],
      supersedes: [],
      ...over,
    },
    path: `naming/${id}.md`,
    statement: '',
    sections: [],
    digest: '000000000000',
  }
}

const setOf = (rules: Rule[]): RuleSet => ({
  root: RULES_ROOT,
  rules,
  files: [],
})

test('extends 순환을 찾는다', () => {
  const rules = [
    stub('a', { extends: ['b'] }),
    stub('b', { extends: ['c'] }),
    stub('c', { extends: ['a'] }),
  ]
  const cycles = findCycles(rules, 'extends')
  assert.equal(cycles.length, 1)
  assert.deepEqual([...cycles[0]!].sort(), ['a', 'b', 'c'])
})

test('끊긴 참조와 고립 노드를 표시한다', () => {
  const graph = buildGraph(setOf([stub('a', { related: ['ghost'] }), stub('b')]))
  assert.equal(graph.dangling.length, 1)
  assert.equal(graph.dangling[0]?.to, 'ghost')
  assert.deepEqual(graph.orphans, ['a', 'b'])
})

test('상속 깊이를 계산한다', () => {
  const graph = buildGraph(
    setOf([stub('base'), stub('mid', { extends: ['base'] }), stub('leaf', { extends: ['mid'] })]),
  )
  assert.deepEqual(graph.depth, { base: 0, mid: 1, leaf: 2 })
})

test('실제 규칙 모음은 lint·참조 검사를 통과한다', async () => {
  const set = validateRuleSet(await collectRules(RULES_ROOT))
  const messages = set.files.flatMap((f) => f.messages)
  assert.deepEqual(
    messages.map((m) => `${m.ruleId}: ${m.reason}`),
    [],
  )
  assert.ok(set.rules.length >= 7)
})

test('인덱스는 카테고리·태그·강제도구로 역인덱스를 만든다', async () => {
  const set = await collectRules(RULES_ROOT)
  const index = buildIndex(set)
  assert.equal(index.counts.total, set.rules.length)
  assert.ok(index.byCategory.naming?.includes('use-camel-case'))
  assert.ok(index.byTag.naming?.includes('bool-names'))
  assert.ok(index.byEnforcer['swiftlint:type_name']?.includes('use-camel-case'))
})

test('mermaid 출력은 카테고리별 서브그래프를 만든다', async () => {
  const graph = buildGraph(await collectRules(RULES_ROOT))
  const mmd = toMermaid(graph)
  assert.match(mmd, /^flowchart LR/)
  assert.match(mmd, /subgraph naming/)
  assert.match(mmd, /bool_names -->\|extends\| use_camel_case/)
})
