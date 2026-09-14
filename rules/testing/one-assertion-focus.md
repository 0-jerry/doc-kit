---
id: one-assertion-focus
title: 테스트 하나는 하나의 행동만 검증한다
category: testing
severity: warning
status: active
since: 2025-08-20
tags: [testing, structure]
applies-to:
  - "Tests/**/*.swift"
related: [test-naming-given-when-then]
---

## Rule

테스트 함수 하나는 하나의 관측 가능한 행동만 검증한다.

## Why

실패한 테스트 이름만 보고 무엇이 깨졌는지 알 수 있어야 회귀 대응이 빨라진다. 한 함수에 여러 행동이 섞이면 첫 단언에서 멈춰 나머지 정보를 잃는다.

## Examples

```swift
// WRONG
func testUser() {
    XCTAssertEqual(user.name, "제리")
    XCTAssertTrue(user.isActive)
    XCTAssertNil(user.deletedAt)
}
```

```swift
// RIGHT
func test_name_isParsedFromPayload() {
    XCTAssertEqual(user.name, "제리")
}
```
