import fs from 'node:fs/promises'
import path from 'node:path'
import type { VFile } from 'vfile'
import { parseRuleFile } from './parse.js'
import type { ProcessorOptions } from './processor.js'
import type { Rule, RuleSet } from './types.js'

const IGNORED = new Set(['node_modules', '.git', 'dist', '.rulekit'])

/** 규칙 루트 아래의 모든 `.md` 를 찾는다. `_` 로 시작하는 파일은 초안으로 보고 건너뛴다. */
export async function findRuleFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        !entry.name.startsWith('_') &&
        entry.name.toLowerCase() !== 'readme.md'
      ) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out.sort()
}

/** 규칙 루트를 통째로 읽어 `RuleSet` 과 파일별 진단을 돌려준다. */
export async function collectRules(
  root: string,
  options: ProcessorOptions = {},
): Promise<RuleSet> {
  const absRoot = path.resolve(root)
  const paths = await findRuleFiles(absRoot)
  const files: VFile[] = []
  const rules: Rule[] = []

  const results = await Promise.all(
    paths.map((p) => parseRuleFile(p, { ...options, root: absRoot })),
  )
  for (const result of results) {
    files.push(result.file)
    if (result.rule) rules.push(result.rule)
  }
  rules.sort((a, b) => a.meta.id.localeCompare(b.meta.id))
  return { root: absRoot, rules, files }
}
