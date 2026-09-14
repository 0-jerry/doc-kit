import fs from 'node:fs/promises'
import path from 'node:path'
import { VFile } from 'vfile'
import { createProcessor, type ProcessorOptions } from './processor.js'
import type { ParseResult } from './types.js'

/** 마크다운 문자열 하나를 파싱·검증한다. 파일 시스템을 건드리지 않는다. */
export function parseRule(
  value: string,
  filePath: string,
  options: ProcessorOptions = {},
): ParseResult {
  const processor = createProcessor(options)
  const file = new VFile({ path: filePath, value })
  const tree = processor.parse(file)
  const transformed = processor.runSync(tree, file)
  return { file, tree: transformed, rule: file.data.rule ?? null }
}

/** 규칙 파일 하나를 읽어 파싱·검증한다. */
export async function parseRuleFile(
  filePath: string,
  options: ProcessorOptions = {},
): Promise<ParseResult> {
  const value = await fs.readFile(filePath, 'utf8')
  return parseRule(value, path.resolve(filePath), options)
}
