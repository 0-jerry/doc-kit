/** 규약을 어디서 읽을지 정한다. 없으면 내장 프리셋으로 시작한다. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Schema, loadPreset, loadSchemaFile } from '../schema/index.js'

export const DEFAULT_SCHEMA_PATH = '.dockit/schema.yaml'

export interface SchemaSource {
  readonly schema: Schema
  readonly origin: string
}

export function resolveSchema(root: string, explicit?: string): SchemaSource {
  if (explicit !== undefined) {
    return { schema: loadSchemaFile(explicit), origin: explicit }
  }
  for (const candidate of [
    join(root, DEFAULT_SCHEMA_PATH),
    join(root, '..', DEFAULT_SCHEMA_PATH),
    DEFAULT_SCHEMA_PATH,
  ]) {
    if (existsSync(candidate)) return { schema: loadSchemaFile(candidate), origin: candidate }
  }
  return { schema: loadPreset('preset/principle'), origin: 'preset/principle (내장)' }
}
