import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified, type Processor } from 'unified'
import type { Root } from 'mdast'
import { ruleExtract } from './plugins/rule-extract.js'
import { ruleLint, type RuleLintOptions } from './plugins/rule-lint.js'

export interface ProcessorOptions extends RuleLintOptions {
  /** 규칙 루트. `Rule.path` 를 이 경로 기준 상대 경로로 만든다. */
  root?: string
  /** 구조 lint 를 끄고 추출만 수행한다. */
  lint?: boolean
}

/**
 * 규칙 문서 하나를 처리하는 unified 파이프라인.
 * parse → frontmatter → gfm → 추출 → 구조 lint 순으로 고정되어 있다.
 */
export function createProcessor(options: ProcessorOptions = {}) {
  const { root, lint = true, ...lintOptions } = options
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .use(ruleExtract, { root })
  return (lint ? processor.use(ruleLint, lintOptions) : processor) as Processor<
    Root,
    Root,
    Root,
    undefined,
    undefined
  >
}
