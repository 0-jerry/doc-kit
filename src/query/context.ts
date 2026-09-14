/**
 * 파일 경로에 적용되는 판단기준을 모은다.
 *
 * 경로가 어떤 대상인지는 어휘가 소유한다. 이 함수는 어휘의 매핑을 해석만 하고
 * 프로젝트의 디렉터리 규칙을 스스로 알지 않는다.
 */

import type { Workspace } from '../workspace/workspace.js'
import { matchesGlob } from './glob.js'
import { type QueryHit, query } from './query.js'

export interface ContextResult {
  readonly path: string
  /** 이 경로에 해당하는 대상들. 비어 있으면 어휘가 이 경로를 모른다는 뜻이다. */
  readonly subjects: readonly string[]
  readonly hits: readonly QueryHit[]
}

/** 경로가 어떤 대상에 속하는지 어휘에 물어본다. */
export function subjectsForPath(workspace: Workspace, path: string): string[] {
  return workspace.schema
    .valuesWithPaths('subject')
    .filter((value) =>
      workspace.schema.pathsOf('subject', value).some((glob) => matchesGlob(path, glob)),
    )
}

export interface ContextOptions {
  /** 활성 상태인 것만 볼지. 기본은 그렇다. */
  readonly activeOnly?: boolean
  readonly role?: readonly string[]
}

export function contextFor(
  workspace: Workspace,
  path: string,
  options: ContextOptions = {},
): ContextResult {
  const subjects = subjectsForPath(workspace, path)
  const role = options.role ?? ['norm']

  // 대상을 선언하지 않은 판단기준은 어디에나 적용된다. 좁힌 것만 경로로 거른다.
  const hits = query(workspace, { role }).filter((hit) => {
    if (hit.subject.length === 0) return true
    return hit.subject.some((subject) => subjects.includes(subject))
  })

  const filtered =
    options.activeOnly === false
      ? hits
      : hits.filter((hit) => hit.status === null || hit.status === 'active')

  return { path, subjects, hits: filtered }
}
