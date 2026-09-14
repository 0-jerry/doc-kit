/** 아주 작은 인자 파서. 하위 명령 하나와 `--키 값` 만 안다. */

export interface Parsed {
  readonly command: string | null
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string[]>
}

export function parseArgv(argv: readonly string[]): Parsed {
  const positional: string[] = []
  const flags = new Map<string, string[]>()
  let command: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith('--')) {
      if (command === null) command = token
      else positional.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      flags.set(key, [...(flags.get(key) ?? []), 'true'])
      continue
    }
    flags.set(key, [...(flags.get(key) ?? []), next])
    index += 1
  }

  return { command, positional, flags }
}

export function flag(parsed: Parsed, key: string): string | undefined {
  return parsed.flags.get(key)?.[0]
}

export function flagList(parsed: Parsed, key: string): string[] | undefined {
  const values = parsed.flags.get(key)
  if (values === undefined) return undefined
  return values.flatMap((value) => value.split(',').map((part) => part.trim())).filter(Boolean)
}

export function hasFlag(parsed: Parsed, key: string): boolean {
  return parsed.flags.has(key)
}
