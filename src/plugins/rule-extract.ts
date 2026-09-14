import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Code, Heading, List, Root, RootContent, Yaml } from 'mdast'
import { toString } from 'mdast-util-to-string'
import type { Plugin } from 'unified'
import type { VFile } from 'vfile'
import { parse as parseYaml } from 'yaml'
import { frontmatterSchema, slugifyHeading } from '../schema.js'
import type { CodeBlock, Rule, RuleMeta, RuleSection } from '../types.js'

declare module 'vfile' {
  interface DataMap {
    rule: Rule
    /** 스키마 검증까지 통과했는지. lint 단계가 참조한다. */
    ruleMetaValid: boolean
    /** frontmatter 검증 실패와 무관하게 항상 채워지는 본문 섹션. */
    sections: RuleSection[]
  }
}

const POLARITY = /^\s*(?:\/\/|#|--|\/\*)\s*(WRONG|BAD|RIGHT|GOOD|OK)\b/i

const kindOf = (word: string): 'right' | 'wrong' =>
  /wrong|bad/i.test(word) ? 'wrong' : 'right'

/** 코드 블록 첫 줄 주석에서 예시 극성을 읽는다. 렌더러도 같은 판정을 쓴다. */
export function polarityOf(value: string): CodeBlock['polarity'] {
  const first = value.split('\n', 1)[0] ?? ''
  const m = POLARITY.exec(first)
  return m ? kindOf(m[1]!) : null
}

/** 블록 전체를 훑어 극성 표식을 모은다. 한 블록이 대비 예시를 모두 담을 수 있다. */
function markersOf(value: string): ('right' | 'wrong')[] {
  const found = new Set<'right' | 'wrong'>()
  for (const line of value.split('\n')) {
    const m = POLARITY.exec(line)
    if (m) found.add(kindOf(m[1]!))
  }
  return [...found]
}

function toCodeBlock(node: Code): CodeBlock {
  return {
    lang: node.lang ?? null,
    meta: node.meta ?? null,
    polarity: polarityOf(node.value),
    markers: markersOf(node.value),
    value: node.value,
    line: node.position?.start.line ?? 0,
  }
}

/**
 * 본문을 depth 2 제목 기준으로 잘라 섹션 목록을 만든다.
 * 첫 제목 앞의 내용은 `key: ''` 인 서두 섹션으로 보존해 lint 가 잡을 수 있게 한다.
 */
export function splitSections(tree: Root): RuleSection[] {
  const sections: RuleSection[] = []
  let current: { heading: Heading | null; nodes: RootContent[] } = {
    heading: null,
    nodes: [],
  }

  const flush = () => {
    const { heading, nodes } = current
    if (!heading && nodes.length === 0) return
    const body: Root = { type: 'root', children: nodes }
    const codeBlocks = nodes.flatMap((n) => collectCode(n))
    const listItems = nodes
      .filter((n): n is List => n.type === 'list')
      .reduce((sum, list) => sum + list.children.length, 0)
    sections.push({
      key: heading ? slugifyHeading(toString(heading)) : '',
      heading: heading ? toString(heading) : '',
      depth: heading?.depth ?? 0,
      text: toString(body).trim(),
      content: nodes,
      codeBlocks,
      listItems,
    })
  }

  for (const node of tree.children) {
    if (node.type === 'yaml') continue
    if (node.type === 'heading' && node.depth <= 2) {
      flush()
      current = { heading: node, nodes: [] }
      continue
    }
    current.nodes.push(node)
  }
  flush()
  return sections
}

function collectCode(node: RootContent): CodeBlock[] {
  if (node.type === 'code') return [toCodeBlock(node)]
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.flatMap((c) => collectCode(c as RootContent))
  }
  return []
}

function readFrontmatter(tree: Root): Yaml | null {
  const first = tree.children[0]
  return first && first.type === 'yaml' ? first : null
}

/**
 * frontmatter 를 검증해 `RuleMeta` 로 정규화한다.
 * 실패는 모두 vfile 메시지로 보고하고 null 을 돌려준다.
 */
function readMeta(tree: Root, file: VFile): RuleMeta | null {
  const node = readFrontmatter(tree)
  if (!node) {
    file.message('frontmatter 블록이 없습니다', undefined, 'rulekit:FM001').fatal =
      true
    return null
  }

  let raw: unknown
  try {
    raw = parseYaml(node.value)
  } catch (error) {
    const msg = file.message(
      `frontmatter YAML 파싱 실패: ${(error as Error).message}`,
      node,
      'rulekit:FM002',
    )
    msg.fatal = true
    return null
  }

  const parsed = frontmatterSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const where = issue.path.join('.') || '(root)'
      const msg = file.message(
        `frontmatter.${where}: ${issue.message}`,
        node,
        'rulekit:FM003',
      )
      msg.fatal = true
    }
    return null
  }
  return parsed.data
}

/** 파일 경로와 frontmatter 가 일치하는지 확인한다(규약을 파일 시스템에 고정). */
function checkLocation(meta: RuleMeta, file: VFile): void {
  const base = path.basename(file.path ?? '', '.md')
  if (base && base !== meta.id) {
    file.message(
      `파일명 '${base}.md' 가 id '${meta.id}' 와 다릅니다`,
      undefined,
      'rulekit:FM004',
    )
  }
  const dir = path.basename(path.dirname(file.path ?? ''))
  if (dir && dir !== meta.category) {
    file.message(
      `디렉터리 '${dir}' 가 category '${meta.category}' 와 다릅니다`,
      undefined,
      'rulekit:FM005',
    )
  }
}

/**
 * mdast 를 규칙 레코드로 환원하는 unified 플러그인.
 * 결과는 `file.data.rule` 에 담기며, 검증 실패 시 비워 둔다.
 */
export const ruleExtract: Plugin<[{ root?: string }?], Root> = (options = {}) => {
  const root = options.root ?? process.cwd()
  return (tree, file) => {
    const meta = readMeta(tree, file)
    file.data.ruleMetaValid = meta !== null
    const sections = splitSections(tree)
    file.data.sections = sections
    if (!meta) return

    checkLocation(meta, file)

    const statement = sections.find((s) => s.key === 'rule')?.text ?? ''
    const source = String(file.value)
    const rule: Rule = {
      meta,
      path: path.relative(root, file.path ?? ''),
      statement,
      sections,
      digest: createHash('sha256').update(source).digest('hex').slice(0, 12),
    }
    file.data.rule = rule
  }
}
