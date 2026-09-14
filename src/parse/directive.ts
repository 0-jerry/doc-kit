/**
 * 블록 보조데이터의 저작 채널. 노드 바로 앞에 붙는 HTML 주석 하나를 읽는다.
 *
 *     <!-- rk: id=core role=norm subject=[test-fixture, infra] status=deprecated -->
 *
 * HTML 주석으로 둔 것은 마크다운으로서 유효하고, 일반 뷰어에서 보이지 않으며,
 * 원문에서의 위치가 그대로 보존되기 때문이다.
 */

const DIRECTIVE = /^<!--\s*rk:\s*([\s\S]*?)\s*-->$/

export interface DirectiveEntry {
  readonly key: string
  readonly values: readonly string[]
  /** 대괄호 목록으로 적혔는가. 단일 값과 한 항목짜리 목록을 구분한다. */
  readonly isList: boolean
}

export interface DirectiveParse {
  readonly entries: readonly DirectiveEntry[]
  /** 문법을 벗어난 조각들. 호출자가 진단으로 바꾼다. */
  readonly problems: readonly string[]
}

/** 이 원문이 디렉티브 주석인가. */
export function isDirective(html: string): boolean {
  return DIRECTIVE.test(html.trim())
}

/** 디렉티브 본문을 `key=value` 쌍으로 쪼갠다. */
export function parseDirective(html: string): DirectiveParse | null {
  const match = DIRECTIVE.exec(html.trim())
  if (match === null) return null

  const body = match[1] ?? ''
  const entries: DirectiveEntry[] = []
  const problems: string[] = []

  let cursor = 0
  while (cursor < body.length) {
    if (/\s/.test(body[cursor]!)) {
      cursor += 1
      continue
    }

    const equals = body.indexOf('=', cursor)
    if (equals === -1) {
      problems.push(`값이 없는 조각입니다: ${body.slice(cursor).trim()}`)
      break
    }

    const key = body.slice(cursor, equals).trim()
    if (key.length === 0 || /\s/.test(key)) {
      problems.push(`키가 비었거나 공백을 담고 있습니다: ${body.slice(cursor, equals)}`)
      cursor = equals + 1
      continue
    }

    cursor = equals + 1
    if (body[cursor] === '[') {
      const close = body.indexOf(']', cursor)
      if (close === -1) {
        problems.push(`목록이 닫히지 않았습니다: ${key}`)
        break
      }
      const values = body
        .slice(cursor + 1, close)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      entries.push({ key, values, isList: true })
      cursor = close + 1
      continue
    }

    let end = cursor
    while (end < body.length && !/\s/.test(body[end]!)) end += 1
    const value = body.slice(cursor, end)
    if (value.length === 0) {
      problems.push(`값이 비었습니다: ${key}`)
    } else {
      entries.push({ key, values: [value], isList: false })
    }
    cursor = end
  }

  return { entries, problems }
}

/**
 * 보조데이터로부터 디렉티브 한 줄을 만든다. 쓸 것이 없으면 null.
 *
 * 단일 표기는 공백에서 끊기므로, 공백을 담은 값은 항목이 하나여도 목록으로 쓴다 —
 * 그러지 않으면 쓴 것을 다시 읽을 수 없다.
 */
export function formatDirective(entries: readonly DirectiveEntry[]): string | null {
  if (entries.length === 0) return null
  const body = entries
    .map((entry) => {
      const needsList = entry.isList || entry.values.some((value) => /[\s\]]/.test(value))
      return needsList
        ? `${entry.key}=[${entry.values.join(', ')}]`
        : `${entry.key}=${entry.values[0]}`
    })
    .join(' ')
  return `<!-- rk: ${body} -->`
}
