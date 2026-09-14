import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { VFile } from 'vfile'
import { validateRuleSet } from '../src/validate.js'
import type { Rule, RuleSet } from '../src/types.js'
import { RULES_ROOT } from './helpers.js'

function ruleOf(id: string, over: Partial<Rule['meta']> = {}): Rule {
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

function setOf(rules: Rule[]): RuleSet {
  const files = rules.map((rule) => {
    const file = new VFile({ path: path.join(RULES_ROOT, rule.path), value: '' })
    file.data.rule = rule
    return file
  })
  return { root: RULES_ROOT, rules, files }
}

const codesOf = (set: RuleSet): string[] =>
  set.files.flatMap((f) => f.messages.map((m) => m.ruleId ?? ''))

test('존재하지 않는 참조를 잡는다', () => {
  const set = validateRuleSet(setOf([ruleOf('a', { related: ['ghost'] })]))
  assert.ok(codesOf(set).includes('REF001'))
})

test('자기 참조를 잡는다', () => {
  const set = validateRuleSet(setOf([ruleOf('a', { extends: ['a'] })]))
  assert.ok(codesOf(set).includes('REF002'))
})

test('deprecated 규칙을 참조하면 경고한다', () => {
  const set = validateRuleSet(
    setOf([ruleOf('a', { extends: ['b'] }), ruleOf('b', { status: 'deprecated' })]),
  )
  assert.ok(codesOf(set).includes('REF005'))
})

test('conflicts 단방향을 잡는다', () => {
  const set = validateRuleSet(
    setOf([ruleOf('a', { conflicts: ['b'] }), ruleOf('b')]),
  )
  assert.ok(codesOf(set).includes('REF006'))
})

test('superseded-by 단방향을 잡는다', () => {
  const set = validateRuleSet(
    setOf([
      ruleOf('a', { status: 'superseded', supersededBy: 'b' }),
      ruleOf('b'),
    ]),
  )
  assert.ok(codesOf(set).includes('REF007'))
})

test('extends 순환을 보고한다', () => {
  const set = validateRuleSet(
    setOf([ruleOf('a', { extends: ['b'] }), ruleOf('b', { extends: ['a'] })]),
  )
  assert.ok(codesOf(set).includes('REF004'))
})
