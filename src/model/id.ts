/**
 * 노드 주소의 계산·형식화·비교만 담당한다.
 * 노드의 내용도, 스키마도 모른다.
 *
 * 주소 형식:
 *   `principle/불변식은-생성자에서-검증한다`          문서
 *   `principle/불변식은-생성자에서-검증한다#core`      안정 주소 (참조용)
 *   `principle/불변식은-생성자에서-검증한다#norm/2`    위치 주소 (편집용)
 */

/** 컬렉션 식별자. 디렉터리명과 일치한다. */
export type CollectionId = string

/** 문서 식별자. `<collection>/<name>`. */
export type DocumentId = string

/** 식별자에 쓸 수 없는 문자. 주소 문법의 구분자들이다. */
const FORBIDDEN = /[\s#/~[\]]/

/** 식별자 한 조각이 주소 문법과 충돌하지 않는지 본다. */
export function isWellFormedSegment(value: string): boolean {
  return value.length > 0 && !FORBIDDEN.test(value)
}

export function formatDocumentId(collection: CollectionId, name: string): DocumentId {
  if (!isWellFormedSegment(collection)) {
    throw new RangeError(`컬렉션 식별자에 쓸 수 없는 문자가 있습니다: ${collection}`)
  }
  if (!isWellFormedSegment(name)) {
    throw new RangeError(`문서 식별자에 쓸 수 없는 문자가 있습니다: ${name}`)
  }
  return `${collection}/${name}`
}

export function parseDocumentId(id: DocumentId): { collection: CollectionId; name: string } | null {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) return null
  const collection = id.slice(0, slash)
  const name = id.slice(slash + 1)
  if (!isWellFormedSegment(collection) || !isWellFormedSegment(name)) return null
  return { collection, name }
}

/** 위치 주소의 한 걸음. 섹션은 키로, 그 밖은 형제 중 몇 번째인지로 가리킨다. */
export type PathStep = SectionStep | IndexStep

export interface SectionStep {
  readonly kind: 'section'
  readonly key: string
  /** 같은 키를 가진 형제 섹션 중 몇 번째인지. 1부터 센다. */
  readonly occurrence: number
}

export interface IndexStep {
  readonly kind: 'index'
  /** 형제 중 몇 번째인지. 0부터 센다. */
  readonly index: number
}

/**
 * 섹션 키로 쓸 수 있는가.
 *
 * 주소 문법과 충돌하지 않아야 하고, **숫자로만 이뤄질 수 없다** —
 * `#norm/2` 의 `2` 는 형제 인덱스이므로 키가 `2` 이면 두 걸음을 가릴 수 없다.
 */
export function isSectionKey(key: string): boolean {
  return isWellFormedSegment(key) && !/^\d+$/.test(key)
}

export function sectionStep(key: string, occurrence = 1): SectionStep {
  if (!isSectionKey(key)) {
    throw new RangeError(`섹션 키로 쓸 수 없습니다: ${key}`)
  }
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new RangeError(`섹션 순번은 1 이상의 정수여야 합니다: ${occurrence}`)
  }
  return { kind: 'section', key, occurrence }
}

export function indexStep(index: number): IndexStep {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`형제 인덱스는 0 이상의 정수여야 합니다: ${index}`)
  }
  return { kind: 'index', index }
}

/** 문서 안에서 노드를 가리키는 조각. */
export type Fragment =
  | { readonly kind: 'stable'; readonly id: string }
  | { readonly kind: 'path'; readonly steps: readonly PathStep[] }

export function stableFragment(id: string): Fragment {
  return { kind: 'stable', id }
}

export function pathFragment(steps: readonly PathStep[]): Fragment {
  return { kind: 'path', steps }
}

/** 문서 전체 또는 그 안의 한 노드를 가리키는 주소. */
export interface Address {
  readonly document: DocumentId
  /** null 이면 문서 자신을 가리킨다. */
  readonly fragment: Fragment | null
}

export function formatStep(step: PathStep): string {
  if (step.kind === 'index') return String(step.index)
  return step.occurrence === 1 ? step.key : `${step.key}~${step.occurrence}`
}

/** 한 걸음을 읽는다. 순수 숫자는 형제 인덱스, 그 밖은 섹션 키다. */
export function parseStep(raw: string): PathStep | null {
  if (raw.length === 0) return null
  if (/^\d+$/.test(raw)) return indexStep(Number(raw))
  const tilde = raw.lastIndexOf('~')
  if (tilde > 0) {
    const key = raw.slice(0, tilde)
    const occurrence = raw.slice(tilde + 1)
    if (!/^\d+$/.test(occurrence) || Number(occurrence) < 1) return null
    if (!isSectionKey(key)) return null
    return sectionStep(key, Number(occurrence))
  }
  if (!isSectionKey(raw)) return null
  return sectionStep(raw)
}

/** 걸음이 없는 경로 조각은 문서 자신을 뜻하므로 빈 문자열이 된다. */
export function formatFragment(fragment: Fragment): string {
  return fragment.kind === 'stable'
    ? fragment.id
    : fragment.steps.map(formatStep).join('/')
}

/** 조각이 문서 자신을 가리키는가. */
export function isDocumentFragment(fragment: Fragment | null): boolean {
  return fragment === null || (fragment.kind === 'path' && fragment.steps.length === 0)
}

/**
 * 조각 하나를 읽는다.
 *
 * `#core` 처럼 걸음이 하나뿐이면 안정 식별자인지 섹션 키인지 문법만으로는
 * 가릴 수 없다. 모델은 안정 식별자로 읽고, 해석(`Document.resolve`) 단계에서
 * 안정 식별자 → 섹션 키 순으로 시도한다. 둘이 충돌하는 경우는 검증기가 잡는다.
 */
export function parseFragment(raw: string): Fragment | null {
  if (raw.length === 0) return null
  if (!raw.includes('/')) {
    return isWellFormedSegment(raw) ? stableFragment(raw) : null
  }
  const steps: PathStep[] = []
  for (const part of raw.split('/')) {
    const step = parseStep(part)
    if (step === null) return null
    steps.push(step)
  }
  return pathFragment(steps)
}

export function formatAddress(address: Address): string {
  return isDocumentFragment(address.fragment)
    ? address.document
    : `${address.document}#${formatFragment(address.fragment!)}`
}

export function parseAddress(raw: string): Address | null {
  const hash = raw.indexOf('#')
  const documentPart = hash === -1 ? raw : raw.slice(0, hash)
  if (parseDocumentId(documentPart) === null) return null
  if (hash === -1) return { document: documentPart, fragment: null }
  const fragment = parseFragment(raw.slice(hash + 1))
  if (fragment === null) return null
  return { document: documentPart, fragment }
}

export function stepEquals(a: PathStep, b: PathStep): boolean {
  if (a.kind === 'index' && b.kind === 'index') return a.index === b.index
  if (a.kind === 'section' && b.kind === 'section') {
    return a.key === b.key && a.occurrence === b.occurrence
  }
  return false
}

/** 형식화 결과가 아니라 구조로 비교한다 — 종류가 다른 걸음은 결코 같지 않다. */
export function fragmentEquals(a: Fragment | null, b: Fragment | null): boolean {
  if (isDocumentFragment(a) || isDocumentFragment(b)) {
    return isDocumentFragment(a) && isDocumentFragment(b)
  }
  if (a!.kind !== b!.kind) return false
  if (a!.kind === 'stable' && b!.kind === 'stable') return a!.id === b!.id
  if (a!.kind === 'path' && b!.kind === 'path') {
    const left = a!.steps
    const right = b!.steps
    return left.length === right.length && left.every((step, i) => stepEquals(step, right[i]!))
  }
  return false
}

export function addressEquals(a: Address, b: Address): boolean {
  return a.document === b.document && fragmentEquals(a.fragment, b.fragment)
}
