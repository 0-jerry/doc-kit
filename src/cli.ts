#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { reporter } from 'vfile-reporter'
import { collectRules } from './collect.js'
import { buildGraph, toDot, toMermaid } from './graph.js'
import { buildIndex } from './index-build.js'
import { importGuide } from './import.js'
import { importDocTree } from './import-doc-tree.js'
import { renderSite } from './render/index.js'
import { validateRuleSet } from './validate.js'
import type { RuleSet } from './types.js'

const USAGE = `rulekit — 프로젝트 규칙을 구조화·검증·탐색합니다

사용법:
  rulekit lint  [rules-dir] [--json] [--quiet] [--max-sentences <n>]
  rulekit build [rules-dir] [-o <out-dir>] [--format json|mermaid|dot]
  rulekit render [rules-dir] [-o <out-dir>] [--site-title <name>]
                 [--source-base <url>] [--inline-assets]
  rulekit import <guide.md> [-o <rules-dir>] [--source-link <path>] [--dry-run]
  rulekit import <docs-dir> --profile doc-tree [-o <rules-dir>]
                 [--registry <documents.tsv>] [--scopes <scopes.tsv>]
                 [--kinds rule,package-rule] [--repo-root <dir>]

명령:
  lint    frontmatter 스키마 · 본문 구조 · 규칙 간 참조 무결성을 검사합니다.
  build   lint 를 통과한 규칙으로 인덱스(rules.index.json)와
          그래프(rules.graph.json)를 생성합니다.
  render  lint 를 통과한 규칙을 정적 HTML 사이트로 렌더합니다.
  import  기존 규칙 문서를 규칙 파일 트리로 정규화합니다.
          --profile anchor-list (기본) 단일 파일 가이드를 분해
          --profile doc-tree           이미 쪼개진 문서 트리를 정규화

옵션:
  -o, --out <dir>       산출물 디렉터리 (기본: .rulekit)
      --format <fmt>    그래프 출력 형식. json(기본) | mermaid | dot
      --json            lint 결과를 JSON 으로 출력
      --strict          경고도 실패로 취급 (CI 용)
      --quiet           경고를 숨기고 오류만 출력
      --max-sentences   ## Rule 섹션 최대 문장 수 (기본: 3)
      --profile         import 방식. anchor-list(기본) | doc-tree
      --registry        doc-tree: 문서 레지스트리 TSV (id·제목·요약의 정본)
      --scopes          doc-tree: 적용 범위 TSV
      --kinds           doc-tree: 가져올 문서 종류 (쉼표 구분)
      --repo-root       doc-tree: 레지스트리 경로의 기준 디렉터리
      --doc-base        doc-tree: 수입하지 않은 문서를 가리키는 링크의 접두사
                        (생략하면 생성 파일에서 원문까지의 상대 경로)
      --severity        doc-tree: 부여할 심각도 (기본 error)
      --site-title      render: 사이트 제목 (기본: 규칙집)
      --source-base     render: 원문 마크다운 링크 접두사 (예: GitHub blob URL)
      --inline-assets   render: CSS·JS 를 각 문서에 인라인
      --source-link     import 시 ## References 에 남길 원문 경로
      --dry-run         import 결과를 파일로 쓰지 않고 요약만 출력
  -h, --help            이 도움말
`

interface Counts {
  errors: number
  warnings: number
}

function countMessages(set: RuleSet): Counts {
  let errors = 0
  let warnings = 0
  for (const file of set.files) {
    for (const message of file.messages) {
      if (message.fatal) errors += 1
      else warnings += 1
    }
  }
  return { errors, warnings }
}

async function loadRules(dir: string, maxSentences?: number): Promise<RuleSet> {
  const set = await collectRules(dir, {
    maxStatementSentences: maxSentences,
  })
  return validateRuleSet(set)
}

async function cmdLint(dir: string, opts: Record<string, unknown>): Promise<number> {
  const set = await loadRules(dir, opts['max-sentences'] as number | undefined)
  const counts = countMessages(set)

  if (opts.json) {
    const payload = set.files.flatMap((file) =>
      file.messages.map((m) => ({
        path: path.relative(set.root, file.path ?? ''),
        rule: m.source ? `${m.source}:${m.ruleId ?? ''}` : (m.ruleId ?? null),
        severity: m.fatal ? 'error' : 'warning',
        message: m.reason,
        line: m.line,
        column: m.column,
      })),
    )
    console.log(
      JSON.stringify(
        { files: set.files.length, rules: set.rules.length, counts, messages: payload },
        null,
        2,
      ),
    )
  } else {
    const report = reporter(set.files, { quiet: !!opts.quiet, silent: false })
    if (report.trim()) console.error(report)
    console.error(
      `\n규칙 ${set.rules.length}개 / 파일 ${set.files.length}개 · 오류 ${counts.errors} · 경고 ${counts.warnings}`,
    )
  }
  const failed = counts.errors > 0 || (!!opts.strict && counts.warnings > 0)
  return failed ? 1 : 0
}

async function cmdBuild(dir: string, opts: Record<string, unknown>): Promise<number> {
  const set = await loadRules(dir, opts['max-sentences'] as number | undefined)
  const counts = countMessages(set)
  const failed = counts.errors > 0 || (!!opts.strict && counts.warnings > 0)
  if (failed) {
    console.error(reporter(set.files, { quiet: !opts.strict }))
    console.error(
      `\n오류 ${counts.errors}건 · 경고 ${counts.warnings}건 때문에 빌드를 중단했습니다.`,
    )
    return 1
  }

  const index = buildIndex(set)
  const graph = buildGraph(set)
  const format = (opts.format as string | undefined) ?? 'json'

  if (format !== 'json') {
    console.log(format === 'dot' ? toDot(graph) : toMermaid(graph))
    return 0
  }

  const out = path.resolve((opts.out as string | undefined) ?? '.rulekit')
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(
    path.join(out, 'rules.index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(out, 'rules.graph.json'),
    `${JSON.stringify(graph, null, 2)}\n`,
  )
  await fs.writeFile(path.join(out, 'rules.graph.mmd'), `${toMermaid(graph)}\n`)

  console.error(`규칙 ${index.counts.total}개 → ${path.relative(process.cwd(), out)}/`)
  console.error(
    `  rules.index.json  카테고리 ${Object.keys(index.byCategory).length} · 태그 ${Object.keys(index.byTag).length}`,
  )
  console.error(
    `  rules.graph.json  노드 ${graph.nodes.length} · 간선 ${graph.edges.length} · 고립 ${graph.orphans.length}`,
  )
  if (graph.cycles.length > 0) {
    console.error(`  경고: extends 순환 ${graph.cycles.length}건`)
  }
  return 0
}

async function cmdRender(dir: string, opts: Record<string, unknown>): Promise<number> {
  const set = await loadRules(dir, opts['max-sentences'] as number | undefined)
  const counts = countMessages(set)
  const failed = counts.errors > 0 || (!!opts.strict && counts.warnings > 0)
  if (failed) {
    console.error(reporter(set.files, { quiet: !opts.strict }))
    console.error(
      `\n오류 ${counts.errors}건 · 경고 ${counts.warnings}건 때문에 렌더를 중단했습니다.`,
    )
    return 1
  }

  const files = renderSite(set, {
    title: opts['site-title'] as string | undefined,
    sourceBase: opts['source-base'] as string | undefined,
    inlineAssets: !!opts['inline-assets'],
  })

  const out = path.resolve((opts.out as string | undefined) ?? '.rulekit/site')
  if (opts['dry-run']) {
    for (const file of files) console.error(`  ${file.path}`)
    console.error(`\n${files.length}개 파일 (dry-run)`)
    return 0
  }

  for (const file of files) {
    const target = path.join(out, file.path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content)
  }
  console.error(
    `규칙 ${set.rules.length}개 → ${path.relative(process.cwd(), out)}/ (파일 ${files.length}개)`,
  )
  return 0
}

async function cmdImport(
  sourcePath: string,
  opts: Record<string, unknown>,
): Promise<number> {
  const report = await importGuide({
    source: sourcePath,
    out: path.resolve((opts.out as string | undefined) ?? 'rules'),
    sourceLink: opts['source-link'] as string | undefined,
    dryRun: !!opts['dry-run'],
  })

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
    return report.skipped.length > 0 ? 1 : 0
  }

  const withWhy = report.rules.filter((r) => r.why.length > 0).length
  const withExamples = report.rules.filter((r) => r.examples.length > 0).length
  const enforced = report.rules.filter((r) => r.enforcedBy.length > 0).length

  console.error(
    `${report.rules.length}개 규칙을 ${report.categories.length}개 카테고리로 분해${opts['dry-run'] ? ' (dry-run)' : ` → ${path.relative(process.cwd(), report.out)}/`}`,
  )
  for (const category of report.categories) {
    const count = report.rules.filter((r) => r.category === category).length
    console.error(`  ${category.padEnd(28)} ${String(count).padStart(3)}`)
  }
  console.error(
    `\n근거 있음 ${withWhy}/${report.rules.length} · 예시 있음 ${withExamples}/${report.rules.length} · 자동 강제 ${enforced}/${report.rules.length}`,
  )
  if (report.skipped.length > 0) {
    console.error(`\n건너뛴 항목 ${report.skipped.length}건:`)
    for (const s of report.skipped) {
      console.error(`  L${s.line} ${s.reason}: ${s.text}`)
    }
  }
  return report.skipped.length > 0 ? 1 : 0
}

async function cmdImportDocTree(
  sourceDir: string,
  opts: Record<string, unknown>,
): Promise<number> {
  const report = await importDocTree({
    source: sourceDir,
    out: path.resolve((opts.out as string | undefined) ?? 'rules'),
    registry: opts.registry as string | undefined,
    scopes: opts.scopes as string | undefined,
    repoRoot: opts['repo-root'] as string | undefined,
    docBase: opts['doc-base'] as string | undefined,
    severity: opts.severity as 'error' | 'warning' | 'info' | undefined,
    kinds: opts.kinds
      ? String(opts.kinds).split(',').map((k) => k.trim())
      : undefined,
    dryRun: !!opts['dry-run'],
  })

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }

  console.error(
    `${report.rules.length}개 문서를 ${report.categories.length}개 카테고리로 정규화${opts['dry-run'] ? ' (dry-run)' : ` → ${path.relative(process.cwd(), report.out)}/`}`,
  )
  for (const category of report.categories) {
    const count = report.rules.filter((r) => r.category === category).length
    console.error(`  ${category.padEnd(20)} ${String(count).padStart(3)}`)
  }
  const { links } = report
  console.error(
    `\n링크 ${links.total}개 → 규칙으로 ${links.toRule} · 원문 문서로 ${links.toDocument} · 그대로 ${links.untouched}` +
      (links.droppedAnchors > 0 ? ` · 떨어낸 앵커 ${links.droppedAnchors}` : ''),
  )
  const withSummary = report.rules.filter((r) => r.summary).length
  const withScope = report.rules.filter((r) => Object.keys(r.scope).length > 0).length
  const linked = report.rules.filter(
    (r) => r.extends.length + r.related.length > 0,
  ).length
  console.error(
    `\n요약 있음 ${withSummary}/${report.rules.length} · 적용 범위 있음 ${withScope}/${report.rules.length} · 관계 있음 ${linked}/${report.rules.length}`,
  )
  const unmapped = Object.entries(report.unmappedHeadings).sort((a, b) => b[1] - a[1])
  if (unmapped.length > 0) {
    console.error(`\n규범(## Rule)으로 처리한 미매핑 제목 ${unmapped.length}종:`)
    for (const [name, count] of unmapped.slice(0, 12)) {
      console.error(`  ${name} (${count})`)
    }
  }
  if (report.skipped.length > 0) {
    console.error(`\n건너뜀 ${report.skipped.length}건:`)
    for (const s of report.skipped) console.error(`  ${s.path} — ${s.reason}`)
  }
  return 0
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      'source-link': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      profile: { type: 'string' },
      registry: { type: 'string' },
      scopes: { type: 'string' },
      kinds: { type: 'string' },
      'repo-root': { type: 'string' },
      'doc-base': { type: 'string' },
      'site-title': { type: 'string' },
      'source-base': { type: 'string' },
      'inline-assets': { type: 'boolean', default: false },
      severity: { type: 'string' },
      'max-sentences': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  const [command, dirArg] = positionals
  if (values.help || !command) {
    console.log(USAGE)
    return values.help ? 0 : 1
  }

  const dir = path.resolve(dirArg ?? 'rules')
  const opts: Record<string, unknown> = {
    ...values,
    'max-sentences': values['max-sentences']
      ? Number(values['max-sentences'])
      : undefined,
  }

  switch (command) {
    case 'lint':
      return cmdLint(dir, opts)
    case 'build':
      return cmdBuild(dir, opts)
    case 'render':
      return cmdRender(dir, opts)
    case 'import':
      if (!dirArg) {
        console.error('import 에는 원본 가이드 파일 경로가 필요합니다\n')
        console.log(USAGE)
        return 1
      }
      return values.profile === 'doc-tree'
        ? cmdImportDocTree(dir, opts)
        : cmdImport(dir, opts)
    default:
      console.error(`알 수 없는 명령: ${command}\n`)
      console.log(USAGE)
      return 1
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  },
)
