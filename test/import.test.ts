import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { collectRules } from '../src/collect.js'
import { importGuide, toKebabId } from '../src/import.js'
import { validateRuleSet } from '../src/validate.js'

const GUIDE = `# Guide

## Naming

- <a id='use-camel-case'></a>(<a href='#use-camel-case'>link</a>) **Use UpperCamelCase for types.** Consistency with the standard library.

  [![SwiftFormat: typeNames](https://img.shields.io/badge/x)](https://swiftformat.info/rules#typeNames)

  <details>

  \`\`\`swift
  // WRONG
  class spaceFleet { }

  // RIGHT
  class SpaceFleet { }
  \`\`\`

  _Exception: underscore-prefixed backing properties are allowed._

  #### Why?

  Casing tells the reader whether a name is a type or a value.

  </details>

- <a id='prefer-forEach'></a>(<a href='#prefer-forEach'>link</a>) **Prefer \`forEach\` here.**

  See also [camel case](#use-camel-case).

## Testing

- <a id='one-assert'></a>(<a href='#one-assert'>link</a>) **One assertion per test.**
`

async function importFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rulekit-'))
  const out = path.join(dir, 'rules')
  const report = await importGuide({ source: await write(dir, GUIDE), out })
  return { dir, out, report }
}

async function write(dir: string, value: string): Promise<string> {
  const file = path.join(dir, 'GUIDE.md')
  await fs.writeFile(file, value)
  return file
}

test('앵커 이름을 kebab-case id 로 정규화한다', () => {
  assert.equal(toKebabId('prefer-forEach'), 'prefer-for-each')
  assert.equal(toKebabId('use-camel-case'), 'use-camel-case')
})

test('가이드를 카테고리별 규칙 파일로 분해한다', async () => {
  const { report } = await importFixture()
  assert.equal(report.rules.length, 3)
  assert.deepEqual(report.skipped, [])
  assert.deepEqual(report.categories, ['naming', 'testing'])
})

test('진술·근거·예시·예외를 섹션으로 나눈다', async () => {
  const { report } = await importFixture()
  const rule = report.rules.find((r) => r.id === 'use-camel-case')!
  assert.equal(rule.statement, 'Use UpperCamelCase for types.')
  assert.match(rule.why, /Consistency with the standard library/)
  assert.match(rule.why, /Casing tells the reader/)
  assert.match(rule.examples, /\/\/ WRONG/)
  assert.match(rule.exceptions, /underscore-prefixed/)
})

test('배지를 enforced-by 로 환원하고 severity 를 정한다', async () => {
  const { report } = await importFixture()
  const enforced = report.rules.find((r) => r.id === 'use-camel-case')!
  assert.deepEqual(enforced.enforcedBy, [
    { tool: 'swiftformat', rule: 'typeNames' },
  ])
  assert.equal(enforced.severity, 'error')
  assert.equal(report.rules.find((r) => r.id === 'one-assert')!.severity, 'warning')
})

test('정규화된 id 는 원본 앵커를 별칭·원문 링크로 보존한다', async () => {
  const { report } = await importFixture()
  const rule = report.rules.find((r) => r.id === 'prefer-for-each')!
  assert.deepEqual(rule.aliases, ['prefer-forEach'])
  assert.equal(rule.sourceAnchor, 'prefer-forEach')
})

test('본문 상호 링크를 related 로 환원한다', async () => {
  const { report } = await importFixture()
  const rule = report.rules.find((r) => r.id === 'prefer-for-each')!
  assert.deepEqual(rule.related, ['use-camel-case'])
})

test('분해 결과는 그대로 lint 를 통과한다', async () => {
  const { out } = await importFixture()
  const set = validateRuleSet(await collectRules(out))
  assert.equal(set.rules.length, 3)
  const fatal = set.files.flatMap((f) => f.messages.filter((m) => m.fatal))
  assert.deepEqual(fatal.map((m) => m.reason), [])
})
