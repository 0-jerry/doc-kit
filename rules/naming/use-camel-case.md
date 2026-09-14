---
id: use-camel-case
title: 타입·프로토콜은 UpperCamelCase, 그 외는 lowerCamelCase 로 쓴다
category: naming
severity: error
status: active
since: 2025-08-03
tags: [naming, casing]
applies-to:
  - "Sources/**/*.swift"
  - "Tests/**/*.swift"
enforced-by:
  - swiftlint:type_name
  - swiftlint:identifier_name
related: [bool-names]
---

## Rule

타입과 프로토콜 이름은 UpperCamelCase 로, 나머지 모든 식별자는 lowerCamelCase 로 쓴다.

## Why

대소문자만 보고도 이름이 타입인지 값인지 구분되면, 코드를 읽을 때 선언부를 찾아가지 않아도 된다. Swift 표준 라이브러리와 Apple 프레임워크 전체가 같은 규약을 따르므로 우리 코드만 다르면 경계에서 마찰이 생긴다.

## Examples

```swift
// WRONG
protocol space_thing { }
class spaceFleet: space_thing {
    var Ships: [Spaceship] = []
}
```

```swift
// RIGHT
protocol SpaceThing { }
final class SpaceFleet: SpaceThing {
    var ships: [Spaceship] = []
}
```

## Exceptions

상위 접근 수준의 동일 이름 프로퍼티를 뒷받침하는 private 프로퍼티는 밑줄을 접두어로 쓸 수 있다.

```swift
// RIGHT
final class ExperiencesViewController: UIViewController {
    private lazy var _view = CustomView()
}
```
