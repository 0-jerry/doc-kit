/**
 * 블록 단위 모델의 최대 위험은 왕복 보존이다. 이 파일이 그 방어선이다.
 * 읽고 바로 쓰면 원문과 바이트 단위로 같아야 한다.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset } from '../../src/schema/index.js'
import { serializeDocument } from '../../src/serialize/index.js'

const schema = loadPreset('preset/principle')

function roundtrip(text: string): string {
  const { document, diagnostics } = parseDocument(text, {
    schema,
    path: 'principle/sample.md',
    collection: 'principle',
    name: 'sample',
  })
  assert.notEqual(document, null, diagnostics.map((item) => item.message).join('\n'))
  return serializeDocument(document!, { schema })
}

const SAMPLES: Record<string, string> = {
  최소: `---
type: principle
id: sample
---

## 기준

불변식은 생성자에서 검증한다.
`,

  전체: `---
type: principle
id: 불변식은-생성자에서-검증한다
subject:
  - domain-layer
topic:
  - validation
  - invariant
status: active
since: 2026-09-15
---

## 기준

<!-- rk: id=core -->
객체의 불변식은 생성자에서 검증하고, 검증에 실패하면 인스턴스를 만들지 않는다.

## 근거

유효하지 않은 상태의 객체가 존재할 수 없으면,
이후 모든 메서드가 상태 검사를 생략할 수 있다.

## 예시

<!-- rk: role=counter-example -->
\`\`\`swift
init(age: Int) { self.age = age }   // 음수 나이를 통과시킨다
\`\`\`

\`\`\`swift
init(age: Int) throws {
  guard age >= 0 else { throw DomainError.invalidAge }
  self.age = age
}
\`\`\`

## 예외

<!-- rk: subject=[test-fixture] -->
테스트 픽스처 빌더는 의도적으로 무효 상태를 만들기 위해 검증을 우회할 수 있다.
`,

  '표와 목록': `---
type: principle
id: sample
---

## 기준

- 첫째 항목
- 둘째 항목
  - 중첩 항목

| 대상 | 강제 수준 |
| --- | --- |
| 도메인 | must |
| 인프라 | should |

> 인용도 블록 하나다.
`,

  '중첩 섹션과 불규칙한 공백': `---
type: principle
id: sample
---

## 기준

첫 문단.


둘째 문단.

### 더 좁은 경우

중첩된 섹션의 문단.

## 근거

근거 문단.
`,

  '떠도는 블록': `---
type: principle
id: sample
---

제목 앞에 떠도는 문단.

## 기준

규범 진술.
`,
}

for (const [name, text] of Object.entries(SAMPLES)) {
  test(`왕복 보존 — ${name}`, () => {
    assert.equal(roundtrip(text), text)
  })
}

test('두 번 왕복해도 같다', () => {
  const once = roundtrip(SAMPLES['전체']!)
  assert.equal(roundtrip(once), once)
})

test('마지막 줄바꿈이 없어도 그대로 보존한다', () => {
  const text = '---\ntype: principle\nid: sample\n---\n\n## 기준\n\n끝에 줄바꿈 없음.'
  assert.equal(roundtrip(text), text)
})

test('윈도 줄바꿈도 보존한다', () => {
  const text = '---\r\ntype: principle\r\nid: sample\r\n---\r\n\r\n## 기준\r\n\r\n진술.\r\n'
  assert.equal(roundtrip(text), text)
})
