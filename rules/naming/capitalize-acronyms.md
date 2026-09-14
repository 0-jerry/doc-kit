---
id: capitalize-acronyms
title: 약어는 전부 대문자로 쓰되, 이름 첫머리에서는 전부 소문자로 쓴다
category: naming
severity: warning
status: active
since: 2025-08-03
tags: [naming, casing]
extends: [use-camel-case]
---

## Rule

`ID`, `URL` 같은 약어는 이름 안에서 전부 대문자로 쓰고, lowerCamelCase 이름의 첫머리에 올 때만 전부 소문자로 쓴다.

## Why

약어를 부분 대문자로 쓰면 `Url`, `URL`, `url` 이 한 코드베이스에 섞여 검색과 자동완성이 모두 흔들린다.

## Examples

```swift
// WRONG
class UrlValidator {
    func isValidUrl(_ URL: URL) -> Bool { }
}
```

```swift
// RIGHT
class URLValidator {
    func isValidURL(_ url: URL) -> Bool { }
}
```
