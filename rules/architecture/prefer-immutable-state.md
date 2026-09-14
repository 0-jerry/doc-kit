---
id: prefer-immutable-state
title: 상태는 기본적으로 불변으로 선언한다
category: architecture
severity: error
status: active
since: 2025-08-10
tags: [state, concurrency]
applies-to:
  - "Sources/**/*.swift"
enforced-by:
  - swiftlint:prefer_let
conflicts: [allow-mutable-buffers]
---

## Rule

프로퍼티와 지역 변수는 `let` 으로 선언하고, 변경이 실제로 필요할 때만 `var` 로 낮춘다.

## Why

불변 선언은 값이 언제 바뀌는지를 타입 수준에서 고정한다. 동시성 코드에서는 이 성질이 곧 데이터 경쟁 부재의 증명이 되므로, `var` 하나하나가 검토 대상이 된다.

## Examples

```swift
// WRONG
var configuration = Configuration.default
let session = URLSession(configuration: configuration)
```

```swift
// RIGHT
let configuration = Configuration.default
let session = URLSession(configuration: configuration)
```
