/**
 * 노드 하나를 문서 밖에서도 다룰 수 있는 납작한 기록으로 편다.
 * 인덱스·질의·렌더가 공유하는 표현이며, 그대로 JSON 이 된다.
 */

import {
  Block,
  type Document,
  Section,
  type Visit,
  effectiveAux,
  formatAddress,
  pathFragment,
} from '../model/index.js'

export interface NodeRecord {
  /** `principle/문서#norm/0` 형태의 전체 주소. */
  readonly address: string
  readonly document: string
  readonly documentType: string
  readonly collection: string
  readonly path: string
  readonly kind: 'document' | 'section' | 'block'
  readonly stableId: string | null
  /** 조상들의 제목. 이 노드가 어디에 놓였는지 한 줄로 보여준다. */
  readonly breadcrumb: readonly string[]
  readonly role: string | null
  readonly subject: readonly string[]
  readonly topic: readonly string[]
  readonly status: string | null
  readonly level: string | null
  readonly relations: readonly { kind: string; target: string }[]
  readonly form: string | null
  readonly text: string
  readonly line: number | null
}

function breadcrumbOf(visit: Visit): string[] {
  return visit.ancestors
    .filter((node): node is Section => node.kind === 'section')
    .map((node) => node.heading)
}

export function recordOf(document: Document, visit: Visit): NodeRecord {
  const aux = effectiveAux(visit)
  const { node } = visit
  const collection = document.id.slice(0, document.id.indexOf('/'))

  return {
    address: formatAddress({ document: document.id, fragment: pathFragment(visit.path) }),
    document: document.id,
    documentType: document.type,
    collection,
    path: document.path,
    kind: node.kind,
    stableId: node.stableId,
    breadcrumb: breadcrumbOf(visit),
    role: aux.role ?? null,
    subject: aux.subject,
    topic: aux.topic,
    status: aux.lifecycle.status ?? null,
    level: aux.lifecycle.level ?? null,
    relations: aux.relations.map((relation) => ({ ...relation })),
    form: node instanceof Block ? node.form : null,
    text: node instanceof Block ? node.text : node instanceof Section ? node.heading : '',
    line: node instanceof Block || node instanceof Section ? node.line : null,
  }
}

/** 문서 하나를 기록 목록으로 편다. 문서 자신도 하나의 기록이다. */
export function recordsOf(document: Document): NodeRecord[] {
  return [document.self(), ...document.walk()].map((visit) => recordOf(document, visit))
}

/** 내용이 같은 진술을 찾기 위한 정규화. 공백과 대소문자 차이는 무시한다. */
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}
