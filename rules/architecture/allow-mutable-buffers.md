---
id: allow-mutable-buffers
title: 성능이 측정된 핫 패스에서는 가변 버퍼를 허용한다
category: architecture
severity: info
status: active
since: 2025-08-12
tags: [state, performance]
conflicts: [prefer-immutable-state]
related: [prefer-immutable-state]
---

## Rule

프로파일러로 병목이 확인된 경로에 한해 가변 버퍼를 쓸 수 있으며, 근거가 되는 측정치를 주석으로 남긴다.

## Why

불변성은 기본값이지 절대 규칙이 아니다. 측정 없는 최적화를 막으면서도, 측정된 병목에는 탈출구를 열어 두어야 규칙이 우회되지 않는다.

## Examples

```swift
// WRONG
var buffer: [UInt8] = []  // 이유 없이 가변
```

```swift
// RIGHT
// 프로파일 결과 디코딩의 38% 차지 (2025-08-12, Instruments)
var buffer = [UInt8](repeating: 0, count: capacity)
```
