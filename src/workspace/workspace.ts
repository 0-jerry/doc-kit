/**
 * 문서들을 한자리에 모아 역인덱스와 관계 그래프를 만든다.
 * 문서 트리는 서로를 모르므로, 문서 간의 것은 전부 여기가 담당한다.
 */

import type { Diagnostic } from '../diagnostic/index.js'
import type { Document } from '../model/index.js'
import { parseDocument } from '../parse/index.js'
import type { Schema } from '../schema/index.js'
import { validateDocument } from '../validate/index.js'
import { type SourceFile, collectSources } from './collect.js'
import { type RelationGraph, buildGraph } from './graph.js'
import { type NodeRecord, recordsOf } from './record.js'

export interface WorkspaceEntry {
  readonly document: Document
  readonly records: readonly NodeRecord[]
}

export type Inverted = ReadonlyMap<string, readonly string[]>

export class Workspace {
  readonly root: string
  readonly schema: Schema
  readonly entries: readonly WorkspaceEntry[]
  readonly records: readonly NodeRecord[]
  readonly graph: RelationGraph
  readonly diagnostics: readonly Diagnostic[]

  readonly bySubject: Inverted
  readonly byTopic: Inverted
  readonly byRole: Inverted
  readonly byStatus: Inverted
  readonly byCollection: Inverted

  constructor(options: {
    root: string
    schema: Schema
    entries: readonly WorkspaceEntry[]
    diagnostics: readonly Diagnostic[]
  }) {
    this.root = options.root
    this.schema = options.schema
    this.entries = options.entries
    this.records = options.entries.flatMap((entry) => entry.records)
    this.graph = buildGraph(this.records, options.schema)
    this.diagnostics = [...options.diagnostics, ...this.graph.diagnostics]

    this.bySubject = invert(this.records, (record) => record.subject)
    this.byTopic = invert(this.records, (record) => record.topic)
    this.byRole = invert(this.records, (record) => (record.role === null ? [] : [record.role]))
    this.byStatus = invert(this.records, (record) => (record.status === null ? [] : [record.status]))
    this.byCollection = invert(this.records, (record) => [record.collection])
  }

  get documents(): readonly Document[] {
    return this.entries.map((entry) => entry.document)
  }

  document(id: string): Document | null {
    return this.entries.find((entry) => entry.document.id === id)?.document ?? null
  }

  record(address: string): NodeRecord | null {
    return this.records.find((item) => item.address === address) ?? null
  }
}

function invert(
  records: readonly NodeRecord[],
  keysOf: (record: NodeRecord) => readonly string[],
): Inverted {
  const index = new Map<string, string[]>()
  for (const record of records) {
    for (const key of keysOf(record)) {
      index.set(key, [...(index.get(key) ?? []), record.address])
    }
  }
  return index
}

export interface BuildOptions {
  readonly root: string
  readonly schema: Schema
  /** 원칙 검사도 함께 돌릴지. 기본은 돈다. */
  readonly validate?: boolean
}

/** 이미 읽어 온 원문들로 작업공간을 세운다. */
export function buildWorkspace(
  sources: readonly SourceFile[],
  options: BuildOptions,
): Workspace {
  const entries: WorkspaceEntry[] = []
  const diagnostics: Diagnostic[] = []

  for (const source of sources) {
    const result = parseDocument(source.text, {
      schema: options.schema,
      path: source.path,
      collection: source.collection,
      name: source.name,
    })
    diagnostics.push(...result.diagnostics)
    if (result.document === null) continue

    if (options.validate !== false) {
      diagnostics.push(...validateDocument(result.document, options.schema))
    }
    entries.push({ document: result.document, records: recordsOf(result.document) })
  }

  const duplicated = new Map<string, string[]>()
  for (const entry of entries) {
    const id = entry.document.id
    duplicated.set(id, [...(duplicated.get(id) ?? []), entry.document.path])
  }
  for (const [id, paths] of duplicated) {
    if (paths.length < 2) continue
    diagnostics.push({
      code: 'REF005',
      severity: 'error',
      message: `문서 식별자가 겹칩니다: ${id}`,
      document: id,
      hint: `겹치는 파일: ${paths.join(' · ')}`,
    })
  }

  return new Workspace({ root: options.root, schema: options.schema, entries, diagnostics })
}

/** 디렉터리를 읽어 작업공간을 세운다. */
export function loadWorkspace(options: BuildOptions): Workspace {
  return buildWorkspace(collectSources(options.root), options)
}
