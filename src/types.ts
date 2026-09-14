import type { Root, RootContent } from 'mdast'
import type { VFile } from 'vfile'

/** 규칙의 강제 수준. lint 결과의 심각도로 그대로 매핑된다. */
export type Severity = 'error' | 'warning' | 'info'

/** 규칙의 수명 주기 상태. */
export type RuleStatus = 'proposed' | 'active' | 'deprecated' | 'superseded'

/** 규칙 간 관계의 종류. 그래프의 간선 레이블이 된다. */
export type RelationKind =
  | 'extends'
  | 'related'
  | 'conflicts'
  | 'supersedes'
  | 'supersededBy'

/** frontmatter 에서 선언하는 규칙 메타데이터(검증 후 정규화된 형태). */
export interface RuleMeta {
  id: string
  title: string
  /** 한 줄 요약. 목록 조회에서 본문을 읽지 않고도 고르게 한다. */
  summary?: string
  category: string
  severity: Severity
  status: RuleStatus
  since?: string
  tags: string[]
  appliesTo: string[]
  /** 프로젝트가 정의하는 자유 차원의 적용 범위. 예: `{ package: ['Domain'] }` */
  scope: Record<string, string[]>
  enforcedBy: EnforcementRef[]
  extends: string[]
  related: string[]
  conflicts: string[]
  supersedes: string[]
  supersededBy?: string
}

/** 규칙을 자동으로 강제하는 도구 참조. `swiftlint:type_name` 같은 형태. */
export interface EnforcementRef {
  tool: string
  rule?: string
}

/** 본문에서 추출된 섹션 하나. */
export interface RuleSection {
  /** 정규화된 슬러그. 예: `rule`, `why`, `examples`, `exceptions` */
  key: string
  heading: string
  depth: number
  /** 서식을 제거한 평문. 검색/요약에 사용한다. */
  text: string
  /** 제목을 뺀 섹션 본문의 mdast 노드. 렌더러가 서식을 살려 쓰는 원본이다. */
  content: RootContent[]
  codeBlocks: CodeBlock[]
  /** 최상위 목록 항목 수. 열거형 규범 진술의 크기를 재는 데 쓴다. */
  listItems: number
}

export interface CodeBlock {
  lang: string | null
  meta: string | null
  /** 첫 줄 주석에서 추출한 예시 극성. `// WRONG` → 'wrong' */
  polarity: 'right' | 'wrong' | null
  /** 블록 전체에서 발견된 극성 표식. 한 블록이 대비 예시를 모두 담는 경우를 위해. */
  markers: ('right' | 'wrong')[]
  value: string
  line: number
}

/** 파싱·검증을 마친 규칙 하나. 인덱스의 레코드 단위. */
export interface Rule {
  meta: RuleMeta
  /** 저장소 루트 기준 상대 경로. */
  path: string
  /** 규범 진술 한 문단(= `## Rule` 섹션의 평문). */
  statement: string
  sections: RuleSection[]
  /** 본문 원문의 SHA-256 앞 12자리. 변경 감지에 사용. */
  digest: string
}

/** 단일 파일 파싱 결과. `rule` 이 null 이면 치명적 오류로 레코드를 만들지 못한 것. */
export interface ParseResult {
  file: VFile
  tree: Root
  rule: Rule | null
}

/** 규칙 모음 전체. */
export interface RuleSet {
  root: string
  rules: Rule[]
  files: VFile[]
}
