/**
 * 마크다운을 문서 트리로 읽는다.
 *
 * 각 노드는 자기가 차지한 원문 조각을 들고 간다. 조각들은 겹치지 않고 문서 전체를
 * 덮으므로, 문서 순서대로 이으면 원문이 그대로 나온다 — 직렬화기는 이것에 기댄다.
 */

import type { Heading, Root, RootContent } from 'mdast'
import { toString as mdastToString } from 'mdast-util-to-string'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { parse as parseYaml } from 'yaml'
import { type Diagnostic, diagnostic } from '../diagnostic/index.js'
import {
  Block,
  type BlockForm,
  type Child,
  Document,
  Section,
  aux as makeAux,
  formatDocumentId,
  isSectionKey,
} from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { buildAux, entriesFromObject } from './aux-source.js'
import { type DirectiveEntry, isDirective, parseDirective } from './directive.js'

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm)

export interface ParseOptions {
  readonly schema: Schema
  /** 저장소 루트 기준 경로. 진단에 쓴다. */
  readonly path: string
  /** 디렉터리 이름. 문서 타입을 정하는 데 쓴다. */
  readonly collection: string
  /** 확장자를 뗀 파일 이름. `id` 가 없으면 이것이 문서 식별자가 된다. */
  readonly name: string
}

export interface ParseResult {
  /** 문서를 만들지 못했으면 null. */
  readonly document: Document | null
  readonly diagnostics: readonly Diagnostic[]
}

const FORM_BY_TYPE: Readonly<Record<string, BlockForm>> = {
  paragraph: 'paragraph',
  list: 'list',
  code: 'code',
  table: 'table',
  blockquote: 'quote',
}

function formOf(node: RootContent): BlockForm {
  return FORM_BY_TYPE[node.type] ?? 'other'
}

/** 규약에 없는 제목을 주소에 쓸 수 있는 키로 바꾼다. */
export function slugify(heading: string): string {
  const slug = heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[#/~[\]]/g, '')
  return isSectionKey(slug) ? slug : `s-${slug}`
}

/** 원문에서 노드가 시작하는 위치. */
function startOf(node: RootContent): number {
  return node.position?.start.offset ?? 0
}

function lineOf(node: RootContent): number | undefined {
  return node.position?.start.line
}

interface Unit {
  readonly node: RootContent
  /** 앞에 붙은 디렉티브가 시작하는 위치. 없으면 null. */
  readonly directiveStart: number | null
  readonly entries: readonly DirectiveEntry[]
  readonly directiveProblems: readonly string[]
}

interface Builder {
  readonly key: string
  readonly heading: string
  readonly depth: number
  readonly children: (Builder | Block)[]
  readonly section: Omit<ConstructorParameters<typeof Section>[0], 'children'>
}

function toSection(builder: Builder): Section {
  return new Section({
    ...builder.section,
    children: builder.children.map((child) =>
      child instanceof Block ? child : toSection(child),
    ) as readonly Child[],
  })
}

export function parseDocument(text: string, options: ParseOptions): ParseResult {
  const { schema, path, collection, name } = options
  const diagnostics: Diagnostic[] = []
  const report = (
    code: string,
    severity: 'error' | 'warning',
    message: string,
    line?: number,
    hint?: string,
  ): void => {
    diagnostics.push(
      diagnostic({
        code,
        severity,
        message,
        path,
        ...(line === undefined ? {} : { line }),
        ...(hint === undefined ? {} : { hint }),
      }),
    )
  }

  const tree = processor.parse(text) as Root
  const [first, ...rest] = tree.children
  const frontmatterNode = first?.type === 'yaml' ? first : null
  const content = frontmatterNode === null ? tree.children : rest

  // ── 단위 나누기: 디렉티브는 뒤따르는 노드에 붙는다 ──────────────────────
  const units: Unit[] = []
  let pending: { start: number; entries: DirectiveEntry[]; problems: string[] } | null = null

  for (const node of content) {
    if (node.type === 'html' && isDirective(node.value)) {
      const parsed = parseDirective(node.value)
      const entries = parsed?.entries ?? []
      const problems = parsed?.problems ?? []
      if (pending === null) {
        pending = { start: startOf(node), entries: [...entries], problems: [...problems] }
      } else {
        // 연달아 붙은 디렉티브는 하나로 본다
        pending.entries.push(...entries)
        pending.problems.push(...problems)
      }
      continue
    }
    units.push({
      node,
      directiveStart: pending?.start ?? null,
      entries: pending?.entries ?? [],
      directiveProblems: pending?.problems ?? [],
    })
    pending = null
  }

  if (pending !== null) {
    report(
      'PRS004',
      'warning',
      '뒤에 노드가 없는 디렉티브입니다. 아무 곳에도 붙지 않습니다',
      undefined,
      '주석을 설명하려는 블록 바로 앞으로 옮기세요',
    )
  }

  const boundaries = units.map((unit) => unit.directiveStart ?? startOf(unit.node))
  const documentRaw = text.slice(0, boundaries[0] ?? text.length)

  // ── frontmatter ────────────────────────────────────────────────────────
  let documentEntries: readonly DirectiveEntry[] = []
  if (frontmatterNode === null) {
    report('PRS001', 'error', 'frontmatter 가 없습니다', 1, '문서 맨 앞에 --- 블록을 두세요')
  } else {
    let parsed: unknown
    try {
      parsed = parseYaml(frontmatterNode.value)
    } catch (error) {
      report('PRS002', 'error', `frontmatter 를 읽을 수 없습니다: ${(error as Error).message}`, 1)
      return { document: null, diagnostics }
    }
    const converted = entriesFromObject(parsed ?? {})
    documentEntries = converted.entries
    for (const problem of converted.problems) report('PRS003', 'error', problem, 1)
  }

  const documentAux = buildAux(documentEntries, schema)
  for (const problem of documentAux.problems) report('PRS003', 'error', problem, 1)

  const declaredType = documentAux.reserved.get('type')
  const collectionType = schema.typeForCollection(collection)
  const type = declaredType ?? collectionType ?? collection
  if (declaredType === undefined && collectionType === null) {
    report(
      'PRS007',
      'error',
      `문서 타입을 알 수 없습니다. 컬렉션 '${collection}' 이 규약에 없습니다`,
      1,
      `frontmatter 에 type 을 적거나 규약의 collections 에 '${collection}' 을 더하세요`,
    )
  }

  let id: string
  try {
    id = formatDocumentId(collection, documentAux.stableId ?? name)
  } catch (error) {
    report('PRS008', 'error', (error as Error).message, 1)
    return { document: null, diagnostics }
  }

  // ── 트리 세우기 ─────────────────────────────────────────────────────────
  const roots: (Builder | Block)[] = []
  const stack: Builder[] = []

  units.forEach((unit, index) => {
    const { node } = unit
    const line = lineOf(node)
    for (const problem of unit.directiveProblems) report('PRS004', 'error', problem, line)

    const bodyStart = startOf(node)
    const end = boundaries[index + 1] ?? text.length
    const directiveRaw =
      unit.directiveStart === null ? null : text.slice(unit.directiveStart, bodyStart)
    const raw = text.slice(bodyStart, end)

    const declared = buildAux(unit.entries, schema)
    for (const problem of declared.problems) report('PRS004', 'error', problem, line)
    if (declared.reserved.has('type')) {
      report('PRS004', 'error', 'type 은 frontmatter 에서만 쓸 수 있습니다', line)
    }

    if (node.type === 'heading') {
      const headingNode = node as Heading
      const headingText = mdastToString(headingNode)
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= headingNode.depth) stack.pop()

      const mapped = schema.sectionPathForHeading(type, headingText)
      const key = mapped === null ? slugify(headingText) : mapped[mapped.length - 1]!
      if (mapped === null) {
        report(
          'PRS005',
          'warning',
          `규약에 없는 섹션 제목입니다: ${headingText}`,
          line,
          `'${type}' 타입이 아는 섹션만 쓰거나 규약에 더하세요`,
        )
      }

      const builder: Builder = {
        key,
        heading: headingText,
        depth: headingNode.depth,
        children: [],
        section: {
          key,
          heading: headingText,
          depth: headingNode.depth,
          line: line ?? null,
          aux: declared.aux,
          stableId: declared.stableId,
          raw,
          directiveRaw,
        },
      }
      const parent = stack[stack.length - 1]
      if (parent === undefined) roots.push(builder)
      else parent.children.push(builder)
      stack.push(builder)
      return
    }

    const parent = stack[stack.length - 1]
    const sectionPath = stack.map((builder) => builder.key)
    const defaultRole = parent === undefined ? null : schema.defaultRoleAt(type, sectionPath)
    const role = declared.aux.role ?? defaultRole ?? undefined

    const block = new Block({
      form: formOf(node),
      text: mdastToString(node),
      source: node,
      raw,
      directiveRaw,
      // 기본 역할은 읽는 시점에 해소한다. 이후 층은 aux.role 만 보면 된다.
      aux: makeAux({ ...declared.aux, ...(role === undefined ? {} : { role }) }),
      stableId: declared.stableId,
    })
    if (parent === undefined) roots.push(block)
    else parent.children.push(block)
  })

  const document = new Document({
    id,
    type,
    path,
    raw: documentRaw,
    aux: documentAux.aux,
    children: roots.map((child) => (child instanceof Block ? child : toSection(child))),
  })

  return { document, diagnostics }
}
