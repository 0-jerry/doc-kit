# rule-kit

프로젝트 규칙을 **데이터로** 관리하는 도구. 규칙 문서를 [unified](https://github.com/unifiedjs/unified)/mdast 로 파싱해 타입이 있는 레코드로 환원하고, 스키마·구조·참조 무결성을 검증한 뒤, 조회용 인덱스와 관계 그래프를 만든다.

산문으로 흘러가던 스타일 가이드를 컴파일 가능한 모듈 집합처럼 다루는 것이 목적이다.

- **구조화** — 규칙 하나 = 파일 하나. frontmatter 가 인터페이스, 본문이 구현.
- **검증** — 스키마 위반, 섹션 규약 위반, 끊긴 참조, 순환 상속을 CI 에서 잡는다.
- **탐색** — 카테고리·태그·강제도구 역인덱스와 관계 그래프(JSON/Mermaid/DOT).

## 빠른 시작

```bash
npm install
npm run lint:rules     # rulekit lint rules
npm run build:rules    # rulekit build rules -o .rulekit
npm test
```

## 저작 형식

`rules/<category>/<id>.md` — 디렉터리는 `category` 와, 파일명은 `id` 와 일치해야 한다. 규약을 파일 시스템에 고정해 두면 이름만 보고도 위치를 알 수 있다.

````markdown
---
id: use-camel-case
title: 타입·프로토콜은 UpperCamelCase, 그 외는 lowerCamelCase 로 쓴다
category: naming
severity: error          # error | warning | info
status: active           # proposed | active | deprecated | superseded
since: 2025-08-03
tags: [naming, casing]
applies-to: ["Sources/**/*.swift"]
enforced-by: [swiftlint:type_name]
extends: [base-naming]
related: [bool-names]
conflicts: []
supersedes: []
# superseded-by: new-rule   # status: superseded 일 때만
---

## Rule

타입과 프로토콜 이름은 UpperCamelCase 로, 나머지 모든 식별자는 lowerCamelCase 로 쓴다.

## Why

대소문자만 보고 이름이 타입인지 값인지 구분되면 선언부를 찾아가지 않아도 된다.

## Examples

```swift
// WRONG
protocol space_thing { }
```

```swift
// RIGHT
protocol SpaceThing { }
```

## Exceptions

...
````

### 섹션 규약

`## Rule` → `## Why` → `## Examples` → `## Exceptions` → `## Migration` → `## References` 순서. `Rule`/`Why` 는 필수, 나머지는 선택이며 순서만 지키면 된다. H1 은 쓰지 않는다 — 제목은 `frontmatter.title` 이 소유한다.

`## Rule` 은 규범 진술 전용이다. 3문장을 넘으면 근거가 섞였다는 뜻이므로 `## Why` 로 내려보내라는 경고가 뜬다.

예시 코드블록의 첫 줄 주석 `// WRONG` · `// RIGHT` 는 극성으로 파싱되어 인덱스에 들어간다. 한쪽만 있으면 경고한다.

## 검증 규칙

| 코드 | 대상 | 내용 |
| --- | --- | --- |
| `FM001` | frontmatter | 블록 없음 (치명적) |
| `FM002` | frontmatter | YAML 파싱 실패 (치명적) |
| `FM003` | frontmatter | 스키마 위반 — 필드 경로와 함께 보고 (치명적) |
| `FM004` | 위치 | 파일명 ≠ `id` |
| `FM005` | 위치 | 디렉터리 ≠ `category` |
| `FM006` | 수명 주기 | `status: superseded` ↔ `superseded-by` 불일치 |
| `DOC001` | 본문 | H1 사용 |
| `DOC002` | 본문 | 필수 섹션 누락 (`Rule` 누락은 치명적) |
| `DOC003` | 본문 | 규약에 없는 섹션 |
| `DOC004` | 본문 | 섹션 순서 위반 |
| `DOC005` | 본문 | 섹션 중복 |
| `DOC006` | 본문 | 규범 진술이 비었거나 너무 김 |
| `DOC007` | 본문 | 코드블록 언어 태그 누락 |
| `DOC008` | 본문 | `## Examples` 에 코드블록 없음 |
| `DOC009` | 본문 | 예시 극성이 한쪽뿐 |
| `DOC010` | 본문 | 첫 섹션 제목 앞의 떠도는 내용 |
| `DOC011` | 본문 | 섹션 제목이 H2 가 아님 |
| `DOC012` | 본문 | `severity: error` 인 활성 규칙에 근거 없음 |
| `REF001` | 참조 | 존재하지 않는 규칙 참조 |
| `REF002` | 참조 | 자기 참조 |
| `REF003` | 참조 | `id` 중복 |
| `REF004` | 참조 | `extends` 순환 |
| `REF005` | 참조 | deprecated/superseded 규칙을 활성 규칙이 참조 |
| `REF006` | 참조 | `conflicts` 가 단방향 |
| `REF007` | 참조 | `superseded-by` 가 단방향 |

## CLI

```bash
rulekit lint  [rules-dir] [--json] [--quiet] [--strict] [--max-sentences <n>]
rulekit build [rules-dir] [-o <out-dir>] [--format json|mermaid|dot] [--strict]
```

`lint` 는 오류가 있으면 종료 코드 1 을 낸다. `--strict` 를 주면 경고도 실패로 취급한다(CI 권장).

`build` 는 `-o` 디렉터리에 세 파일을 쓴다.

- `rules.index.json` — 규칙 레코드 + `byCategory` / `byTag` / `byEnforcer` 역인덱스
- `rules.graph.json` — 노드·간선, `orphans`, `cycles`, `dangling`, `depth`
- `rules.graph.mmd` — Mermaid 플로차트

`--format mermaid|dot` 을 주면 파일을 쓰지 않고 그래프만 stdout 으로 내보낸다.

## 프로그래밍 API

```ts
import { collectRules, validateRuleSet, buildIndex, buildGraph } from 'rule-kit'

const set = validateRuleSet(await collectRules('rules'))
const index = buildIndex(set)
const graph = buildGraph(set)

// 이 태그의 error 규칙만
const blocking = index.rules.filter(
  (r) => r.severity === 'error' && r.tags.includes('concurrency'),
)

// SwiftLint 설정과 문서가 어긋나는지 대조
const documented = new Set(Object.keys(index.byEnforcer))
```

파이프라인 자체가 필요하면 unified 플러그인을 직접 조립해도 된다.

```ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import { ruleExtract, ruleLint } from 'rule-kit'

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(ruleExtract, { root: 'rules' })
  .use(ruleLint, { maxStatementSentences: 2 })
```

`ruleExtract` 는 결과를 `file.data.rule` 에, 섹션을 `file.data.sections` 에 담는다. 진단은 모두 표준 vfile 메시지라 기존 remark/eslint 리포터와 그대로 섞인다.

## 구조

```
src/
  types.ts              도메인 타입
  schema.ts             frontmatter zod 스키마 + 섹션 규약
  plugins/rule-extract.ts   mdast → 규칙 레코드
  plugins/rule-lint.ts      구조 규약 검사
  processor.ts          unified 파이프라인
  parse.ts / collect.ts 단일 파일 / 디렉터리 진입점
  validate.ts           규칙 간 참조 무결성
  graph.ts              그래프 · Mermaid · DOT
  index-build.ts        조회용 인덱스
  cli.ts                lint · build
```

## 마이그레이션

기존 규칙 문서를 규칙 파일 트리로 정규화하는 `rulekit import` 에는 두 가지 프로파일이 있다.

### `--profile anchor-list` (기본)

Airbnb 계열 스타일 가이드가 공유하는 앵커 규약, 즉 **한 파일에 규칙 수백 개**가 목록 항목으로 들어 있는 형태를 분해한다.

| 원문 | 결과 |
| --- | --- |
| `<a id='...'>` | `id` (kebab-case 로 정규화, 원본은 별칭·원문 링크로 보존) |
| 굵은 글씨 | `## Rule` + `title` |
| 굵은 글씨 뒤 부연, `#### Why?` | `## Why` |
| `<details>` 안의 코드블록 | `## Examples` |
| `_Exception: ..._` | `## Exceptions` |
| `[![SwiftFormat: x]](...)` 배지 | `enforced-by: [swiftformat:x]` |
| 배지 유무 | `severity` (있으면 `error`, 없으면 `warning`) |
| `## 제목` / `### 제목` | `category` / `tags` |
| 본문의 `[...](#other-id)` | `related` |

```bash
rulekit import path/to/GUIDE.md -o rules --source-link ../GUIDE.md
```

### `--profile doc-tree`

**이미 문서별로 쪼개져 있는** 규칙 트리를 정규화한다. 문서 하나가 규칙 하나이고, 문서 간 링크가 관계가 된다.

| 원문 | 결과 |
| --- | --- |
| H1 | `title` |
| `**상태**: 정본` / `**작성일**:` | `status` / `since` |
| `[부모](../x.md)의 규칙 문서입니다.` | `extends` |
| 마지막 목록까지의 산문·목록 | `## Rule` |
| 그 뒤의 산문 | `## Why` |
| 코드블록 | `## Examples` |
| H2 섹션 (`--section-map`) | 매핑된 섹션, 미매핑은 `rule` |
| 문서 간 링크 | `related` 또는 `## References` |

문서 레지스트리(TSV)를 주면 그것이 `id`·`title`·`summary`·`scope` 의 정본이 된다.

```bash
rulekit import docs --profile doc-tree -o rules \
  --registry docs/registry/documents.tsv \
  --scopes docs/registry/document_scopes.tsv \
  --repo-root . --kinds rule,package-rule
```

**상대 링크는 전부 다시 쓴다.** 대상이 수입된 규칙이면 새 트리 안의 경로로, 아니면 원문 문서를 계속 가리키도록 경로를 다시 계산한다. 생성된 파일에 남지 않는 앵커는 떨어내고 그 수를 보고한다. `--doc-base` 를 주면 수입되지 않은 문서로 가는 링크에 접두사를 붙인다(저장소 밖으로 나가는 긴 상대 경로 대신 URL 등을 쓸 때).

원문에 심각도 신호가 없으므로 `severity` 는 전부 `--severity` 값(기본 `error`)이 된다. 이것은 추론이 아니라 **명시된 가정**이다.

### 적용 사례

`examples/` 에 두 코퍼스를 분해한 결과가 들어 있다.

| | Swift-Style | Git-It-iOS |
| --- | --- | --- |
| 원문 | `README.md` 5,824줄 | `docs/` 문서 110개 |
| 프로파일 | `anchor-list` | `doc-tree` |
| 규칙 | 133 · 카테고리 9 | 110 · 카테고리 11 |
| 관계 간선 | 7 (고립 122) | 122 (고립 45) |
| lint | 오류 0 · 경고 69 | 오류 0 · 경고 112 |

## 다음 단계 (미구현)

- `rulekit query` — 태그·심각도·적용 범위로 조회하고 JSON 으로 내보내기
- `rulekit render` — 인덱스에서 목차·색인이 붙은 통합 문서 생성
- `rulekit drift` — `byEnforcer` 인덱스와 린터 설정 파일을 대조 (지금은 수동 스크립트)
- `rulekit link-check` — 생성된 트리의 상대 링크 해석 검증 (지금은 import 단계에서만 집계)
