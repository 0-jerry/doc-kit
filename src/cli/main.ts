/**
 * 사람과 CI 를 위한 진입점. 에이전트가 쓰는 것과 같은 층 위에 얹혀 있고,
 * 자기만 아는 규칙을 갖지 않는다.
 *
 * 이 파일은 실행하지 않는다 — 실행은 `bin.ts` 가 한다. 그래야 테스트가 import 할 수 있다.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyCommands } from '../api/index.js'
import { countBySeverity, formatDiagnostic, hasError } from '../diagnostic/index.js'
import { serializeDocument } from '../serialize/index.js'
import { contextFor, query } from '../query/index.js'
import { renderSite } from '../render/index.js'
import { splitDocument } from '../nodes/index.js'
import { loadWorkspace } from '../workspace/index.js'
import { type Parsed, flag, flagList, hasFlag, parseArgv } from './options.js'
import { resolveSchema } from './schema-source.js'

const USAGE = `rulekit — 판단기준 문서를 구조화해 저작·검증·질의한다

  rulekit check   [루트]            규약과 원칙을 검사한다
  rulekit index   [루트] --out <디렉터리>   인덱스와 그래프를 낸다
  rulekit query   [루트] --role norm --subject … --topic … --text …
  rulekit context <파일경로> [--root 루트]  그 파일에 적용되는 판단기준
  rulekit render  [루트] --out <디렉터리>   정적 규칙집
  rulekit apply   [루트] --commands <파일|-> [--dry-run]
  rulekit split   [루트] --document <id> [--dry-run] [--replace]
                                    문서를 노드 디렉터리로 흩는다
  rulekit assemble [루트] --document <id> [--out <파일>]
                                    노드 트리를 한 파일로 합친다

공통 옵션
  --schema <경로>   규약 파일. 생략하면 <루트>/.rulekit/schema.yaml, 없으면 내장 프리셋
  --json            결과를 JSON 으로
  --strict          경고도 실패로 본다
`

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function openWorkspace(parsed: Parsed, rootDefault = 'rules') {
  const root = parsed.command === 'context' ? (flag(parsed, 'root') ?? rootDefault)
    : (parsed.positional[0] ?? rootDefault)
  const { schema, origin } = resolveSchema(root, flag(parsed, 'schema'))
  return { root, origin, workspace: loadWorkspace({ root, schema }) }
}

function reportDiagnostics(parsed: Parsed, diagnostics: ReturnType<typeof loadWorkspace>['diagnostics']): number {
  if (hasFlag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`)
  } else {
    for (const item of diagnostics) process.stdout.write(`${formatDiagnostic(item)}\n`)
    const counts = countBySeverity(diagnostics)
    process.stdout.write(
      diagnostics.length === 0
        ? '진단 없음\n'
        : `\n오류 ${counts.error} · 경고 ${counts.warning}\n`,
    )
  }
  const strict = hasFlag(parsed, 'strict')
  return hasError(diagnostics) || (strict && diagnostics.length > 0) ? 1 : 0
}

function commandCheck(parsed: Parsed): number {
  const { workspace, origin } = openWorkspace(parsed)
  if (!hasFlag(parsed, 'json')) {
    process.stdout.write(`규약: ${origin} · 문서 ${workspace.documents.length} 개\n\n`)
  }
  return reportDiagnostics(parsed, workspace.diagnostics)
}

function commandIndex(parsed: Parsed): number {
  const { workspace } = openWorkspace(parsed)
  const out = flag(parsed, 'out') ?? '.rulekit/out'

  for (const entry of workspace.entries) {
    write(
      join(out, 'documents', `${entry.document.id}.json`),
      `${JSON.stringify({ id: entry.document.id, type: entry.document.type, path: entry.document.path, records: entry.records }, null, 2)}\n`,
    )
  }
  const inverted = (index: ReadonlyMap<string, readonly string[]>) =>
    Object.fromEntries([...index].sort(([a], [b]) => a.localeCompare(b)))

  write(
    join(out, 'index.json'),
    `${JSON.stringify(
      {
        documents: workspace.documents.map((document) => document.id),
        bySubject: inverted(workspace.bySubject),
        byTopic: inverted(workspace.byTopic),
        byRole: inverted(workspace.byRole),
        byStatus: inverted(workspace.byStatus),
        byCollection: inverted(workspace.byCollection),
      },
      null,
      2,
    )}\n`,
  )
  write(join(out, 'graph.json'), `${JSON.stringify({ edges: workspace.graph.edges }, null, 2)}\n`)

  process.stdout.write(`${out} 에 문서 ${workspace.entries.length} 개와 인덱스를 썼습니다\n`)
  return hasError(workspace.diagnostics) ? 1 : 0
}

function commandQuery(parsed: Parsed): number {
  const { workspace } = openWorkspace(parsed)
  const hits = query(workspace, {
    ...(flagList(parsed, 'role') === undefined ? {} : { role: flagList(parsed, 'role')! }),
    ...(flagList(parsed, 'subject') === undefined ? {} : { subject: flagList(parsed, 'subject')! }),
    ...(flagList(parsed, 'topic') === undefined ? {} : { topic: flagList(parsed, 'topic')! }),
    ...(flagList(parsed, 'status') === undefined ? {} : { status: flagList(parsed, 'status')! }),
    ...(flagList(parsed, 'level') === undefined ? {} : { level: flagList(parsed, 'level')! }),
    ...(flag(parsed, 'text') === undefined ? {} : { text: flag(parsed, 'text')! }),
  })

  if (hasFlag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`)
    return 0
  }
  for (const hit of hits) {
    process.stdout.write(`${hit.address}\n  ${hit.text}\n`)
    if (hit.breadcrumb.length > 0) process.stdout.write(`  · ${hit.breadcrumb.join(' / ')}\n`)
    if (hit.support.length > 0) process.stdout.write(`  · 근거: ${hit.support.join(' ')}\n`)
  }
  process.stdout.write(hits.length === 0 ? '해당하는 판단기준이 없습니다\n' : `\n${hits.length} 개\n`)
  return 0
}

function commandContext(parsed: Parsed): number {
  const target = parsed.positional[0]
  if (target === undefined) {
    process.stderr.write('파일 경로를 주세요\n')
    return 2
  }
  const { workspace } = openWorkspace(parsed)
  const result = contextFor(workspace, target)

  if (hasFlag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  }
  process.stdout.write(
    `${target}\n대상: ${result.subjects.length === 0 ? '(어휘가 모르는 경로)' : result.subjects.join(' · ')}\n\n`,
  )
  for (const hit of result.hits) process.stdout.write(`- ${hit.text}\n  ${hit.address}\n`)
  return 0
}

function commandRender(parsed: Parsed): number {
  const { workspace } = openWorkspace(parsed)
  const out = flag(parsed, 'out') ?? '.rulekit/site'
  const files = renderSite(workspace, {
    ...(flag(parsed, 'title') === undefined ? {} : { title: flag(parsed, 'title')! }),
  })
  for (const file of files) write(join(out, file.path), file.content)
  process.stdout.write(`${out} 에 ${files.length} 개 파일을 썼습니다\n`)
  return 0
}

function commandApply(parsed: Parsed): number {
  const source = flag(parsed, 'commands')
  if (source === undefined) {
    process.stderr.write('--commands <파일|-> 로 명령을 주세요\n')
    return 2
  }
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8')
  let commands: unknown[]
  try {
    const parsedJson: unknown = JSON.parse(text)
    commands = Array.isArray(parsedJson) ? parsedJson : [parsedJson]
  } catch (error) {
    process.stderr.write(`명령을 읽을 수 없습니다: ${(error as Error).message}\n`)
    return 2
  }

  const { root, workspace } = openWorkspace(parsed)
  const documentId = flag(parsed, 'document')
  const target = documentId === undefined ? null : workspace.document(documentId)
  if (documentId !== undefined && target === null) {
    process.stderr.write(`그런 문서가 없습니다: ${documentId}\n`)
    return 2
  }

  const result = applyCommands(target, commands, { schema: workspace.schema })
  if (hasFlag(parsed, 'json')) {
    process.stdout.write(
      `${JSON.stringify({ ok: result.ok, diagnostics: result.diagnostics }, null, 2)}\n`,
    )
  } else {
    for (const item of result.diagnostics) process.stdout.write(`${formatDiagnostic(item)}\n`)
  }
  if (!result.ok || result.document === null) return 1

  if (hasFlag(parsed, 'dry-run')) {
    if (!hasFlag(parsed, 'json')) {
      process.stdout.write(`\n--- ${result.document.path} (쓰지 않음) ---\n`)
      process.stdout.write(serializeDocument(result.document, { schema: workspace.schema }))
    }
    return hasError(result.diagnostics) ? 1 : 0
  }

  write(
    join(root, result.document.path),
    serializeDocument(result.document, { schema: workspace.schema }),
  )
  process.stdout.write(`${join(root, result.document.path)} 를 썼습니다\n`)
  return hasError(result.diagnostics) ? 1 : 0
}

function commandSplit(parsed: Parsed): number {
  const { root, workspace } = openWorkspace(parsed)
  const documentId = flag(parsed, 'document')
  if (documentId === undefined) {
    process.stderr.write('--document <id> 로 흩을 문서를 고르세요\n')
    return 2
  }
  const document = workspace.document(documentId)
  if (document === null) {
    process.stderr.write(`그런 문서가 없습니다: ${documentId}\n`)
    return 2
  }

  const files = splitDocument(document, workspace.schema)
  if (hasFlag(parsed, 'dry-run')) {
    for (const file of files) {
      process.stdout.write(`\n--- ${file.path} (쓰지 않음) ---\n${file.content}`)
    }
    return 0
  }

  for (const file of files) write(join(root, file.path), file.content)
  process.stdout.write(`${join(root, dirname(files[0]!.path))} 에 노드 ${files.length} 개를 썼습니다\n`)

  // 원본 단일 파일이 남아 있으면 같은 식별자를 가진 문서가 둘이 된다.
  const original = join(root, `${document.id}.md`)
  if (!existsSync(original)) return 0
  if (!hasFlag(parsed, 'replace')) {
    process.stdout.write(
      `\n${original} 이 그대로 남아 있습니다. 같은 식별자를 가진 문서가 둘이 됩니다.\n` +
        '지우려면 --replace 를 주세요\n',
    )
    return 1
  }
  rmSync(original)
  process.stdout.write(`${original} 을 지웠습니다\n`)
  return 0
}

function commandAssemble(parsed: Parsed): number {
  const { workspace } = openWorkspace(parsed)
  const documentId = flag(parsed, 'document')
  if (documentId === undefined) {
    process.stderr.write('--document <id> 로 합칠 문서를 고르세요\n')
    return 2
  }
  const document = workspace.document(documentId)
  if (document === null) {
    process.stderr.write(`그런 문서가 없습니다: ${documentId}\n`)
    return 2
  }

  const text = serializeDocument(document, { schema: workspace.schema })
  const out = flag(parsed, 'out')
  if (out === undefined) {
    process.stdout.write(text)
    return 0
  }
  write(out, text)
  process.stdout.write(`${out} 를 썼습니다\n`)
  return 0
}

const COMMANDS: Record<string, (parsed: Parsed) => number> = {
  check: commandCheck,
  index: commandIndex,
  query: commandQuery,
  context: commandContext,
  render: commandRender,
  apply: commandApply,
  split: commandSplit,
  assemble: commandAssemble,
}

export function run(argv: readonly string[]): number {
  const parsed = parseArgv(argv)
  if (parsed.command === null || parsed.command === 'help' || hasFlag(parsed, 'help')) {
    process.stdout.write(USAGE)
    return parsed.command === null ? 2 : 0
  }
  const handler = COMMANDS[parsed.command]
  if (handler === undefined) {
    process.stderr.write(`모르는 명령입니다: ${parsed.command}\n\n${USAGE}`)
    return 2
  }
  try {
    return handler(parsed)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 2
  }
}
