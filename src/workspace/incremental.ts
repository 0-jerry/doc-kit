/**
 * 증분 인덱싱. 바뀌지 않은 문서는 파싱도 검증도 하지 않는다.
 *
 * 단축 경로는 두 단계다.
 *
 *   1. stat 캐시 — 경로의 수정시각과 크기가 그대로면 파일을 읽지 않는다
 *   2. 원본 해시 — 문서를 이루는 파일들의 내용 해시가 그대로면
 *      파싱·검증을 건너뛰고 지난번 기록과 진단을 그대로 쓴다
 *
 * 1 이 읽기를 아끼고, 2 가 실제 비용인 파싱과 검증을 아낀다.
 * 블록 단위 blob 은 셋째 이득이다 — 같은 진술이 여러 문서에 있으면 저장소에 한 번만 담긴다.
 *
 * 문서 객체는 **필요할 때 파싱한다**. 질의·검사·인덱스는 납작한 기록만으로 끝나므로
 * 보통 한 번도 파싱하지 않고, 조립이나 렌더처럼 트리가 필요한 쪽만 값을 치른다.
 */

import { join } from 'node:path'
import type { Diagnostic } from '../diagnostic/index.js'
import type { Document } from '../model/index.js'
import { NODE_FILE, type NodeFiles, nodeFilesAt, readEntries, readNodeTree } from '../nodes/index.js'
import { parseDocument } from '../parse/index.js'
import type { Schema } from '../schema/index.js'
import {
  DerivedCache,
  type ObjectId,
  ObjectStore,
  StatCache,
  canonicalJson,
  contentHash,
} from '../store/index.js'
import { validateDocument } from '../validate/index.js'
import { type DocumentSource, collectSources } from './collect.js'
import { type NodeRecord, recordsOf } from './record.js'
import { writeDocument, writeRoot } from './encode.js'
import { storeDirectoryFor } from './retention.js'
import { Workspace, type WorkspaceEntry } from './workspace.js'

export interface IndexOptions {
  readonly root: string
  readonly schema: Schema
  /** 저장소 디렉터리. 기본은 루트가 속한 프로젝트의 `.dockit/store` (`storeDirectoryFor`). */
  readonly store?: string
  readonly validate?: boolean
  /** 스냅샷을 남길지. 기본은 남긴다. */
  readonly snapshot?: boolean
  /**
   * 참이면 디스크에 아무것도 쓰지 않는다 — 객체·HEAD·파생 캐시·stat 캐시 모두.
   * 쓰였을 객체와 스냅샷은 돌려주는 `store` 안에서만 보인다.
   */
  readonly dryRun?: boolean
}

export interface IndexStats {
  readonly documents: number
  /** 캐시를 써서 파싱하지 않은 문서 수. */
  readonly cached: number
  readonly parsed: number
  readonly files: { hits: number; misses: number }
  readonly objects: { written: number; reused: number }
}

export interface IndexResult {
  readonly workspace: Workspace
  readonly store: ObjectStore
  /** 이번에 쓴 스냅샷의 주소. 내용이 그대로면 지난 주소와 같다. */
  readonly snapshot: ObjectId | null
  /** 지난 스냅샷. 처음이면 null. */
  readonly parent: ObjectId | null
  readonly root: ObjectId
  /** 이번 인덱싱이 실제로 쓴 파생 캐시 열쇠. 거두기가 나머지를 버린다. */
  readonly derivedKeys: readonly ObjectId[]
  readonly stats: IndexStats
}

/** 파생 캐시에 담기는 모양. 문서 트리는 담지 않는다 — 다시 파싱할 수 있다. */
interface Derived {
  readonly tree: ObjectId
  readonly records: readonly NodeRecord[]
  readonly diagnostics: readonly Diagnostic[]
}

/** 문서 하나를 이루는 파일들. 노드 트리는 디렉터리를 타고 내려가며 모은다. */
function filesOf(root: string, source: DocumentSource): string[] {
  if (source.kind === 'file') return [source.path]

  const directory = `${source.collection}/${source.name}`
  const paths: string[] = []
  // 디렉터리마다 한 번만 읽는다. 노드 파일이 있는지와 하위 디렉터리를 같은 목록에서 안다.
  const walk = (relative: string): void => {
    for (const entry of readEntries(join(root, relative))) {
      if (entry.isDirectory) walk(`${relative}/${entry.name}`)
      else if (entry.name === NODE_FILE) paths.push(`${relative}/${NODE_FILE}`)
    }
  }
  walk(directory)
  return paths
}

/** 지연 파싱 항목. `.document` 를 처음 읽을 때 파싱한다. */
class Entry implements WorkspaceEntry {
  #document: Document | null = null

  constructor(
    readonly id: string,
    readonly records: readonly NodeRecord[],
    readonly tree: ObjectId,
    private readonly parse: () => Document | null,
  ) {}

  get document(): Document {
    if (this.#document === null) {
      const parsed = this.parse()
      if (parsed === null) throw new Error(`문서를 다시 읽을 수 없습니다: ${this.id}`)
      this.#document = parsed
    }
    return this.#document
  }
}

/** 문서 하나를 읽어 파싱한다. 캐시가 빗나갔을 때만 부른다. */
function parseSource(
  source: DocumentSource,
  schema: Schema,
  files: NodeFiles,
): { document: Document | null; diagnostics: readonly Diagnostic[] } {
  if (source.kind === 'tree') {
    return readNodeTree({ schema, collection: source.collection, name: source.name, files })
  }
  return parseDocument(source.text, {
    schema,
    path: source.path,
    collection: source.collection,
    name: source.name,
  })
}

/**
 * 디렉터리를 읽어 작업공간을 세우고, 객체 저장소를 갱신한다.
 * 저장소는 전부 파생물이다 — 지워도 다음 실행이 다시 만든다.
 */
export function indexWorkspace(options: IndexOptions): IndexResult {
  const { root, schema } = options
  const directory = options.store ?? storeDirectoryFor(root)
  const dryRun = options.dryRun === true
  const store = new ObjectStore(directory, { dryRun })
  const stat = StatCache.open(root, directory)
  const derived = new DerivedCache(directory)
  const files = nodeFilesAt(root)

  // 규약이 바뀌면 해석 결과가 전부 달라지므로 열쇠에 접어 넣는다.
  const schemaHash = contentHash(canonicalJson(schema.declaration))

  const sources = collectSources(root)
  const entries: WorkspaceEntry[] = []
  const diagnostics: Diagnostic[] = []
  const trees: { id: string; collection: string; tree: ObjectId }[] = []
  const derivedKeys: ObjectId[] = []
  let cached = 0

  for (const source of sources) {
    const id = `${source.collection}/${source.name}`
    const paths = filesOf(root, source)
    const fingerprint = paths
      .sort()
      .map((path) => `${path}\0${stat.hashOf(path) ?? ''}`)
      .join('\n')
    const key = derived.key([schemaHash, fingerprint, String(options.validate !== false)])
    derivedKeys.push(key)

    const hit = derived.get<Derived>(key)
    if (hit !== null && store.has(hit.tree)) {
      cached += 1
      diagnostics.push(...hit.diagnostics)
      entries.push(
        new Entry(id, hit.records, hit.tree, () => parseSource(source, schema, files).document),
      )
      trees.push({ id, collection: source.collection, tree: hit.tree })
      continue
    }

    const result = parseSource(source, schema, files)
    diagnostics.push(...result.diagnostics)
    if (result.document === null) continue

    const own = [...result.diagnostics]
    if (options.validate !== false) {
      const found = validateDocument(result.document, schema)
      own.push(...found)
      diagnostics.push(...found)
    }

    const document = result.document
    const tree = writeDocument(store, document)
    const records = recordsOf(document)
    if (!dryRun) derived.put(key, { tree, records, diagnostics: own } satisfies Derived)

    entries.push(new Entry(id, records, tree, () => document))
    trees.push({ id, collection: source.collection, tree })
  }

  reportDuplicates(entries, sources, diagnostics)

  const rootTree = writeRoot(store, trees)
  const parent = store.head()
  let snapshot: ObjectId | null = null

  if (options.snapshot !== false) {
    const previous = parent === null ? null : store.snapshot(parent)
    // 내용이 그대로면 새 스냅샷을 쌓지 않는다 — 이력은 변화만 담는다.
    if (previous !== null && previous.root === rootTree) {
      snapshot = parent
    } else {
      snapshot = store.writeSnapshot({
        parents: parent === null ? [] : [parent],
        root: rootTree,
        meta: { at: new Date().toISOString(), schema: schemaHash, documents: trees.length },
      })
      store.setHead(snapshot)
    }
  }

  if (!dryRun) stat.save()

  return {
    workspace: new Workspace({ root, schema, entries, diagnostics }),
    store,
    snapshot,
    parent,
    root: rootTree,
    derivedKeys,
    stats: {
      documents: sources.length,
      cached,
      parsed: sources.length - cached,
      files: { ...stat.stats },
      objects: { ...store.stats },
    },
  }
}

/** REF005 — 식별자가 겹치는 문서. 캐시를 타도 빠지지 않게 여기서 본다. */
function reportDuplicates(
  entries: readonly WorkspaceEntry[],
  sources: readonly DocumentSource[],
  diagnostics: Diagnostic[],
): void {
  const paths = new Map<string, string[]>()
  for (const source of sources) {
    const id = `${source.collection}/${source.name}`
    paths.set(id, [...(paths.get(id) ?? []), source.path])
  }
  for (const entry of entries) {
    const found = paths.get(entry.id) ?? []
    if (found.length < 2) continue
    paths.delete(entry.id)
    diagnostics.push({
      code: 'REF005',
      severity: 'error',
      message: `문서 식별자가 겹칩니다: ${entry.id}`,
      document: entry.id,
      hint: `겹치는 파일: ${found.join(' · ')}`,
    })
  }
}

/** 저장소를 열기만 한다. 이력을 읽을 때 쓴다. 디렉터리를 주지 않으면 루트에 딸린 저장소다. */
export function openStore(directory?: string, root = 'rules'): ObjectStore {
  return new ObjectStore(directory ?? storeDirectoryFor(root))
}
