/** 방문한 노드의 섹션 키 경로. 규약 질의의 좌표가 된다. */

import { Section, type Visit } from '../model/index.js'

export function keyPathOf(visit: Visit): string[] {
  const fromAncestors = visit.ancestors
    .filter((node): node is Section => node.kind === 'section')
    .map((node) => node.key)
  return visit.node instanceof Section ? [...fromAncestors, visit.node.key] : fromAncestors
}
