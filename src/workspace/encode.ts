/**
 * 문서 트리를 객체로 옮긴다. 저장소는 바이트만 알고 문서를 모르므로,
 * 둘을 잇는 일은 이 파일 하나가 맡는다. 의존은 한 방향이다 — workspace → store.
 *
 * 블록이 blob, 노드가 tree 다. 이 대응은 억지가 아니라 이미 모델에 있던 것이다:
 * 노드는 "자기가 정의한 내용과 하위 노드 인덱스"만 소유하고 부모는 자식의 내용을
 * 갖지 않는데, 그것이 바로 tree 의 정의다.
 *
 * 무엇을 해싱하고 무엇을 빼는지가 이 파일의 전부다.
 *
 *   담는다 — 본문·형태·보조데이터·순서·제목·식별자
 *   뺀다   — 줄 번호·파일 경로·원문 조각
 *
 * 뺀 것들은 **내용이 아니라 위치**다. 파일을 옮기거나 위쪽에 줄을 넣어도 주소가
 * 그대로여야 캐시가 살아남는다.
 */

import {
  type Aux,
  Block,
  type Child,
  type Document,
  Section,
} from '../model/index.js'
import { type ObjectId, type ObjectStore, type TreeEntry } from '../store/index.js'

/** 보조데이터의 정규형. 빈 것은 떨어뜨려 같은 뜻이면 같은 바이트가 되게 한다. */
function auxMeta(aux: Aux): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {}
  if (aux.role !== undefined) meta.role = aux.role
  if (aux.subject.length > 0) meta.subject = [...aux.subject]
  if (aux.topic.length > 0) meta.topic = [...aux.topic]
  if (Object.keys(aux.lifecycle).length > 0) meta.lifecycle = { ...aux.lifecycle }
  if (aux.relations.length > 0) {
    meta.relations = aux.relations.map((relation) => ({ ...relation }))
  }
  return Object.keys(meta).length === 0 ? undefined : meta
}

function childEntry(store: ObjectStore, child: Child): TreeEntry {
  const meta = auxMeta(child.aux)

  if (child instanceof Block) {
    return {
      kind: 'blob',
      // 블록에는 이름이 없다. 자리로 구분되고, 안정 식별자가 있으면 그것을 쓴다.
      name: child.stableId ?? '',
      meta: { form: child.form, ...(meta === undefined ? {} : { aux: meta }) },
      id: store.writeBlob(child.text),
    }
  }

  return { kind: 'tree', name: child.key, id: writeSection(store, child) }
}

function writeSection(store: ObjectStore, section: Section): ObjectId {
  const meta = auxMeta(section.aux)
  return store.writeTree({
    meta: {
      key: section.key,
      heading: section.heading,
      depth: section.depth,
      ...(section.stableId === null ? {} : { stableId: section.stableId }),
      ...(meta === undefined ? {} : { aux: meta }),
    },
    entries: section.children.map((child) => childEntry(store, child)),
  })
}

/** 문서 하나를 tree 로 쓰고 주소를 돌려준다. */
export function writeDocument(store: ObjectStore, document: Document): ObjectId {
  const meta = auxMeta(document.aux)
  return store.writeTree({
    meta: {
      id: document.id,
      type: document.type,
      ...(meta === undefined ? {} : { aux: meta }),
    },
    entries: document.children.map((child) => childEntry(store, child)),
  })
}

/**
 * 컬렉션과 문서를 묶어 뿌리 tree 를 쓴다.
 * 컬렉션과 문서는 고유한 순서가 없으므로 이름으로 정렬한다 — 섹션과 달리
 * 순서가 뜻을 갖지 않는 자리에서는 정렬해야 결정적이다.
 */
export function writeRoot(
  store: ObjectStore,
  documents: readonly { id: string; collection: string; tree: ObjectId }[],
): ObjectId {
  const collections = new Map<string, { name: string; tree: ObjectId }[]>()
  for (const document of documents) {
    const name = document.id.slice(document.id.indexOf('/') + 1)
    collections.set(document.collection, [
      ...(collections.get(document.collection) ?? []),
      { name, tree: document.tree },
    ])
  }

  const entries: TreeEntry[] = [...collections.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([collection, items]) => ({
      kind: 'tree' as const,
      name: collection,
      id: store.writeTree({
        entries: items
          .sort((a, b) => (a.name < b.name ? -1 : 1))
          .map((item) => ({ kind: 'tree' as const, name: item.name, id: item.tree })),
      }),
    }))

  return store.writeTree({ entries })
}
