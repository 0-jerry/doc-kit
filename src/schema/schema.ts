/**
 * 규약에 대한 질의에만 답한다. 검사를 실행하지 않고 문서도 모른다.
 * "이 타입에 어떤 섹션이 있는가"는 알지만 "이 문서가 그 섹션을 지켰는가"는 모른다.
 */

import type {
  Declaration,
  DocumentTypeSpec,
  Limits,
  RelationSpec,
  RoleSpec,
  SectionSpec,
  VocabularySpec,
} from './declaration.js'

/** 어휘 이름. 모델의 보조데이터 키와 짝을 이룬다. */
export type VocabularyName = 'subject' | 'topic' | 'status' | 'level' | (string & {})

interface TypeIndex {
  /** 키 경로(`rationale/detail`) → 섹션 선언. */
  readonly byPath: ReadonlyMap<string, SectionSpec>
  /** 정규화된 제목 → 키 경로. 중첩 섹션까지 모두 담는다. */
  readonly byHeading: ReadonlyMap<string, string>
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, ' ')
}

function indexSections(specs: readonly SectionSpec[]): TypeIndex {
  const byPath = new Map<string, SectionSpec>()
  const byHeading = new Map<string, string>()

  const walk = (sections: readonly SectionSpec[], prefix: readonly string[]): void => {
    for (const spec of sections) {
      const path = [...prefix, spec.key]
      const joined = path.join('/')
      byPath.set(joined, spec)
      for (const heading of [spec.heading, ...spec.aliases]) {
        const key = normalizeHeading(heading)
        // 먼저 선언된 쪽이 이긴다. 중복 제목은 검증기가 보고한다.
        if (!byHeading.has(key)) byHeading.set(key, joined)
      }
      walk(spec.sections, path)
    }
  }

  walk(specs, [])
  return { byPath, byHeading }
}

export class Schema {
  readonly declaration: Declaration
  readonly #types: ReadonlyMap<string, TypeIndex>

  constructor(declaration: Declaration) {
    this.declaration = declaration
    this.#types = new Map(
      Object.entries(declaration.documentTypes).map(([name, spec]) => [
        name,
        indexSections(spec.sections),
      ]),
    )
  }

  get limits(): Limits {
    return this.declaration.limits
  }

  get documentTypeNames(): readonly string[] {
    return Object.keys(this.declaration.documentTypes)
  }

  get collectionNames(): readonly string[] {
    return Object.keys(this.declaration.collections)
  }

  /** 디렉터리 이름이 어떤 문서 타입인지. 선언되지 않았으면 null. */
  typeForCollection(collection: string): string | null {
    return this.declaration.collections[collection] ?? null
  }

  documentType(type: string): DocumentTypeSpec | null {
    return this.declaration.documentTypes[type] ?? null
  }

  /** 타입의 최상위 섹션 선언들. */
  sectionsOf(type: string): readonly SectionSpec[] {
    return this.documentType(type)?.sections ?? []
  }

  /** 키 경로로 섹션 선언을 찾는다. 예: `['rationale', 'detail']` */
  sectionAt(type: string, path: readonly string[]): SectionSpec | null {
    return this.#types.get(type)?.byPath.get(path.join('/')) ?? null
  }

  /** 제목에 대응하는 키 경로. 규약에 없는 제목이면 null. */
  sectionPathForHeading(type: string, heading: string): readonly string[] | null {
    const found = this.#types.get(type)?.byHeading.get(normalizeHeading(heading))
    return found === undefined ? null : found.split('/')
  }

  /** 섹션이 정한 기본 역할. 블록이 스스로 선언하지 않았을 때 쓴다. */
  defaultRoleAt(type: string, path: readonly string[]): string | null {
    return this.sectionAt(type, path)?.defaultRole ?? null
  }

  role(name: string): RoleSpec | null {
    return this.declaration.roles[name] ?? null
  }

  get roleNames(): readonly string[] {
    return Object.keys(this.declaration.roles)
  }

  vocabulary(name: VocabularyName): VocabularySpec | null {
    return this.declaration.vocabularies[name] ?? null
  }

  /** 닫힌 어휘에서 허용되는 값인가. 열린 어휘는 늘 참이다. */
  allowsValue(name: VocabularyName, value: string): boolean {
    const vocabulary = this.vocabulary(name)
    if (vocabulary === null || !vocabulary.closed) return true
    return vocabulary.values.includes(value)
  }

  /**
   * 순서 있는 어휘에서 값의 강도. 작을수록 강하다.
   * 순서가 없거나 모르는 값이면 null — 비교하지 않는다는 뜻이다.
   */
  rankOf(name: VocabularyName, value: string): number | null {
    const vocabulary = this.vocabulary(name)
    if (vocabulary === null || !vocabulary.ordered) return null
    const rank = vocabulary.values.indexOf(value)
    return rank === -1 ? null : rank
  }

  /** 어휘 값에 딸린 경로 글롭. 도구는 이 매핑을 해석만 하고 만들지 않는다. */
  pathsOf(name: VocabularyName, value: string): readonly string[] {
    return this.vocabulary(name)?.paths[value] ?? []
  }

  /** 경로 매핑을 가진 값들. */
  valuesWithPaths(name: VocabularyName): readonly string[] {
    return Object.keys(this.vocabulary(name)?.paths ?? {})
  }

  relation(kind: string): RelationSpec | null {
    return this.declaration.relations[kind] ?? null
  }

  get relationKinds(): readonly string[] {
    return Object.keys(this.declaration.relations)
  }
}
