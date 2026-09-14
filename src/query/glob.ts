/** 아주 작은 글롭. `**` `*` `?` 만 안다. 경로 규칙은 어휘가 소유하고, 여기서는 맞춰만 본다. */

const SPECIAL = /[.+^${}()|[\]\\]/g

export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  let index = 0

  while (index < glob.length) {
    const char = glob[index]!
    if (char === '*') {
      const isDouble = glob[index + 1] === '*'
      if (isDouble) {
        // `**/` 는 0 개 이상의 디렉터리, `**` 는 아무 것이나
        if (glob[index + 2] === '/') {
          pattern += '(?:[^/]+/)*'
          index += 3
          continue
        }
        pattern += '.*'
        index += 2
        continue
      }
      pattern += '[^/]*'
      index += 1
      continue
    }
    if (char === '?') {
      pattern += '[^/]'
      index += 1
      continue
    }
    pattern += char.replace(SPECIAL, '\\$&')
    index += 1
  }

  return new RegExp(`^${pattern}$`)
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path)
}
