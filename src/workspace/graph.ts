/**
 * 문서 사이의 관계만 본다. 문서 안의 일은 검증기가 이미 끝냈다.
 * 여기서 보는 것은 트리로 표현할 수 없는 것들 — 링크, 순환, 중복이다.
 */

import { type Diagnostic, diagnostic } from '../diagnostic/index.js'
import { isDocumentFragment, parseAddress } from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { type NodeRecord, normalizeText } from './record.js'

export interface Edge {
  readonly kind: string
  readonly from: string
  readonly to: string
}

export interface RelationGraph {
  readonly edges: readonly Edge[]
  readonly diagnostics: readonly Diagnostic[]
}

function report(
  code: string,
  severity: 'error' | 'warning',
  message: string,
  record: NodeRecord,
  hint?: string,
): Diagnostic {
  return diagnostic({
    code,
    severity,
    message,
    document: record.document,
    address: record.address,
    path: record.path,
    ...(record.line === null ? {} : { line: record.line }),
    ...(hint === undefined ? {} : { hint }),
  })
}

/** 주소가 가리키는 대상이 실제로 있는지 볼 수 있게 만든 색인. */
function addressIndex(records: readonly NodeRecord[]): {
  documents: Set<string>
  addresses: Set<string>
} {
  const documents = new Set<string>()
  const addresses = new Set<string>()
  for (const record of records) {
    documents.add(record.document)
    addresses.add(record.address)
    if (record.stableId !== null) addresses.add(`${record.document}#${record.stableId}`)
  }
  return { documents, addresses }
}

/** REF002 — 가리키는 곳이 없는 링크. */
function checkTargets(records: readonly NodeRecord[]): Diagnostic[] {
  const { documents, addresses } = addressIndex(records)
  const diagnostics: Diagnostic[] = []

  for (const record of records) {
    for (const relation of record.relations) {
      const parsed = parseAddress(relation.target)
      if (parsed === null) continue // 형식 자체가 틀린 것은 AUX005 가 본다
      const exists =
        parsed.fragment === null
          ? documents.has(parsed.document)
          : addresses.has(relation.target)
      if (exists) continue
      diagnostics.push(
        report('REF002', 'error', `가리키는 곳이 없습니다: ${relation.target}`, record,
          documents.has(parsed.document)
            ? '문서는 있지만 그 안에 그런 노드가 없습니다. 안정 식별자를 확인하세요'
            : '문서 자체가 없습니다'),
      )
    }
  }
  return diagnostics
}

/**
 * REF006 — 위치 주소로 건 링크.
 *
 * `#norm/2` 는 형제 중 몇 번째인지를 말한다. 다른 브랜치가 그 앞에 블록 하나만 끼워도
 * 링크는 **다른 노드**를 가리키게 되고, 가리키는 곳이 있으므로 REF002 도 나지 않는다.
 * 텍스트 병합이 놓치는 깨짐이므로 오류로 막는다.
 */
function checkStableTargets(records: readonly NodeRecord[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const record of records) {
    for (const relation of record.relations) {
      const parsed = parseAddress(relation.target)
      if (parsed === null || isDocumentFragment(parsed.fragment)) continue
      if (parsed.fragment!.kind === 'stable') continue
      diagnostics.push(
        report('REF006', 'error', `위치 주소로 건 링크입니다: ${relation.target}`, record,
          '위치 주소는 다른 편집에 밀려 다른 노드를 가리키게 됩니다. 대상에 `<!-- dk: id=… -->` 로 이름을 주고 그 이름으로 거세요'),
      )
    }
  }
  return diagnostics
}

/** REF003 — 비순환이어야 하는 관계의 순환. */
function checkCycles(records: readonly NodeRecord[], schema: Schema): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const byAddress = new Map(records.map((record) => [record.address, record]))
  const alias = new Map<string, string>()
  for (const record of records) {
    if (record.stableId !== null) alias.set(`${record.document}#${record.stableId}`, record.address)
  }
  const canonical = (address: string): string => alias.get(address) ?? address

  for (const kind of schema.relationKinds) {
    if (schema.relation(kind)?.acyclic !== true) continue

    const declared = new Map<string, string[]>()
    for (const record of records) {
      const targets = record.relations
        .filter((relation) => relation.kind === kind)
        .map((relation) => canonical(relation.target))
      if (targets.length > 0) declared.set(record.address, targets)
    }

    /**
     * 문서에 선언된 관계는 그 문서의 모든 노드에 적용된다 — 보조데이터의 적용 범위가
     * 그렇기 때문이다. 이것을 세지 않으면 frontmatter 로 이뤄진 순환을 전부 놓친다.
     */
    const next = new Map<string, string[]>()
    for (const record of records) {
      const own = declared.get(record.address) ?? []
      const fromDocument =
        record.address === record.document ? [] : (declared.get(record.document) ?? [])
      const targets = [...new Set([...own, ...fromDocument])].filter(
        (target) => target !== record.address,
      )
      if (targets.length > 0) next.set(record.address, targets)
    }

    const state = new Map<string, 'visiting' | 'done'>()
    const walk = (address: string, trail: readonly string[]): void => {
      const mark = state.get(address)
      if (mark === 'done') return
      if (mark === 'visiting') {
        const record = byAddress.get(address)
        if (record !== undefined) {
          diagnostics.push(
            report('REF003', 'error', `'${kind}' 관계가 순환합니다: ${[...trail, address].join(' → ')}`,
              record, '가장 좁은 것이 가장 넓은 것을 다시 가리키고 있습니다'),
          )
        }
        return
      }
      state.set(address, 'visiting')
      for (const target of next.get(address) ?? []) walk(target, [...trail, address])
      state.set(address, 'done')
    }

    for (const address of next.keys()) walk(address, [])
  }
  return diagnostics
}

/** REF004 — 짝이 맞아야 하는 관계가 한쪽만 걸린 경우. */
function checkSymmetry(records: readonly NodeRecord[], schema: Schema): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const alias = new Map<string, string>()
  for (const record of records) {
    if (record.stableId !== null) alias.set(`${record.document}#${record.stableId}`, record.address)
  }
  const canonical = (address: string): string => alias.get(address) ?? address
  const byAddress = new Map(records.map((record) => [record.address, record]))

  for (const record of records) {
    for (const relation of record.relations) {
      const spec = schema.relation(relation.kind)
      if (spec === null) continue
      const inverse = spec.symmetric ? relation.kind : spec.inverse
      if (inverse === undefined) continue

      const target = byAddress.get(canonical(relation.target))
      if (target === undefined) continue // REF002 가 본다
      const mirrored = target.relations.some(
        (other) =>
          other.kind === inverse && canonical(other.target) === record.address,
      )
      if (mirrored) continue
      diagnostics.push(
        report('REF004', 'warning', `'${relation.kind}' 의 짝이 걸려 있지 않습니다: ${relation.target}`,
          record, `대상 쪽에 '${inverse}' 로 되걸어야 합니다`),
      )
    }
  }
  return diagnostics
}

/**
 * REF001 — 같은 진술이 두 곳에 적혀 있는 경우. 링크로 잇는 편이 낫다.
 *
 * 판정은 **정규화한 본문**으로 한다. blob 주소로 바꾸고 싶어지지만 그러면 안 된다 —
 * 주소는 바이트 정확이라 공백·대소문자 차이를 못 잡고, 저장소에는 이미 사라진
 * 과거 판본의 블록도 들어 있다. 진단이 저장소 상태에 의존하면 거두기가 진단을 바꾼다.
 */
function checkDuplicates(records: readonly NodeRecord[]): Diagnostic[] {
  const groups = new Map<string, NodeRecord[]>()
  for (const record of records) {
    if (record.kind !== 'block' || record.role === null) continue
    const normalized = normalizeText(record.text)
    if (normalized.length < 10) continue
    const key = `${record.role}:${normalized}`
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [record])
    else bucket.push(record)
  }

  const diagnostics: Diagnostic[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const [first, ...rest] = group
    for (const record of rest) {
      diagnostics.push(
        report('REF001', 'warning', `같은 진술이 이미 있습니다: ${first!.address}`, record,
          '내용을 복제하는 대신 관계 링크로 이으세요'),
      )
    }
  }
  return diagnostics
}

export function buildGraph(records: readonly NodeRecord[], schema: Schema): RelationGraph {
  const edges: Edge[] = records.flatMap((record) =>
    record.relations.map((relation) => ({
      kind: relation.kind,
      from: record.address,
      to: relation.target,
    })),
  )

  return {
    edges,
    diagnostics: [
      ...checkTargets(records),
      ...checkStableTargets(records),
      ...checkCycles(records, schema),
      ...checkSymmetry(records, schema),
      ...checkDuplicates(records),
    ],
  }
}
