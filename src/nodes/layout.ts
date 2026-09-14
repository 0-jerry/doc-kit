/**
 * 노드 트리의 파일 배치 규약.
 *
 *   <컬렉션>/<문서>/node.md          문서이자 루트 노드
 *   <컬렉션>/<문서>/<노드>/node.md   하위 노드
 *
 * 노드 하나가 디렉터리 하나다. 자기가 정의한 내용은 `node.md` 가 소유하고,
 * 하위 노드는 frontmatter 의 `children` 인덱스가 가리킨다 — 그 순서가 곧 문서 순서다.
 */

/** 노드 자신의 내용을 담는 파일 이름. */
export const NODE_FILE = 'node.md'

export function nodePath(directory: string): string {
  return directory === '' ? NODE_FILE : `${directory}/${NODE_FILE}`
}

export function childDirectory(directory: string, key: string): string {
  return directory === '' ? key : `${directory}/${key}`
}

/** 문서 디렉터리의 저장소 기준 경로. */
export function documentDirectory(collection: string, name: string): string {
  return `${collection}/${name}`
}
