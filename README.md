# rule-kit

프로젝트의 **판단기준**(원칙·컨벤션·결정 기록)을 마크다운으로 쓰되, 데이터로 다루는 도구.

문서를 **블록 단위 트리**로 파싱하고, 각 노드에 맥락 보조데이터(대상·주제·역할·관계·수명주기)를
붙이며, 노드가 과도한 책임을 갖지 못하도록 몇 가지 원칙을 강제한다.
1차 소비자는 AI 에이전트와 문서를 읽는 사람이다.

- **도메인을 모른다** — 문서 종류와 섹션 문법은 사용자가 선언한다. 내장 프리셋도 같은 형식이다.
- **맥락을 들고 다닌다** — 보조데이터가 조상에서 자손으로 흐르고, 대상은 좁아지기만 한다.
- **원문을 지킨다** — 읽고 바로 쓰면 바이트 단위로 같다. 고친 블록만 새로 쓰인다.
- **기계가 쓴다** — 저작·수정이 JSON 명령 객체다. 에이전트와 CLI 가 같은 입력을 쓴다.

## 빠른 시작

```bash
npm install
npx rulekit check rules
```

규약 파일이 없으면 내장 프리셋(`preset/principle`)으로 시작한다.

## 저작 형식

노드 하나가 디렉터리 하나다. 제목이 노드를 만들고, `#` 개수가 계층이다.

```
rules/principle/불변식은-생성자에서-검증한다/
  node.md                  ← 문서이자 루트 노드
  norm/node.md
  rationale/node.md
  rationale/더-좁은-경우/node.md
  example/node.md
```

노드는 객체처럼 **자기가 정의한 내용**과 **하위 노드 인덱스**만 소유한다.
부모는 자식의 내용을 갖지 않는다 — 이름만 들고 있고, 합칠 때 그 인덱스를 따라 주입한다.

```markdown
<!-- principle/불변식은-생성자에서-검증한다/node.md -->
---
type: principle
id: 불변식은-생성자에서-검증한다
subject: [domain-layer]
status: active
children: [norm, rationale, example]    ← 하위 노드 인덱스. 순서가 곧 문서 순서
---
```

```markdown
<!-- principle/불변식은-생성자에서-검증한다/norm/node.md -->
---
---

<!-- rk: id=core -->
객체의 불변식은 생성자에서 검증하고, 검증에 실패하면 인스턴스를 만들지 않는다.
```

노드 파일에는 제목 줄이 없다. 이름은 디렉터리가, 제목은 규약이 안다 —
규약에 없는 제목만 frontmatter 의 `title` 로 적는다. 섹션이 정한 기본 역할도 적지 않고,
읽을 때 그 자리에서 되살린다.

`rulekit split` 이 한 파일짜리 문서를 이 형태로 흩고, `rulekit assemble` 이 도로 합친다.
한 파일에 담긴 `<컬렉션>/<문서>.md` 형식도 그대로 읽는다.

### 한 파일에 담는 형식

`<루트>/<컬렉션>/<문서>.md` — 디렉터리가 컬렉션, 파일명이 문서 식별자다.

```markdown
---
type: principle
id: 불변식은-생성자에서-검증한다
subject: [domain-layer]
topic: [validation, invariant]
status: active
level: must
---

## 기준

<!-- rk: id=core -->
객체의 불변식은 생성자에서 검증하고, 검증에 실패하면 인스턴스를 만들지 않는다.

## 근거

유효하지 않은 상태의 객체가 존재할 수 없으면, 이후 모든 메서드가 상태 검사를 생략할 수 있다.

## 예외

<!-- rk: subject=[test-fixture] -->
테스트 픽스처 빌더는 의도적으로 무효 상태를 만들기 위해 검증을 우회할 수 있다.
```

저작 채널은 셋이고 역할이 다르다.

| 채널 | 담당 |
| --- | --- |
| frontmatter | 문서 전체의 보조데이터. 하위 노드가 상속하는 기본값 |
| 섹션 제목 | 규약의 섹션 키로 옮겨지고, 그 안 블록의 기본 역할을 정한다 |
| `<!-- rk: … -->` | 바로 뒤 노드 하나의 보조데이터. 필요한 곳에만 |

보조데이터는 조상에서 자손으로 흐른다. `subject` 는 **교집합으로 좁아지기만** 하므로,
하위 블록이 상위 문서보다 넓은 대상을 주장할 수 없다 — 문서가 슬금슬금 책임을 늘리는 길이 막힌다.

## 규약

`.rulekit/schema.yaml` 이 문서 타입·섹션·역할·어휘·관계를 선언한다.

```yaml
version: 1
extends: preset/principle

collections:
  principle: principle

vocabularies:
  subject:
    closed: true
    source: ./subjects.yaml    # 값 → 경로 글롭 매핑
  level:
    closed: true
    ordered: true              # 앞이 강하다
    values: [must, should, may]
```

```yaml
# .rulekit/subjects.yaml — 어떤 파일이 어떤 대상인지는 어휘가 소유한다
model: ['src/model/**']
parse: ['src/parse/**', 'src/serialize/**']
```

내장 프리셋은 `preset/principle` · `preset/convention` · `preset/decision` 셋이다.
프리셋도 사용자 선언과 같은 형식이고 같은 로더를 탄다 — 도구에 하드코딩된 문법은 없다.

## 원칙

노드가 과도한 책임을 갖지 못하게 하는 장치들. 타입으로 막을 수 있는 것은 검사기를 두지 않는다.

| 원칙 | 강제 | 코드 |
| --- | --- | --- |
| 모델은 아무것도 import 하지 않는다 | 의존성 테스트 | — |
| 리프는 자식을 갖지 못한다 | 타입 시스템 | — |
| 한 블록은 역할을 하나만 갖는다 | 타입 시스템 | — |
| 규범 진술은 한 가지만 말한다 | 경고 | `STR001` |
| 섹션·문서·트리의 크기 상한 | 오류 · 경고 | `STR002`~`STR005` |
| 섹션 구성·순서·역할은 규약을 벗어날 수 없다 | 오류 | `SCH001`~`SCH009` |
| 자손의 대상은 조상보다 넓을 수 없다 | 오류 | `AUX001` |
| 닫힌 어휘 밖의 값은 못 쓴다 | 오류 | `AUX002` |
| 자손은 조상보다 강하게 적용될 수 없다 | 오류 | `AUX003` |
| 안정 주소는 한 노드만 가리킨다 | 오류 | `AUX004` |
| 내용 복제 대신 관계 링크를 쓴다 | 경고 | `REF001` |
| 참조는 존재하고 비순환이어야 한다 | 오류 | `REF002`·`REF003` |
| 인덱스는 디렉터리 하나만 가리킨다 | 오류 | `NODE002`·`NODE005`·`NODE006` |
| 제목은 노드 파일이 아니라 디렉터리로 나뉜다 | 경고 | `NODE004` |

## CLI

```bash
rulekit check   [루트]                          규약과 원칙을 검사한다
rulekit index   [루트] --out <디렉터리>          인덱스와 관계 그래프
rulekit query   [루트] --role norm --subject …   조건에 맞는 규범 진술
rulekit context <파일경로> --root <루트>         그 파일에 적용되는 판단기준
rulekit render  [루트] --out <디렉터리>          정적 규칙집
rulekit apply   [루트] --commands <파일|-> [--dry-run]

rulekit split    [루트] --document <id> [--dry-run] [--replace]
                                                 문서를 노드 디렉터리로 흩는다
rulekit assemble [루트] --document <id> [--out <파일>]
                                                 노드 트리를 한 파일로 합친다
```

`check` 는 오류가 있으면 종료 코드 1 을 낸다. `--strict` 를 주면 경고도 실패로 본다.

## 에이전트

`query` 는 **규범 진술만** 돌려주고 근거는 주소로만 단다. 왜인지 궁금할 때 한 번 더 묻게
만드는 것이 의도다 — 읽는 쪽의 토큰을 아끼는 것이 이 층의 일이다.

```bash
rulekit context src/domain/Order.ts --root rules --json
```

수정은 JSON 명령으로 한다. 묶음은 전부 되거나 전부 안 되고, `--dry-run` 이면 파일을 쓰지 않은 채
결과와 진단만 보여 준다.

```json
[
  { "op": "section.ensure", "key": "exception" },
  { "op": "block.insert", "at": "exception", "markdown": "테스트 픽스처는 예외다.",
    "aux": { "subject": ["test-fixture"] } }
]
```

쓸 수 있는 명령: `document.create` · `document.setAux` · `section.ensure` ·
`block.insert` · `block.update` · `block.remove` · `node.move` ·
`relation.link` · `relation.unlink`.

## 구조

세 층으로 나뉘며 의존은 한 방향으로만 흐른다.

| 층 | 위치 | 책임 |
| --- | --- | --- |
| L1 저작 규약 | `src/schema/` | 문서 타입·섹션·역할·어휘를 선언. 질의에만 답한다 |
| L2 문서 객체 모델 | `src/model/` | `Document → Section → Block` 트리와 보조데이터. 아무것도 import 하지 않는다 |
| L3 조작 프로토콜 | `src/api/` | JSON 명령 객체. 원본을 바꾸지 않고 파일도 쓰지 않는다 |

나머지는 이 셋 위에 얹힌다 — `parse` `serialize` `nodes` `validate` `workspace` `query` `render` `cli`.
설계 근거와 트레이드오프는 [docs/design/0001-재설계.md](docs/design/0001-재설계.md) 에 있다.

## 개발

```bash
npm run typecheck
npm test
npm run check      # 자기 자신의 판단기준을 자기 자신으로 검사한다
```

`rules/` 에는 rule-kit 자신의 원칙이 rule-kit 형식으로 적혀 있다.
