/**
 * 프로젝트의 저장 정책. **도구를 초기화할 때 정하고, 그 뒤로는 바꾸지 않는 것**이 전제다.
 *
 *   .dockit/store.yaml
 *     version: 1
 *     retention: head | all
 *
 * 저작 규약(`schema.yaml`)과 섞지 않는다. 규약은 "무엇을 쓸 수 있는가" 를 답하고
 * 이것은 "무엇을 남기는가" 를 답한다 — 층이 다르다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * `head` — HEAD 에서 닿는 것만 남기고 거둔다. 지운 이력은 기록하지 않는다.
 * `all`  — 이력을 전부 보존한다. 그 대가로 **거두기를 하지 않는다**.
 */
export type Retention = 'head' | 'all'

export const DEFAULT_RETENTION: Retention = 'head'
export const STORE_CONFIG_PATH = '.dockit/store.yaml'
/** 객체 저장소. 프로젝트 바탕(`projectBase`) 기준 상대 경로다 — cwd 기준이 아니다. */
export const DEFAULT_STORE = '.dockit/store'

/**
 * 루트가 속한 프로젝트의 바탕 디렉터리 — `.dockit/` 을 담은 곳.
 * 루트 자신, 그다음 부모를 본다. 둘 다 없으면 부모다(`dockit init` 이 쓰는 자리).
 *
 * 보존 정책과 저장소는 **반드시 같은 바탕에서** 찾아야 한다. 정책은 루트를 따라가고
 * 저장소는 cwd 를 따라가면, 남의 루트로 거두기를 돌릴 때 그쪽 정책이 이쪽 저장소를 지운다.
 */
export function projectBase(root: string): string {
  const candidates = [root, join(root, '..')]
  return (
    candidates.find((base) => existsSync(join(base, STORE_CONFIG_PATH))) ??
    candidates.find((base) => existsSync(join(base, '.dockit'))) ??
    join(root, '..')
  )
}

/** 루트에 딸린 기본 저장소 디렉터리. */
export function storeDirectoryFor(root: string): string {
  return join(projectBase(root), DEFAULT_STORE)
}

export interface StoreConfig {
  readonly retention: Retention
  /** 어디서 읽었는지. 설정 파일이 없으면 기본값임을 알린다. */
  readonly origin: string
}

/**
 * 설정을 찾는다. 없으면 기본값이다 — 초기화하지 않은 프로젝트도 그냥 돌아야 한다.
 *
 * **규약(`resolveSchema`)과 달리 cwd 는 보지 않는다.** 규약이 어긋나면 진단이 어긋날 뿐이지만
 * 보존 정책은 파일을 지운다. 남의 루트를 인수로 주고 거두기를 돌릴 때 이쪽 정책이 따라가면,
 * 그 프로젝트가 고른 `all` 을 무시하고 이력을 지운다. 루트와 그 부모까지만 본다.
 */
export function loadStoreConfig(root: string, explicit?: string): StoreConfig {
  const candidates =
    explicit === undefined
      ? [join(root, STORE_CONFIG_PATH), join(root, '..', STORE_CONFIG_PATH)]
      : [explicit]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    const retention = readRetention(path)
    if (retention === null) continue
    return { retention, origin: path }
  }
  return { retention: DEFAULT_RETENTION, origin: `기본값 (${DEFAULT_RETENTION})` }
}

function readRetention(path: string): Retention | null {
  let parsed: unknown
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const value = (parsed as Record<string, unknown>)['retention']
  return value === 'head' || value === 'all' ? value : null
}

/** 초기화가 쓰는 설정 파일 내용. */
export function storeConfigText(retention: Retention): string {
  const note =
    retention === 'head'
      ? '# HEAD 에서 닿는 것만 남긴다. `dockit gc` 가 나머지를 거둔다.\n' +
        '# 지운 이력은 기록하지 않는다 — 되돌릴 수 없다.\n'
      : '# 이력을 전부 보존한다. 그 대가로 `dockit gc` 는 돌지 않는다.\n' +
        '# 저장소는 고침 횟수에 비례해 자란다.\n'
  return `# doc-kit 저장 정책. 초기화할 때 정하고 그 뒤로는 바꾸지 않는다.\nversion: 1\n\n${note}retention: ${retention}\n`
}
