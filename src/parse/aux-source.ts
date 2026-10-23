/**
 * 선언된 보조데이터 조각을 모델의 `Aux` 로 옮긴다.
 * frontmatter 와 디렉티브가 같은 경로를 타므로 두 채널의 의미가 갈라지지 않는다.
 */

import {
  type Aux,
  type Lifecycle,
  type Relation,
  aux as makeAux,
  isWellFormedSegment,
} from '../model/index.js'
import type { Schema } from '../schema/index.js'
import type { DirectiveEntry } from './directive.js'

/**
 * 보조데이터가 아니라 노드 자체를 가리키는 키들.
 *
 * - `id` 노드의 안정 식별자 (문서에서는 문서 이름)
 * - `type` 문서 타입
 * - `title` 노드의 제목. 노드 파일에는 제목 줄이 없으므로 여기에 적는다
 * - `order` 형제 사이의 자리. 분수 색인이다 — 노드 파일이 스스로 자기 자리를 안다
 * - `children` 옛 하위 노드 인덱스. 읽기만 한다 (NODE007)
 */
const RESERVED = new Set(['id', 'type', 'title', 'order', 'children'])

/** `order` 의 형식. `0` 으로 끝나면 바로 앞에 끼울 자리가 없으므로 받지 않는다. */
const ORDER_KEY = /^[0-9a-z]*[1-9a-z]$/

const LIFECYCLE_KEYS = new Set(['status', 'since', 'until', 'level'])

export interface AuxSourceResult {
  readonly aux: Aux
  readonly stableId: string | null
  /** `type` `children` 처럼 보조데이터가 아닌 값들. */
  readonly reserved: ReadonlyMap<string, readonly string[]>
  readonly problems: readonly string[]
}

/** YAML 값을 디렉티브와 같은 모양으로 바꾼다. 두 채널을 한 코드로 다루기 위한 것. */
export function entriesFromObject(value: unknown): {
  entries: DirectiveEntry[]
  problems: string[]
} {
  const entries: DirectiveEntry[] = []
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { entries, problems: ['frontmatter 는 키-값 매핑이어야 합니다'] }
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || raw === undefined) continue
    if (Array.isArray(raw)) {
      if (raw.some((item) => typeof item === 'object' && item !== null)) {
        problems.push(`${key}: 목록 항목은 단순한 값이어야 합니다`)
        continue
      }
      entries.push({ key, values: raw.map((item) => String(item)), isList: true })
      continue
    }
    if (typeof raw === 'object') {
      problems.push(`${key}: 중첩된 매핑은 쓸 수 없습니다`)
      continue
    }
    entries.push({ key, values: [String(raw)], isList: false })
  }
  return { entries, problems }
}

/**
 * 조각들을 보조데이터로 옮긴다. 값이 어휘에 있는지는 보지 않는다 —
 * 그 판정은 검증기(P8)가 하고, 여기서는 "어느 자리에 넣을지"만 정한다.
 */
export function buildAux(entries: readonly DirectiveEntry[], schema: Schema): AuxSourceResult {
  const problems: string[] = []
  const reserved = new Map<string, readonly string[]>()
  const subject: string[] = []
  const topic: string[] = []
  const relations: Relation[] = []
  const lifecycle: Record<string, string> = {}
  let role: string | undefined
  let stableId: string | null = null

  for (const entry of entries) {
    const first = entry.values[0]

    if (RESERVED.has(entry.key)) {
      if (entry.key === 'children') {
        // 비어 있는 인덱스는 "자식이 없다"는 뜻이므로 값이 없어도 된다.
        reserved.set('children', entry.values)
        continue
      }
      if (first === undefined) {
        problems.push(`${entry.key}: 값이 필요합니다`)
        continue
      }
      if (entry.key === 'id') {
        // 식별자는 주소의 한 조각이 된다. 구분자가 섞이면 주소를 읽을 수 없게 된다.
        if (!isWellFormedSegment(first)) {
          problems.push(`id 에 주소 문법과 충돌하는 문자가 있습니다: ${first}`)
          continue
        }
        stableId = first
      } else if (entry.key === 'order' && !ORDER_KEY.test(first)) {
        problems.push(`order 는 0-9 a-z 로 적고 0 으로 끝날 수 없습니다: ${first}`)
      } else {
        reserved.set(entry.key, [first])
      }
      continue
    }

    if (entry.key === 'role') {
      if (first === undefined) {
        problems.push('role: 값이 필요합니다')
      } else if (entry.values.length > 1) {
        // 역할이 단수라는 것은 모델이 이미 강제한다 (원칙 P2). 여기서는 왜 잘렸는지 알린다.
        problems.push('role 은 하나만 쓸 수 있습니다. 블록을 나누세요')
      } else {
        role = first
      }
      continue
    }

    if (entry.key === 'subject') {
      subject.push(...entry.values)
      continue
    }

    if (entry.key === 'topic') {
      topic.push(...entry.values)
      continue
    }

    if (LIFECYCLE_KEYS.has(entry.key)) {
      if (first === undefined) problems.push(`${entry.key}: 값이 필요합니다`)
      else if (entry.values.length > 1) problems.push(`${entry.key} 은 하나만 쓸 수 있습니다`)
      else lifecycle[entry.key] = first
      continue
    }

    if (schema.relation(entry.key) !== null) {
      relations.push(...entry.values.map((target) => ({ kind: entry.key, target })))
      continue
    }

    problems.push(
      `규약에 없는 키입니다: ${entry.key}. 쓸 수 있는 관계는 ${schema.relationKinds.join(' · ')}`,
    )
  }

  return {
    aux: makeAux({
      ...(role === undefined ? {} : { role }),
      subject,
      topic,
      lifecycle: lifecycle as Lifecycle,
      relations,
    }),
    stableId,
    reserved,
    problems,
  }
}
