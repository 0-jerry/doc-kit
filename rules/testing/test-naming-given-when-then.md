---
id: test-naming-given-when-then
title: 테스트 이름은 대상_조건_기대결과 순으로 쓴다
category: testing
severity: warning
status: active
since: 2025-08-20
tags: [testing, naming]
applies-to:
  - "Tests/**/*.swift"
extends: [use-camel-case]
related: [one-assertion-focus]
---

## Rule

테스트 함수 이름은 `test_<대상>_<조건>_<기대결과>` 형태로 쓴다.

## Why

이름이 명세 문장이 되면 테스트 목록 자체가 사양서가 된다. 실패 로그에 이름만 찍혀도 기대와 실제의 차이를 재현 없이 읽을 수 있다.

## Examples

```swift
// WRONG
func testLogin2() { }
```

```swift
// RIGHT
func test_login_withExpiredToken_returnsUnauthorized() { }
```
