import path from 'node:path'
import { parseRule } from '../src/parse.js'
import type { ParseResult } from '../src/types.js'

export const RULES_ROOT = path.resolve(import.meta.dirname, '../rules')

/** `category/id.md` 위치에 있는 것처럼 문자열을 파싱한다. */
export function parseAt(
  value: string,
  relPath = 'naming/sample.md',
): ParseResult {
  return parseRule(value, path.join(RULES_ROOT, relPath), {
    root: RULES_ROOT,
  })
}

export function codes(result: ParseResult): string[] {
  return result.file.messages.map((m) => m.ruleId ?? '')
}

export const VALID = `---
id: sample
title: 예시 규칙
category: naming
severity: warning
status: active
tags: [naming]
---

## Rule

식별자는 의도를 드러내는 이름으로 쓴다.

## Why

이름이 의도를 드러내면 주석이 필요 없다.
`
