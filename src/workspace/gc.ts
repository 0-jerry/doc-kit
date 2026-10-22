/**
 * 거두기. 작업 트리가 더 쓰지 않는 것을 저장소에서 버린다.
 *
 * 두 디렉터리의 성질이 달라 정책도 다르다.
 *
 *   objects/   도달성으로 판정한다 — HEAD 에서 닿지 않으면 되살릴 길이 없다
 *   derived/   도달 개념이 없다(열쇠가 주소가 아니라 내용 지문이다).
 *              그래서 인덱싱을 한 번 돌려 실제로 쓰인 열쇠를 모으고 나머지를 버린다
 *
 * **거두기는 진단을 바꿀 수 없다.** 진단은 문서와 규약만의 함수이고 파생 캐시는
 * 내용 지문으로 열쇠를 삼으므로, 버린 결과는 다음 실행이 한 번 느려지는 것뿐이다.
 * 이 불변식이 서지 않으면 거두기는 안전하지 않다.
 */

import type { Schema } from '../schema/index.js'
import { type ObjectId, DerivedCache, ObjectStore, planSweep, sweep } from '../store/index.js'
import { indexWorkspace } from './incremental.js'
import { type Retention, loadStoreConfig, storeDirectoryFor } from './retention.js'

export interface GcOptions {
  readonly root: string
  readonly schema: Schema
  /** 저장소 디렉터리. 생략하면 루트에 딸린 저장소 — 정책을 읽는 바로 그 프로젝트의 것이다. */
  readonly store?: string
  /** 보존 정책. 생략하면 `.dockit/store.yaml` 을 찾고, 없으면 `head`. */
  readonly retention?: Retention
  /** 참이면 계획만 세우고 디스크에 아무것도 쓰거나 지우지 않는다. */
  readonly dryRun?: boolean
}

export interface GcResult {
  readonly retention: Retention
  /** 정책이 `all` 이면 거두지 않는다. */
  readonly skipped: boolean
  readonly dryRun: boolean
  /** 뿌리로 삼은 스냅샷. HEAD 가 없으면 비어 있다. */
  readonly roots: readonly ObjectId[]
  readonly objects: { before: number; kept: number; removed: number }
  readonly derived: { before: number; kept: number; removed: number }
}

/**
 * 저장소를 거둔다.
 *
 * 정책이 `all` 이면 아무것도 하지 않는다 — 이력 보존을 고른 프로젝트에서
 * 거두기는 선택지가 아니다. 이것이 `--force` 로 뚫리면 설정의 뜻이 없어진다.
 */
export function collectGarbage(options: GcOptions): GcResult {
  const directory = options.store ?? storeDirectoryFor(options.root)
  const retention = options.retention ?? loadStoreConfig(options.root).retention
  const dryRun = options.dryRun === true
  const derived = new DerivedCache(directory)

  if (retention === 'all') {
    const objects = new ObjectStore(directory).count()
    const keys = derived.count()
    return {
      retention,
      skipped: true,
      dryRun,
      roots: [],
      objects: { before: objects, kept: objects, removed: 0 },
      derived: { before: keys, kept: keys, removed: 0 },
    }
  }

  /*
   * 먼저 인덱싱한다. 두 가지를 얻는다 —
   * 작업 트리를 담은 새 HEAD, 그리고 이번에 쓰인 파생 열쇠.
   * 거두기 전에 돌려야 작업 트리의 객체가 뿌리에서 닿는 상태가 된다.
   *
   * `--dry-run` 이면 쓰지 않고 인덱싱한다. 새 HEAD 와 객체는 돌려받은 저장소 안에만
   * 있으므로, 계획은 실제 거두기와 같은 뿌리로 세워지되 디스크는 그대로다.
   */
  const indexed = indexWorkspace({
    root: options.root,
    schema: options.schema,
    store: directory,
    dryRun,
  })
  const store = indexed.store
  const head = store.head()
  const roots = head === null ? [] : [head]

  const objectsBefore = store.count()
  const plan = planSweep(store, roots)

  const needed = new Set(indexed.derivedKeys)
  const staleDerived: ObjectId[] = []
  let derivedBefore = 0
  for (const key of derived.keys()) {
    derivedBefore += 1
    if (!needed.has(key)) staleDerived.push(key)
  }

  if (dryRun) {
    return {
      retention,
      skipped: false,
      dryRun: true,
      roots,
      objects: {
        before: objectsBefore,
        kept: objectsBefore - plan.remove.length,
        removed: plan.remove.length,
      },
      derived: {
        before: derivedBefore,
        kept: derivedBefore - staleDerived.length,
        removed: staleDerived.length,
      },
    }
  }

  /*
   * 파생 캐시를 **먼저** 버린다. 남는 열쇠는 이번 인덱싱이 쓴 것뿐이고 그 tree 는 모두
   * 새 HEAD 에서 닿으므로, 객체 쓸기가 중간에 끊겨도 남은 캐시 항목이 반쯤 지워진
   * tree 를 가리키는 일이 없다. 순서를 뒤집으면 끊긴 자리에서 캐시가 구멍 난 tree 를 계속 내준다.
   */
  let removedDerived = 0
  for (const key of staleDerived) {
    if (derived.remove(key)) removedDerived += 1
  }
  const removedObjects = sweep(store, plan)

  return {
    retention,
    skipped: false,
    dryRun: false,
    roots,
    objects: {
      before: objectsBefore,
      kept: objectsBefore - removedObjects,
      removed: removedObjects,
    },
    derived: {
      before: derivedBefore,
      kept: derivedBefore - removedDerived,
      removed: removedDerived,
    },
  }
}
