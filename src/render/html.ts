/** HTML 조립에 쓰는 최소 유틸. 문자열 이어붙이기의 안전한 바닥을 만든다. */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 텍스트 노드와 속성값 모두에 안전한 이스케이프. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!)
}

export type AttrValue = string | number | boolean | null | undefined

/**
 * 속성 맵을 문자열로 만든다.
 * `false`·`null`·`undefined` 는 속성을 통째로 생략하고, `true` 는 값 없는 속성이 된다.
 */
export function attrs(map: Record<string, AttrValue>): string {
  const out: string[] = []
  for (const [name, value] of Object.entries(map)) {
    if (value === false || value === null || value === undefined) continue
    if (value === true) {
      out.push(name)
      continue
    }
    out.push(`${name}="${escapeHtml(String(value))}"`)
  }
  return out.length > 0 ? ` ${out.join(' ')}` : ''
}

/** 자식이 이미 HTML 인 요소. 자식 이스케이프는 호출자 책임이다. */
export function el(
  tag: string,
  attributes: Record<string, AttrValue>,
  ...children: (string | null | undefined | false)[]
): string {
  const inner = children.filter((c): c is string => typeof c === 'string').join('')
  return `<${tag}${attrs(attributes)}>${inner}</${tag}>`
}

/** 닫는 태그가 없는 요소(`input`, `meta` 등). */
export function voidEl(tag: string, attributes: Record<string, AttrValue>): string {
  return `<${tag}${attrs(attributes)}>`
}

/** 자식이 평문인 요소. 내용을 이스케이프한다. */
export function text(
  tag: string,
  attributes: Record<string, AttrValue>,
  value: string,
): string {
  return el(tag, attributes, escapeHtml(value))
}

/** 참이 아닌 항목을 걸러 줄바꿈으로 잇는다. 조건부 블록 조립용. */
export function join(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join('\n')
}

/** 클래스 이름 목록을 조건부로 합친다. */
export function cx(...names: (string | null | undefined | false)[]): string {
  return names.filter((n): n is string => typeof n === 'string' && n !== '').join(' ')
}
