import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codes, parseAt, VALID } from './helpers.js'

test('유효한 규칙은 메시지 없이 레코드를 만든다', () => {
  const result = parseAt(VALID)
  assert.deepEqual(codes(result), [])
  assert.equal(result.rule?.meta.id, 'sample')
  assert.equal(result.rule?.meta.severity, 'warning')
  assert.equal(result.rule?.statement, '식별자는 의도를 드러내는 이름으로 쓴다.')
  assert.equal(result.rule?.digest.length, 12)
})

test('frontmatter 가 없으면 치명적 오류로 레코드를 만들지 않는다', () => {
  const result = parseAt('## Rule\n\n본문만 있다.\n')
  assert.ok(codes(result).includes('FM001'))
  assert.equal(result.rule, null)
})

test('스키마 위반은 필드 경로와 함께 보고된다', () => {
  const result = parseAt(VALID.replace('severity: warning', 'severity: blocker'))
  assert.ok(codes(result).includes('FM003'))
  assert.ok(result.file.messages.some((m) => m.reason.includes('severity')))
  assert.equal(result.rule, null)
})

test('알 수 없는 frontmatter 키는 거부된다', () => {
  const result = parseAt(VALID.replace('tags: [naming]', 'owner: jerry'))
  assert.ok(codes(result).includes('FM003'))
})

test('파일명·디렉터리가 id·category 와 다르면 경고한다', () => {
  const result = parseAt(VALID, 'testing/other.md')
  assert.ok(codes(result).includes('FM004'))
  assert.ok(codes(result).includes('FM005'))
})

test('enforced-by 문자열 표기는 tool/rule 로 정규화된다', () => {
  const result = parseAt(
    VALID.replace('tags: [naming]', 'enforced-by: [swiftlint:type_name, custom]'),
  )
  assert.deepEqual(result.rule?.meta.enforcedBy, [
    { tool: 'swiftlint', rule: 'type_name' },
    { tool: 'custom' },
  ])
})

test('코드블록의 WRONG/RIGHT 극성을 읽는다', () => {
  const result = parseAt(`${VALID}
## Examples

\`\`\`swift
// WRONG
let a = 1
\`\`\`

\`\`\`swift
// RIGHT
let apple = 1
\`\`\`
`)
  const examples = result.rule?.sections.find((s) => s.key === 'examples')
  assert.deepEqual(
    examples?.codeBlocks.map((b) => b.polarity),
    ['wrong', 'right'],
  )
  assert.deepEqual(codes(result), [])
})
