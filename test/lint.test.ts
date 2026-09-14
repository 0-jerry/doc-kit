import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codes, parseAt, VALID } from './helpers.js'

test('H1 은 거부된다', () => {
  const result = parseAt(VALID.replace('## Rule', '# 예시 규칙\n\n## Rule'))
  assert.ok(codes(result).includes('DOC001'))
})

test('필수 섹션이 없으면 보고한다', () => {
  const result = parseAt(VALID.replace(/## Why[\s\S]*$/, ''))
  assert.ok(codes(result).includes('DOC002'))
})

test('Rule 섹션이 없으면 치명적이다', () => {
  const result = parseAt(VALID.replace('## Rule', '## Why 아님'))
  assert.ok(result.file.messages.some((m) => m.ruleId === 'DOC002' && m.fatal))
})

test('알 수 없는 섹션은 거부된다', () => {
  const result = parseAt(`${VALID}\n## 잡담\n\n내용\n`)
  assert.ok(codes(result).includes('DOC003'))
})

test('섹션 순서가 뒤집히면 보고한다', () => {
  const result = parseAt(`---
id: sample
title: 예시 규칙
category: naming
severity: info
---

## Why

근거.

## Rule

규범 진술.
`)
  assert.ok(codes(result).includes('DOC004'))
})

test('섹션 중복을 잡는다', () => {
  const result = parseAt(`${VALID}\n## Why\n\n또 다른 근거.\n`)
  assert.ok(codes(result).includes('DOC005'))
})

test('규범 진술이 길면 Why 로 옮기라고 알린다', () => {
  const long = '이렇게 쓴다. 그리고 저렇게 쓴다. 또한 이렇게도 쓴다. 마지막으로 이렇게 쓴다.'
  const result = parseAt(
    VALID.replace('식별자는 의도를 드러내는 이름으로 쓴다.', long),
  )
  assert.ok(codes(result).includes('DOC006'))
})

test('언어 태그 없는 코드블록을 잡는다', () => {
  const result = parseAt(`${VALID}
## Examples

\`\`\`
let a = 1
\`\`\`
`)
  assert.ok(codes(result).includes('DOC007'))
})

test('예시가 한쪽 극성만 있으면 보고한다', () => {
  const result = parseAt(`${VALID}
## Examples

\`\`\`swift
// WRONG
let a = 1
\`\`\`
`)
  assert.ok(codes(result).includes('DOC009'))
})

test('첫 섹션 앞의 본문을 잡는다', () => {
  const result = parseAt(VALID.replace('## Rule', '떠도는 문장.\n\n## Rule'))
  assert.ok(codes(result).includes('DOC010'))
})

test('superseded 는 superseded-by 를 요구한다', () => {
  const result = parseAt(VALID.replace('status: active', 'status: superseded'))
  assert.ok(codes(result).includes('FM006'))
})

test('severity: error 인 활성 규칙은 Why 근거를 요구한다', () => {
  const result = parseAt(
    VALID.replace('severity: warning', 'severity: error').replace(
      '이름이 의도를 드러내면 주석이 필요 없다.',
      '',
    ),
  )
  assert.ok(codes(result).includes('DOC012'))
})

test('한 블록에 WRONG/RIGHT 가 함께 있으면 경고하지 않는다', () => {
  const result = parseAt(`${VALID}
## Examples

\`\`\`swift
// WRONG
let a = 1

// RIGHT
let apple = 1
\`\`\`
`)
  assert.ok(!codes(result).includes('DOC009'))
})
