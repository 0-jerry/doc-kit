import fs from 'node:fs/promises'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { RuleStatus, Severity } from './types.js'

/**
 * 이미 문서별로 쪼개져 있는 규칙 트리를 규칙 파일로 정규화한다.
 * 문서 하나가 규칙 하나이고, 문서 간 링크가 관계가 된다.
 *
 * 선택적으로 문서 레지스트리(TSV)를 읽어 id·제목·요약·적용 범위를 가져온다.
 * 레지스트리가 있으면 그것이 정본이고, 없으면 경로와 H1 에서 추론한다.
 */
export interface DocTreeOptions {
  /** 문서 루트. 이 아래의 `.md` 를 훑는다. */
  source: string
  out: string
  /** `documents.tsv` 경로. `doc_id / path / kind / topic / title / summary` 열. */
  registry?: string
  /** `document_scopes.tsv` 경로. `doc_id` + 자유 차원 열. */
  scopes?: string
  /** 가져올 문서 종류. 레지스트리가 있을 때만 의미가 있다. */
  kinds?: string[]
  /** 레지스트리 경로가 기준으로 삼는 루트. 기본은 `source` 의 상위. */
  repoRoot?: string
  /** H2 제목 → 섹션 키 매핑. 지정하지 않은 제목은 `rule` 로 간주한다. */
  sectionMap?: Record<string, string>
  /**
   * 규칙으로 수입되지 않은 문서를 가리키는 링크의 접두사.
   * 지정하면 `<docBase>/<저장소 기준 경로>` 로 쓰고,
   * 없으면 생성된 파일에서 원문까지의 상대 경로로 쓴다.
   */
  docBase?: string
  /**
   * 모든 규칙에 부여할 심각도. 원문에 심각도 신호가 없을 때 쓰는 가정값이다.
   * 기본은 `error` — 프로젝트 컨벤션은 리뷰에서 차단하는 규범으로 본다.
   */
  severity?: Severity
  dryRun?: boolean
}

export interface DocTreeRule {
  id: string
  title: string
  summary?: string
  category: string
  tags: string[]
  severity: Severity
  status: RuleStatus
  since?: string
  scope: Record<string, string[]>
  extends: string[]
  related: string[]
  sections: { key: string; body: string }[]
  /** 규칙으로 수입되지 않은 문서를 가리키는 링크. `## References` 로 보낸다. */
  externalRefs: { text: string; target: string }[]
  sourcePath: string
  targetPath: string
}

export interface LinkStats {
  total: number
  /** 수입된 규칙으로 다시 쓴 링크. */
  toRule: number
  /** 원문 문서를 계속 가리키도록 다시 쓴 링크. */
  toDocument: number
  /** 그대로 둔 링크(외부 URL, 문서 내 앵커). */
  untouched: number
  /** 대상 규칙에 남아 있지 않아 떨어낸 앵커. */
  droppedAnchors: number
}

export interface DocTreeReport {
  out: string
  rules: DocTreeRule[]
  links: LinkStats
  skipped: { path: string; reason: string }[]
  /** `sectionMap` 에 없어서 `rule` 로 처리한 H2 제목. 매핑을 다듬는 근거. */
  unmappedHeadings: Record<string, number>
  categories: string[]
}

/** 문서에 흔한 한국어 서술 제목. 나머지는 규범으로 본다. */
const DEFAULT_SECTION_MAP: Record<string, string> = {
  설명: 'why',
  목적: 'why',
  배경: 'why',
  이유: 'why',
  '관련 문서': 'references',
  '인덱스와 참고 단위 문서': 'references',
  '검토 체크리스트': 'references',
  '문서 변경 기준': 'migration',
}

const STATUS_MAP: Record<string, RuleStatus> = {
  정본: 'active',
  초안: 'proposed',
  폐기: 'deprecated',
  대체됨: 'superseded',
}

const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const HAS_LINK = /\[[^\]]*\]\([^)\s]+\)/
const META_LINE = /^\*\*(상태|작성일|최종 수정일)\*\*\s*:\s*(.+)$/
const NUMBERED = /^\d+(?:\.\d+)*\.\s*/

interface RegistryRow {
  docId: string
  relPath: string
  kind: string
  topic: string
  title: string
  summary: string
}

async function readTsv(file: string): Promise<string[][]> {
  const text = await fs.readFile(file, 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => line.split('\t'))
}

async function readRegistry(file: string): Promise<Map<string, RegistryRow>> {
  const [, ...rows] = await readTsv(file)
  const map = new Map<string, RegistryRow>()
  for (const row of rows) {
    const [docId, relPath, kind, topic, title, summary] = row
    if (!docId || !relPath) continue
    map.set(relPath, {
      docId,
      relPath,
      kind: kind ?? '',
      topic: topic ?? '',
      title: title ?? '',
      summary: summary ?? '',
    })
  }
  return map
}

/** 스코프 TSV 를 `doc_id → { 차원: 값[] }` 로 접는다. `*` 는 제약 없음이므로 버린다. */
async function readScopes(file: string): Promise<Map<string, Record<string, string[]>>> {
  const [header, ...rows] = await readTsv(file)
  const dims = (header ?? []).slice(1)
  const map = new Map<string, Record<string, string[]>>()
  for (const row of rows) {
    const docId = row[0]
    if (!docId) continue
    const entry = map.get(docId) ?? {}
    for (const [i, dim] of dims.entries()) {
      const value = row[i + 1]?.trim()
      if (!value || value === '*') continue
      entry[dim] = [...new Set([...(entry[dim] ?? []), value])]
    }
    map.set(docId, entry)
  }
  return map
}

async function findMarkdown(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.md')) out.push(full)
    }
  }
  await walk(root)
  return out.sort()
}

/**
 * 요약은 목록에서 한 줄로 읽히는 메타데이터다.
 * 링크 표기를 걷어내고 줄바꿈을 접어 평문 한 줄로 만든다.
 */
const toSummaryText = (text: string): string =>
  text
    .replace(LINK, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)

/** 윈도우 경로 구분자를 링크에 쓰이는 형태로 맞춘다. */
const posix = (p: string): string => p.split(path.sep).join('/')

const idOf = (docId: string): string =>
  docId
    .replace(/[.\s_/]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')

interface Block {
  kind: 'para' | 'list' | 'code' | 'heading'
  depth: number
  text: string
  lines: string[]
  items: number
}

/** 마크다운을 최상위 블록으로 쪼갠다. 코드펜스 안은 건드리지 않는다. */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []
  let mode: Block['kind'] | null = null
  let items = 0
  let blankInList = false

  const flush = (): void => {
    if (!mode || buffer.length === 0) {
      buffer = []
      mode = null
      items = 0
      return
    }
    blocks.push({
      kind: mode,
      depth: 0,
      text: buffer.join('\n').trim(),
      lines: [...buffer],
      items,
    })
    buffer = []
    mode = null
    items = 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (line.trimStart().startsWith('```')) {
      flush()
      const fence: string[] = [line]
      i += 1
      while (i < lines.length) {
        fence.push(lines[i]!)
        if (lines[i]!.trimStart().startsWith('```')) break
        i += 1
      }
      blocks.push({ kind: 'code', depth: 0, text: fence.join('\n'), lines: fence, items: 0 })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({
        kind: 'heading',
        depth: heading[1]!.length,
        text: heading[2]!.trim(),
        lines: [line],
        items: 0,
      })
      continue
    }
    if (line.trim() === '') {
      // 목록은 빈 줄 하나로 끝나지 않는다. 다음 줄의 모양을 보고 판단한다.
      if (mode === 'list') {
        blankInList = true
        continue
      }
      flush()
      continue
    }
    const isItem = /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
    const indented = /^\s+\S/.test(line)
    // 목록 항목의 이어지는 줄은 들여쓰기로 구분한다.
    // 빈 줄 뒤에 들여쓰기 없는 산문이 오면 목록은 거기서 끝난다.
    const continuesList: boolean = mode === 'list' && (isItem || indented)
    if (mode === 'list' && !continuesList) {
      flush()
    } else if (blankInList && continuesList) {
      buffer.push('')
    }
    blankInList = false
    const nextMode: Block['kind'] = isItem || continuesList ? 'list' : 'para'
    if (mode && mode !== nextMode) flush()
    mode = nextMode
    if (isItem) items += 1
    buffer.push(line)
  }
  flush()
  return blocks
}

/** 평탄 문서: 마지막 목록까지가 규범, 그 뒤 산문이 근거, 코드가 예시. */
function splitFlat(blocks: Block[]): { key: string; body: string }[] {
  const body = blocks.filter((b) => b.kind !== 'heading')
  // 코드는 예시로 빼고, 남은 산문 위에서 경계를 잡는다.
  const prose = body.filter((b) => b.kind !== 'code')
  const lastList = prose.map((b) => b.kind).lastIndexOf('list')
  const boundary = lastList >= 0 ? lastList : 0
  const rule = prose.slice(0, boundary + 1)
  const why = prose.slice(boundary + 1)
  const code = body.filter((b) => b.kind === 'code')
  return [
    { key: 'rule', body: join(rule) },
    { key: 'why', body: join(why) },
    { key: 'examples', body: join(code) },
  ]
}

/** 섹션 문서: H2 제목을 규약 섹션으로 접는다. */
function splitSectioned(
  blocks: Block[],
  map: Record<string, string>,
  unmapped: Record<string, number>,
): { key: string; body: string }[] {
  const buckets = new Map<string, Block[]>()
  let current = 'rule'
  for (const block of blocks) {
    if (block.kind === 'heading' && block.depth === 1) continue
    if (block.kind === 'heading' && block.depth === 2) {
      const name = block.text.replace(NUMBERED, '').trim()
      const mapped = map[name]
      if (!mapped) unmapped[name] = (unmapped[name] ?? 0) + 1
      current = mapped ?? 'rule'
      // 접힌 제목은 본문 안에서 굵은 소제목으로 남겨 내용 경계를 보존한다.
      push(buckets, current, { ...block, kind: 'para', text: `**${name}**`, lines: [`**${name}**`] })
      continue
    }
    if (block.kind === 'heading') {
      push(buckets, current, { ...block, kind: 'para', text: `**${block.text}**`, lines: [`**${block.text}**`] })
      continue
    }
    push(buckets, block.kind === 'code' ? 'examples' : current, block)
  }
  return [...buckets].map(([key, list]) => ({ key, body: join(list) }))
}

function push(map: Map<string, Block[]>, key: string, block: Block): void {
  map.set(key, [...(map.get(key) ?? []), block])
}

const join = (blocks: Block[]): string =>
  blocks.map((b) => b.text).filter(Boolean).join('\n\n').trim()

/** 문서 하나를 읽어 규칙으로 환원한다. */
async function readDoc(
  file: string,
  ctx: {
    repoRoot: string
    out: string
    registry: Map<string, RegistryRow>
    scopes: Map<string, Record<string, string[]>>
    sectionMap: Record<string, string>
    unmapped: Record<string, number>
    severity: Severity
  },
): Promise<DocTreeRule | null> {
  const relPath = path.relative(ctx.repoRoot, file)
  const row = ctx.registry.get(relPath)
  const text = await fs.readFile(file, 'utf8')
  const lines = text.split('\n')

  const h1 = lines.find((l) => /^#\s+/.test(l))?.replace(/^#\s+/, '').trim()
  const title = (row?.title || h1 || path.basename(file, '.md')).slice(0, 120)

  let status: RuleStatus = 'active'
  let since: string | undefined
  const kept: string[] = []
  for (const line of lines) {
    const meta = META_LINE.exec(line.trim())
    if (!meta) {
      kept.push(line)
      continue
    }
    if (meta[1] === '상태') status = STATUS_MAP[meta[2]!.trim()] ?? 'active'
    if (meta[1] === '작성일') {
      since = /(\d{4}-\d{2}-\d{2})/.exec(meta[2]!)?.[1]
    }
  }

  // 부모 문서를 가리키는 안내 문장은 관계로 환원하고 본문에서 뺀다.
  const parents: string[] = []
  const body: string[] = []
  for (const line of kept) {
    if (/문서입니다\s*\.?\s*$/.test(line.trim()) && HAS_LINK.test(line)) {
      for (const m of line.matchAll(LINK)) parents.push(m[2]!)
      continue
    }
    body.push(line)
  }

  const blocks = toBlocks(body).filter((b) => !(b.kind === 'heading' && b.depth === 1))
  const hasSections = blocks.some((b) => b.kind === 'heading' && b.depth === 2)
  const sections = (
    hasSections
      ? splitSectioned(blocks, ctx.sectionMap, ctx.unmapped)
      : splitFlat(blocks)
  ).filter((s) => s.body.length > 0)

  if (!sections.some((s) => s.key === 'rule')) return null

  const docId = row?.docId ?? relPath.replace(/\.md$/, '')
  const topic = row?.topic ?? path.basename(path.dirname(file))
  const [category = 'general', ...rest] = topic.split('.')
  const tags = [...rest, ...(row && row.kind !== 'rule' ? [row.kind] : [])]

  return {
    id: idOf(docId),
    title,
    summary: row?.summary ? toSummaryText(row.summary) : undefined,
    category: idOf(category),
    tags: tags.map(idOf).filter(Boolean),
    severity: ctx.severity,
    status,
    since,
    scope: ctx.scopes.get(docId) ?? {},
    extends: parents.map((p) => resolve(file, p)),
    related: [
      ...new Set(
        [...body.join('\n').matchAll(LINK)]
          .map((m) => resolve(file, m[2]!))
          .filter(Boolean),
      ),
    ],
    sections,
    externalRefs: [],
    sourcePath: relPath,
    targetPath: '',
  }
}

/** 상대 링크를 저장소 기준 경로로 편다. 앵커와 외부 URL 은 버린다. */
function resolve(from: string, href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return ''
  const [target] = href.split('#')
  if (!target) return ''
  return path.resolve(path.dirname(from), target)
}

function render(rule: DocTreeRule): string {
  const meta: Record<string, unknown> = { id: rule.id, title: rule.title }
  if (rule.summary) meta.summary = rule.summary
  meta.category = rule.category
  meta.severity = rule.severity
  meta.status = rule.status
  if (rule.since) meta.since = rule.since
  if (rule.tags.length > 0) meta.tags = rule.tags
  if (Object.keys(rule.scope).length > 0) meta.scope = rule.scope
  if (rule.extends.length > 0) meta.extends = rule.extends
  if (rule.related.length > 0) meta.related = rule.related

  const order = ['rule', 'why', 'examples', 'exceptions', 'migration', 'references']
  const heading: Record<string, string> = {
    rule: 'Rule',
    why: 'Why',
    examples: 'Examples',
    exceptions: 'Exceptions',
    migration: 'Migration',
    references: 'References',
  }
  const parts = [`---\n${stringifyYaml(meta).trimEnd()}\n---`]
  const refs = [
    `- 원문: \`${rule.sourcePath}\``,
    ...rule.externalRefs.map((r) => `- [${r.text || '참고 문서'}](${r.target})`),
  ]
  for (const key of order) {
    const found = rule.sections.filter((s) => s.key === key).map((s) => s.body)
    const extra = key === 'references' ? refs : []
    const body = [...found, ...extra].filter(Boolean).join('\n\n')
    if (body) parts.push(`## ${heading[key]}\n\n${body}`)
  }
  return `${parts.join('\n\n')}\n`
}

export async function importDocTree(options: DocTreeOptions): Promise<DocTreeReport> {
  const source = path.resolve(options.source)
  const out = path.resolve(options.out)
  const repoRoot = path.resolve(options.repoRoot ?? path.dirname(source))
  const registry = options.registry
    ? await readRegistry(path.resolve(options.registry))
    : new Map<string, RegistryRow>()
  const scopes = options.scopes
    ? await readScopes(path.resolve(options.scopes))
    : new Map<string, Record<string, string[]>>()
  const kinds = new Set(options.kinds ?? ['rule', 'package-rule'])
  const sectionMap = { ...DEFAULT_SECTION_MAP, ...options.sectionMap }
  const unmapped: Record<string, number> = {}

  const files = await findMarkdown(source)
  const selected = files.filter((file) => {
    if (registry.size === 0) return true
    const row = registry.get(path.relative(repoRoot, file))
    return row ? kinds.has(row.kind) : false
  })

  const skipped: DocTreeReport['skipped'] = []
  const rules: DocTreeRule[] = []
  for (const file of selected) {
    const rule = await readDoc(file, {
      repoRoot,
      out,
      registry,
      scopes,
      sectionMap,
      unmapped,
      severity: options.severity ?? 'error',
    })
    if (!rule) {
      skipped.push({
        path: path.relative(repoRoot, file),
        reason: '규범 진술로 볼 본문을 찾지 못했습니다',
      })
      continue
    }
    rules.push(rule)
  }

  // 링크를 수입된 규칙으로만 좁히고, 나머지는 참고 문헌으로 내린다.
  const byAbsPath = new Map(
    rules.map((r) => [path.resolve(repoRoot, r.sourcePath), r.id]),
  )
  for (const rule of rules) {
    const self = path.resolve(repoRoot, rule.sourcePath)
    const map = (targets: string[]): string[] => [
      ...new Set(
        targets
          .map((t) => (t && t !== self ? byAbsPath.get(t) : undefined))
          .filter((v): v is string => Boolean(v) && v !== rule.id),
      ),
    ]
    const outside = [...rule.extends, ...rule.related].filter(
      (t) => t && t !== self && !byAbsPath.has(t),
    )
    rule.externalRefs = [
      ...new Set(outside.map((t) => path.relative(repoRoot, t))),
    ].map((target) => ({ text: '관련 문서', target }))
    rule.extends = map(rule.extends)
    rule.related = map(rule.related).filter((r) => !rule.extends.includes(r))
    rule.targetPath = path.join(out, rule.category, `${rule.id}.md`)
  }

  // 본문 링크를 전부 다시 쓴다. 대상이 규칙이면 새 트리 안으로,
  // 아니면 원문 문서를 계속 가리키도록 경로를 다시 계산한다.
  const targetOf = new Map(rules.map((r) => [r.id, r.targetPath]))
  const sectionAnchors = new Set(
    ['rule', 'why', 'examples', 'exceptions', 'migration', 'references'],
  )
  const links: LinkStats = {
    total: 0,
    toRule: 0,
    toDocument: 0,
    untouched: 0,
    droppedAnchors: 0,
  }

  const rewrite = (body: string, self: string, fromDir: string): string =>
    body.replace(LINK, (whole, text: string, href: string) => {
      links.total += 1
      if (/^[a-z]+:/i.test(href) || href.startsWith('#')) {
        links.untouched += 1
        return whole
      }
      const [target, anchor] = href.split('#')
      if (!target) {
        links.untouched += 1
        return whole
      }
      const abs = path.resolve(path.dirname(self), target)
      const id = byAbsPath.get(abs)
      const rulePath = id ? targetOf.get(id) : undefined

      if (rulePath) {
        // 생성된 파일의 제목은 규약이 정한 것뿐이므로, 살아남는 앵커만 유지한다.
        const keep = anchor && sectionAnchors.has(anchor.toLowerCase())
        if (anchor && !keep) links.droppedAnchors += 1
        links.toRule += 1
        return `[${text}](${posix(path.relative(fromDir, rulePath))}${keep ? `#${anchor}` : ''})`
      }

      links.toDocument += 1
      const rel = options.docBase
        ? `${options.docBase.replace(/\/$/, '')}/${posix(path.relative(repoRoot, abs))}`
        : posix(path.relative(fromDir, abs))
      return `[${text}](${rel}${anchor ? `#${anchor}` : ''})`
    })

  for (const rule of rules) {
    const self = path.resolve(repoRoot, rule.sourcePath)
    const fromDir = path.dirname(rule.targetPath)
    rule.sections = rule.sections.map((section) => ({
      ...section,
      body: rewrite(section.body, self, fromDir),
    }))
    rule.externalRefs = rule.externalRefs.map((ref) => ({
      ...ref,
      target: options.docBase
        ? `${options.docBase.replace(/\/$/, '')}/${ref.target}`
        : posix(path.relative(fromDir, path.resolve(repoRoot, ref.target))),
    }))
  }

  if (!options.dryRun) {
    await fs.mkdir(out, { recursive: true })
    for (const rule of rules) {
      await fs.mkdir(path.dirname(rule.targetPath), { recursive: true })
      await fs.writeFile(rule.targetPath, render(rule))
    }
  }

  return {
    out,
    rules,
    links,
    skipped,
    unmappedHeadings: unmapped,
    categories: [...new Set(rules.map((r) => r.category))].sort(),
  }
}
