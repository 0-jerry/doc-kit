/**
 * 선언을 읽어 `Schema` 로 만든다. `extends` 해소와 외부 어휘 파일 읽기를 담당한다.
 */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { type Declaration, declarationSchema } from './declaration.js'
import { type RawDeclaration, mergeDeclarations } from './merge.js'
import { PRESETS } from './presets/index.js'
import { Schema } from './schema.js'

export class SchemaError extends Error {
  readonly source: string

  constructor(message: string, source: string) {
    super(`${source}: ${message}`)
    this.name = 'SchemaError'
    this.source = source
  }
}

/** 해소된 기반 선언. `id` 는 같은 선언을 같다고 볼 수 있는 표준 이름이다. */
export interface ResolvedBase {
  readonly id: string
  readonly raw: RawDeclaration
}

/**
 * `extends` 항목 하나를 원시 선언으로 바꾼다. 못 찾으면 null.
 * 순환 감지는 `id` 로 하므로, 같은 선언을 여러 이름으로 가리킬 수 있는 해석기는
 * 반드시 표준 이름(예: 절대 경로)을 돌려줘야 한다.
 */
export type BaseResolver = (reference: string, from: string) => ResolvedBase | null

function asRaw(value: unknown, source: string): RawDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SchemaError('선언은 객체여야 합니다', source)
  }
  return value as RawDeclaration
}

function referencesOf(raw: RawDeclaration, source: string): readonly string[] {
  const value = raw['extends']
  if (value === undefined) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value as string[]
  }
  throw new SchemaError('extends 는 문자열이거나 문자열 배열이어야 합니다', source)
}

/** 기반 선언을 깊이 우선으로 펼친다. 나중에 오는 것이 이긴다. */
function flatten(
  raw: RawDeclaration,
  source: string,
  resolveBase: BaseResolver,
  visiting: readonly string[],
): RawDeclaration[] {
  const layers: RawDeclaration[] = []
  for (const reference of referencesOf(raw, source)) {
    const base = resolveBase(reference, source)
    if (base === null) {
      throw new SchemaError(`상속할 선언을 찾을 수 없습니다: ${reference}`, source)
    }
    if (visiting.includes(base.id)) {
      throw new SchemaError(`extends 가 순환합니다: ${[...visiting, base.id].join(' → ')}`, source)
    }
    layers.push(...flatten(base.raw, base.id, resolveBase, [...visiting, base.id]))
  }
  layers.push(raw)
  return layers
}

/** 프리셋만 해소하는 기본 해석기. 파일 경로는 모른다. */
export const presetResolver: BaseResolver = (reference) => {
  const preset = PRESETS[reference]
  return preset === undefined ? null : { id: reference, raw: asRaw(preset, reference) }
}

export interface LoadOptions {
  /** 오류 메시지에 쓸 출처 이름. */
  readonly source?: string
  readonly resolveBase?: BaseResolver
}

/** 원시 선언을 규약으로 만든다. */
export function loadDeclaration(raw: unknown, options: LoadOptions = {}): Declaration {
  const source = options.source ?? '<declaration>'
  const resolveBase = options.resolveBase ?? presetResolver
  const layers = flatten(asRaw(raw, source), source, resolveBase, [source])
  const merged = mergeDeclarations(layers)
  // 병합 결과에는 version 이 남아 있어야 한다 — 기반 선언 중 하나라도 선언했으면 유지된다.
  const parsed = declarationSchema.safeParse(merged)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n  ')
    throw new SchemaError(`선언이 형식을 벗어났습니다\n  ${issues}`, source)
  }
  return parsed.data
}

export function loadSchema(raw: unknown, options: LoadOptions = {}): Schema {
  return new Schema(loadDeclaration(raw, options))
}

/** 이름만으로 프리셋 규약을 만든다. */
export function loadPreset(name: string): Schema {
  const preset = PRESETS[name]
  if (preset === undefined) {
    throw new SchemaError(`그런 프리셋이 없습니다: ${name}`, name)
  }
  return loadSchema(preset, { source: name })
}

function readYamlFile(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new SchemaError('파일을 읽을 수 없습니다', path)
  }
  try {
    return parseYaml(text)
  } catch (error) {
    throw new SchemaError(`YAML 을 읽을 수 없습니다: ${(error as Error).message}`, path)
  }
}

/** 파일과 프리셋을 모두 해소하는 해석기. 경로는 참조한 파일 기준 상대 경로다. */
function fileResolver(reference: string, from: string): ResolvedBase | null {
  if (reference.startsWith('preset/')) return presetResolver(reference, from)
  const base = from.endsWith('.yaml') || from.endsWith('.yml') ? dirname(from) : process.cwd()
  // 표준 이름은 절대 경로다 — 같은 파일을 다르게 적은 상대 경로가 순환을 숨기지 못한다.
  const path = isAbsolute(reference) ? reference : resolvePath(base, reference)
  return { id: path, raw: asRaw(readYamlFile(path), path) }
}

/**
 * 외부 목록 파일을 읽어 어휘에 합친다.
 * 어휘가 값을 어디에 두든 규약의 질의 결과는 같아야 하므로 여기서 흡수한다.
 *
 * 파일은 두 모양을 받는다.
 *   - 문자열 배열 → 값 목록
 *   - 매핑 `{ 값: [경로 글롭…] }` → 값 목록 + 경로 매핑
 */
function absorbVocabularySources(declaration: Declaration, schemaPath: string): Declaration {
  const directory = dirname(schemaPath)
  const vocabularies = Object.fromEntries(
    Object.entries(declaration.vocabularies).map(([name, spec]) => {
      if (spec.source === undefined) return [name, spec]
      const path = isAbsolute(spec.source) ? spec.source : resolvePath(directory, spec.source)
      const loaded = readYamlFile(path)

      if (Array.isArray(loaded)) {
        if (loaded.some((value) => typeof value !== 'string')) {
          throw new SchemaError(`어휘 목록은 문자열 배열이어야 합니다 (${name})`, path)
        }
        return [name, { ...spec, values: [...new Set([...spec.values, ...(loaded as string[])])] }]
      }

      if (typeof loaded === 'object' && loaded !== null) {
        const entries = Object.entries(loaded as Record<string, unknown>)
        const paths: Record<string, string[]> = { ...spec.paths }
        for (const [value, globs] of entries) {
          if (!Array.isArray(globs) || globs.some((glob) => typeof glob !== 'string')) {
            throw new SchemaError(`'${value}' 의 경로 목록은 문자열 배열이어야 합니다`, path)
          }
          paths[value] = [...new Set([...(paths[value] ?? []), ...(globs as string[])])]
        }
        return [
          name,
          {
            ...spec,
            values: [...new Set([...spec.values, ...entries.map(([value]) => value)])],
            paths,
          },
        ]
      }

      throw new SchemaError(`어휘 파일은 목록이거나 매핑이어야 합니다 (${name})`, path)
    }),
  )
  return { ...declaration, vocabularies }
}

/** 파일에서 규약을 읽는다. */
export function loadSchemaFile(path: string): Schema {
  const raw = readYamlFile(path)
  const declaration = loadDeclaration(raw, { source: path, resolveBase: fileResolver })
  return new Schema(absorbVocabularySources(declaration, path))
}
