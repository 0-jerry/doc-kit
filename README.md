# doc-kit

마크다운 문서를 **블록 단위 트리로 구조화**하고, 내용 주소로 인덱싱해 조각 단위로
질의·조작하는 도구.

문서를 블록 트리로 파싱하고, 각 노드에 맥락 보조데이터(대상·주제·역할·관계·수명주기)를
붙이며, 노드가 과도한 책임을 갖지 못하도록 제약을 강제한다.
1차 소비자는 AI 에이전트와 문서를 읽는 사람이다.

- **도메인을 모른다** — 문서 종류와 섹션 문법은 사용자가 선언한다. 내장 프리셋도 같은 형식이다.
- **맥락을 들고 다닌다** — 보조데이터가 조상에서 자손으로 흐르고, 대상은 좁아지기만 한다.
- **원문을 지킨다** — 읽고 바로 쓰면 바이트 단위로 같다. 고친 블록만 새로 쓰인다.
- **내용이 주소다** — 블록을 해싱해 저장하므로, 바뀌지 않은 문서는 다시 읽지도 파싱하지도 않는다.
- **기계가 쓴다** — 저작·수정이 JSON 명령 객체다. 에이전트와 CLI 가 같은 입력을 쓴다.

판단기준(원칙·컨벤션·결정 기록)은 이 도구로 할 수 있는 한 가지이고, 내장 프리셋으로 들어 있다.
도구 자체는 그것을 모른다 — 하드코딩된 문법은 없다.

## 빠른 시작

```bash
npm install
npx dockit check rules
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

<!-- dk: id=core -->
객체의 불변식은 생성자에서 검증하고, 검증에 실패하면 인스턴스를 만들지 않는다.
```

노드 파일에는 제목 줄이 없다. 이름은 디렉터리가, 제목은 규약이 안다 —
규약에 없는 제목만 frontmatter 의 `title` 로 적는다. 섹션이 정한 기본 역할도 적지 않고,
읽을 때 그 자리에서 되살린다.

`dockit split` 이 한 파일짜리 문서를 이 형태로 흩고, `dockit assemble` 이 도로 합친다.
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

<!-- dk: id=core -->
객체의 불변식은 생성자에서 검증하고, 검증에 실패하면 인스턴스를 만들지 않는다.

## 근거

유효하지 않은 상태의 객체가 존재할 수 없으면, 이후 모든 메서드가 상태 검사를 생략할 수 있다.

## 예외

<!-- dk: subject=[test-fixture] -->
테스트 픽스처 빌더는 의도적으로 무효 상태를 만들기 위해 검증을 우회할 수 있다.
```

저작 채널은 셋이고 역할이 다르다.

| 채널 | 담당 |
| --- | --- |
| frontmatter | 문서 전체의 보조데이터. 하위 노드가 상속하는 기본값 |
| 섹션 제목 | 규약의 섹션 키로 옮겨지고, 그 안 블록의 기본 역할을 정한다 |
| `<!-- dk: … -->` | 바로 뒤 노드 하나의 보조데이터. 필요한 곳에만 |

rule-kit 시절의 `<!-- rk: … -->` 는 더 읽지 않는다. 남아 있으면 `PRS006` 으로 알린다.

보조데이터는 조상에서 자손으로 흐른다. `subject` 는 **교집합으로 좁아지기만** 하므로,
하위 블록이 상위 문서보다 넓은 대상을 주장할 수 없다 — 문서가 슬금슬금 책임을 늘리는 길이 막힌다.

## 규약

`.dockit/schema.yaml` 이 문서 타입·섹션·역할·어휘·관계를 선언한다.

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
# .dockit/subjects.yaml — 어떤 파일이 어떤 대상인지는 어휘가 소유한다
model: ['src/model/**']
parse: ['src/parse/**', 'src/serialize/**']
```

내장 프리셋은 `preset/principle` · `preset/convention` · `preset/decision` 셋이다.
프리셋도 사용자 선언과 같은 형식이고 같은 로더를 탄다 — 도구에 하드코딩된 문법은 없다.

## 인덱싱

블록이 blob, 노드가 tree 다. Git 과 같은 내용 주소 저장소에 담되, 해시는 SHA-256 이고
객체마다 zlib 로 압축한다.

```
.dockit/store.yaml       저장 정책 (retention: head | all)
.dockit/store/
  objects/ab/cdef…        zlib(`<타입> <길이>\0<내용>`)
  derived/ab/cdef….z      기록과 진단 캐시
  index                   경로 → (수정시각, 크기, 내용해시)
  HEAD                    마지막 스냅샷
```

이 대응은 억지가 아니다. 노드는 이미 "자기가 정의한 내용과 하위 노드 인덱스"만 소유하고
부모가 자식의 내용을 갖지 않는데, 그것이 tree 의 정의다. `children: [norm, rationale]` 는
문자 그대로 tree entry 목록이다.

단축 경로는 두 단계이고 아끼는 것이 다르다.

| 단계 | 판정 | 아끼는 것 |
| --- | --- | --- |
| stat 캐시 | 수정시각·크기가 그대로 | 파일 읽기 |
| 원본 해시 | 파일들의 내용 해시가 그대로 | **파싱과 검증** |

그래서 바뀌지 않은 문서는 한 번도 파싱되지 않는다. `query` `context` `check` `index` 는
납작한 기록만으로 끝나므로 문서 트리를 아예 세우지 않고, `assemble` `render` `apply` 처럼
트리가 필요한 쪽만 그때 파싱한다.

```bash
dockit store rules        # 저장소를 갱신하고 통계를 낸다
```

```
스냅샷  226425f6d502 (내용 그대로)
뿌리    7cc9ccf2a3e2

문서    4 개 — 캐시 4 · 파싱 0
파일    읽지 않음 21 · 읽음 0
객체    새로 0 · 이미 있어서 건너뜀 3
```

내용 주소화라서 따라오는 성질 둘.

- 같은 진술이 여러 문서에 있으면 저장소에 **한 번만** 담긴다.
- 문서를 고쳤다가 되돌리면 뿌리 주소가 원래 값으로 **정확히** 돌아오고, 스냅샷이 쌓이지 않는다.

저장소는 전부 파생물이다 — 지워도 다음 실행이 다시 만든다. 원본은 마크다운이다.
팩파일과 델타 체인은 두지 않았다. 이유와 필요해질 조건은
[docs/design/0002-객체-저장소.md](docs/design/0002-객체-저장소.md) §7 에 있다.

### 거두기

고침마다 객체가 쌓이므로 거두지 않으면 상한이 없다. 문서 10 개 중 하나를 50 번 고치면
객체가 37 → 429 개가 되고, 그중 작업 트리가 쓰는 것은 여전히 37 개다.

정책은 **초기화할 때** 정하고 그 뒤로 바꾸지 않는다. 둘뿐이다.

| 정책 | 뜻 |
| --- | --- |
| `head` (기본) | HEAD 에서 닿는 것만 남긴다. `gc` 가 나머지를 거두고, **지운 이력은 기록하지 않는다** |
| `all` | 이력을 전부 보존한다. 그 대가로 `gc` 는 돌지 않는다 |

중간값(최근 n 개)을 두지 않은 것은 의도다. 되돌아볼 생각이 있으면 전부 있어야 쓸모가 있고,
없으면 하나만 있으면 된다 — 중간값은 "있는 줄 알았는데 그만큼은 없는" 상태를 만든다.
그래서 정책은 거두기의 매개변수가 아니라 **거두기의 존재 여부**이고, `--force` 로 뚫리지 않는다.

```bash
dockit init rules --retention head    # 규약과 저장 정책을 만든다
dockit gc   rules --dry-run           # 무엇이 거둬질지만 본다
dockit gc   rules
```

스냅샷 둘을 비교하면 바뀐 노드를 주소로 낸다. 주소가 같은 하위 트리는 열지 않으므로 비용이
문서 수가 아니라 바뀐 곳에 비례하고, 블록 하나를 끼워도 뒤 블록들이 바뀐 것으로 나오지 않는다.
`head` 정책에서는 거두기 전까지 쌓인 스냅샷끼리만 비교할 수 있다.

```bash
dockit diff 3f2a9c1e04b7 --root rules            # 그 스냅샷과 HEAD
dockit diff 3f2a9c1e04b7 be4eea285508 --patch    # 본문이 바뀐 블록에 줄 차이를 붙인다
```

```
정책: head (.dockit/store.yaml)
뿌리: cbb59cfefd1d

객체    429 → 37 (거둠 392)
파생     59 → 10 (거둠 49)
```

거두기가 안전한 것은 불변식 하나 때문이다 — **진단은 문서와 규약만의 함수다.** 저장소에 무엇이
담겨 있는지가 결과를 바꾸지 않으므로, 지우는 일의 최악이 다음 실행 한 번 느려지는 것뿐이다.
이 원칙은 `rules/` 에 적혀 있고 테스트가 거두기 전후의 진단을 직접 비교한다.
설계 근거는 [docs/design/0003-거두기.md](docs/design/0003-거두기.md) 에 있다.

## 원칙

노드가 과도한 책임을 갖지 못하게 하는 장치들. 타입으로 막을 수 있는 것은 검사기를 두지 않는다.

| 원칙 | 강제 | 코드 |
| --- | --- | --- |
| 모델과 저장소는 아무것도 import 하지 않는다 | 의존성 테스트 | — |
| 진단은 저장소 상태에 의존하지 않는다 | 거두기 전후 비교 테스트 | — |
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
dockit check   [루트]                          규약과 원칙을 검사한다
dockit index   [루트] --out <디렉터리>          인덱스와 관계 그래프
dockit query   [루트] --role norm --subject …   조건에 맞는 규범 진술
dockit context <파일경로> --root <루트>         그 파일에 적용되는 판단기준
dockit render  [루트] --out <디렉터리>          정적 규칙집
dockit apply   [루트] --commands <파일|-> [--dry-run]

dockit split    [루트] --document <id> [--dry-run] [--replace]
                                                 문서를 노드 디렉터리로 흩는다
dockit assemble [루트] --document <id> [--out <파일>]
                                                 노드 트리를 한 파일로 합친다

dockit store   [루트]                           객체 저장소를 갱신하고 통계를 낸다
dockit log     [루트]                           스냅샷 이력
dockit cat     <주소>                           객체 하나를 들여다본다
dockit gc      [루트] [--dry-run]               작업 트리가 안 쓰는 객체를 거둔다
dockit diff    <앞> [<뒤>] [--patch] [--exit-code]
                                                 두 스냅샷 사이에 바뀐 문서·노드·블록
dockit init    [루트] [--retention head|all] [--preset <이름>] [--force]
                                                 규약과 저장 정책을 만든다
```

`check` 는 오류가 있으면 종료 코드 1 을 낸다. `--strict` 를 주면 경고도 실패로 본다.
`--store <경로>` 로 저장소를 옮길 수 있고, 기본은 루트가 속한 프로젝트의 `.dockit/store` 다
(루트 자신이나 그 부모 중 `.dockit/` 을 가진 쪽 — cwd 가 아니다).

## 에이전트

`query` 는 **규범 진술만** 돌려주고 근거는 주소로만 단다. 왜인지 궁금할 때 한 번 더 묻게
만드는 것이 의도다 — 읽는 쪽의 토큰을 아끼는 것이 이 층의 일이다.

```bash
dockit context src/domain/Order.ts --root rules --json
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

여기에 양쪽 끝이 하나 더 있다.

| 층 | 위치 | 책임 |
| --- | --- | --- |
| L0 객체 저장소 | `src/store/` | 내용 주소·압축·stat 캐시. **바이트만 안다**. 아무것도 import 하지 않는다 |

`model` 과 `store` 가 양쪽 끝에서 아무것도 모르기 때문에, 문서와 바이트를 잇는 일이
`workspace/encode.ts` 한 곳으로 모인다. 층 테스트가 이것을 고정한다.

나머지는 이 위에 얹힌다 — `parse` `serialize` `nodes` `validate` `workspace` `query` `render` `cli`.
무엇이 되어야 하는가는 [요구사항 0.0.1](docs/requirements/0.0.1.md) 에, 왜 그렇게 정했는가는
설계문서에 있다 — [0001 재설계](docs/design/0001-재설계.md) ·
[0002 객체 저장소](docs/design/0002-객체-저장소.md) ·
[0003 거두기](docs/design/0003-거두기.md).

## 개발

```bash
npm run typecheck
npm test
npm run check      # 자기 자신의 판단기준을 자기 자신으로 검사한다
npm run store      # 객체 저장소를 갱신하고 통계를 본다
npm run gc         # 작업 트리가 안 쓰는 객체를 거둔다
```

`rules/` 에는 doc-kit 자신의 원칙이 doc-kit 형식으로 적혀 있다.
