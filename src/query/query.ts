/**
 * 에이전트가 맥락에 맞는 판단기준만 싸게 읽게 하는 질의.
 *
 * 규범 진술만 돌려주고 근거는 링크로만 단다. 왜인지 궁금할 때 한 번 더
 * 물어보게 만드는 것이 의도다 — 읽는 쪽의 토큰을 아끼는 것이 이 층의 일이다.
 */

import type { NodeRecord } from '../workspace/record.js'
import type { Workspace } from '../workspace/workspace.js'

export interface QueryFilter {
  readonly subject?: readonly string[]
  readonly topic?: readonly string[]
  readonly role?: readonly string[]
  readonly status?: readonly string[]
  readonly level?: readonly string[]
  readonly collection?: readonly string[]
  readonly documentType?: readonly string[]
  /** 본문에 이 문자열을 담은 것만. 대소문자를 가리지 않는다. */
  readonly text?: string
  /** 블록만 볼지. 기본은 블록만 본다. */
  readonly kind?: NodeRecord['kind']
}

export interface QueryHit {
  readonly address: string
  readonly document: string
  readonly breadcrumb: readonly string[]
  readonly role: string | null
  readonly subject: readonly string[]
  readonly topic: readonly string[]
  readonly status: string | null
  readonly level: string | null
  readonly text: string
  /** 같은 문서 안에서 이 진술을 받치는 노드들의 주소. 본문은 붙이지 않는다. */
  readonly support: readonly string[]
  readonly relations: readonly { kind: string; target: string }[]
}

const SUPPORT_ROLES = new Set(['rationale', 'example', 'counter-example', 'exception'])

function includesAny(values: readonly string[], wanted: readonly string[] | undefined): boolean {
  if (wanted === undefined || wanted.length === 0) return true
  return wanted.some((value) => values.includes(value))
}

function matches(record: NodeRecord, filter: QueryFilter): boolean {
  if (record.kind !== (filter.kind ?? 'block')) return false
  if (!includesAny(record.subject, filter.subject)) return false
  if (!includesAny(record.topic, filter.topic)) return false
  if (!includesAny(record.role === null ? [] : [record.role], filter.role)) return false
  if (!includesAny(record.status === null ? [] : [record.status], filter.status)) return false
  if (!includesAny(record.level === null ? [] : [record.level], filter.level)) return false
  if (!includesAny([record.collection], filter.collection)) return false
  if (!includesAny([record.documentType], filter.documentType)) return false
  if (filter.text !== undefined) {
    return record.text.toLowerCase().includes(filter.text.toLowerCase())
  }
  return true
}

export function query(workspace: Workspace, filter: QueryFilter = {}): QueryHit[] {
  const byDocument = new Map<string, NodeRecord[]>()
  for (const record of workspace.records) {
    byDocument.set(record.document, [...(byDocument.get(record.document) ?? []), record])
  }

  return workspace.records.filter((record) => matches(record, filter)).map((record) => ({
    address: record.address,
    document: record.document,
    breadcrumb: record.breadcrumb,
    role: record.role,
    subject: record.subject,
    topic: record.topic,
    status: record.status,
    level: record.level,
    text: record.text,
    support: (byDocument.get(record.document) ?? [])
      .filter((other) => other.role !== null && SUPPORT_ROLES.has(other.role))
      .map((other) => other.address),
    relations: record.relations,
  }))
}
