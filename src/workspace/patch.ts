/**
 * 두 문자열의 줄 단위 차이. 저장소를 모른다 — 비교가 꺼낸 blob 두 개를 받을 뿐이다.
 *
 * 블록 하나는 짧으므로 (문단 하나, 문서 전체도 블록 60 개가 상한) 최장 공통 부분수열을
 * `O(nm)` 표로 구한다. Myers 알고리즘은 이 크기에서 차이가 없고 코드만 길어진다 (0004 §8).
 */

export interface PatchLine {
  /** 앞에만 있으면 `-`, 뒤에만 있으면 `+`, 양쪽에 있으면 공백. */
  readonly op: '-' | '+' | ' '
  readonly text: string
}

function linesOf(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function lineDiff(before: string, after: string): PatchLine[] {
  const a = linesOf(before)
  const b = linesOf(after)

  // common[i][j] = a[i..] 와 b[j..] 의 최장 공통 부분수열 길이
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i]![j] =
        a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
    }
  }

  const lines: PatchLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ op: ' ', text: a[i]! })
      i += 1
      j += 1
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      lines.push({ op: '-', text: a[i]! })
      i += 1
    } else {
      lines.push({ op: '+', text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) lines.push({ op: '-', text: a[i++]! })
  while (j < b.length) lines.push({ op: '+', text: b[j++]! })
  return lines
}

/** `- 앞` / `+ 뒤` / `  같음` 줄로 편다. 끝에 줄바꿈이 없다. */
export function formatPatch(lines: readonly PatchLine[]): string {
  return lines.map((line) => `${line.op} ${line.text}`).join('\n')
}
