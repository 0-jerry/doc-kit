---
id: bool-names
title: Bool 이름은 is/has/should 로 시작한다
category: naming
severity: warning
status: active
since: 2025-08-03
tags: [naming, types]
applies-to:
  - "Sources/**/*.swift"
extends: [use-camel-case]
related: [use-camel-case]
---

## Rule

Bool 타입의 프로퍼티와 함수 이름은 `is`, `has`, `should` 중 하나로 시작한다.

## Why

호출부에서 타입 정보가 드러나지 않는 Swift 에서, 이름의 접두어가 유일한 단서다. `spaceship` 과 `isSpaceship` 은 읽는 사람에게 전혀 다른 기대를 준다.

## Examples

```swift
// WRONG
var spacesuit: Bool
func validUser() -> Bool
```

```swift
// RIGHT
var hasSpacesuit: Bool
func isValidUser() -> Bool
```
