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
import {
  type Retention,
  STORE_CONFIG_PATH,
  collectGarbage,
  indexWorkspace,
  loadStoreConfig,
  loadWorkspace,
  openStore,
  storeConfigText,
} from '../workspace/index.js'
import { type Parsed, flag, flagList, hasFlag, parseArgv } from './options.js'
import { DEFAULT_SCHEMA_PATH, resolveSchema } from './schema-source.js'

const USAGE = `dockit — 마크다운 문서를 블록 트리로 구조화해 저작·검증·질의한다

  dockit check   [루트]            규약과 원칙을 검사한다
  dockit index   [루트] --out <디렉터리>   인덱스와 그래프를 낸다
  dockit query   [루트] --role norm --subject … --topic … --text …
  dockit context <파일경로> [--root 루트]  그 파일에 적용되는 판단기준
  dockit render  [루트] --out <디렉터리>   정적 규칙집
  dockit apply   [루트] --commands <파일|-> [--dry-run]
  dockit split   [루트] --document <id> [--dry-run] [--replace]
                                    문서를 노드 디렉터리로 흩는다
  dockit assemble [루트] --document <id> [--out <파일>]
                                    노드 트리를 한 파일로 합친다
  dockit store   [루트]            객체 저장소를 갱신하고 통계를 낸다
  dockit log     [루트]            스냅샷 이력
  dockit cat     <주소> [--root 루트]  객체 하나를 들여다본다. 주소는 앞부분만 줘도 된다
  dockit gc      [루트] [--dry-run] 작업 트리가 안 쓰는 객체를 거둔다
  dockit init    [루트] [--retention head|all] [--preset <이름>] [--force]
                                    규약과 저장 정책을 만든다

공통 옵션
  --schema <경로>   규약 파일. 생략하면 <루트>/.dockit/schema.yaml, 없으면 내장 프리셋
  --json            결과를 JSON 으로
  --strict          경고도 실패로 본다
  --store <경로>    객체 저장소. 기본은 루트가 속한 프로젝트의 .dockit/store
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
    process.stdout.write(`규약: ${origin} · 문서 ${workspace.documentIds.length} 개\n\n`)
  }
  return reportDiagnostics(parsed, workspace.diagnostics)
}

function commandIndex(parsed: Parsed): number {
  const { workspace, stats } = openIndex(parsed)
  const out = flag(parsed, 'out') ?? '.dockit/out'

  // 문서 기록이 첫 항목이다. 트리를 파싱하지 않고 머리말을 얻는다.
  for (const entry of workspace.entries) {
    const head = entry.records[0]
    write(
      join(out, 'documents', `${entry.id}.json`),
      `${JSON.stringify(
        {
          id: entry.id,
          type: head?.documentType ?? null,
          path: head?.path ?? null,
          records: entry.records,
        },
        null,
        2,
      )}\n`,
    )
  }
  const inverted = (index: ReadonlyMap<string, readonly string[]>) =>
    Object.fromEntries([...index].sort(([a], [b]) => a.localeCompare(b)))

  write(
    join(out, 'index.json'),
    `${JSON.stringify(
      {
        documents: workspace.documentIds,
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

  process.stdout.write(
    `${out} 에 문서 ${workspace.entries.length} 개와 인덱스를 썼습니다 ` +
      `(캐시 ${stats.cached} · 파싱 ${stats.parsed})\n`,
  )
  return hasError(workspace.diagnostics) ? 1 : 0
}

/* ── 객체 저장소 ─────────────────────────────────────────────────────── */

function openIndex(parsed: Parsed, rootDefault = 'rules') {
  const root = parsed.positional[0] ?? rootDefault
  const { schema, origin } = resolveSchema(root, flag(parsed, 'schema'))
  const store = flag(parsed, 'store')
  const result = indexWorkspace({ root, schema, ...(store === undefined ? {} : { store }) })
  return { ...result, directory: root, origin }
}

function commandStore(parsed: Parsed): number {
  const result = openIndex(parsed)
  const { stats } = result

  if (hasFlag(parsed, 'json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          snapshot: result.snapshot,
          parent: result.parent,
          root: result.root,
          stats: { ...stats, total: result.store.count() },
        },
        null,
        2,
      )}\n`,
    )
    return hasError(result.workspace.diagnostics) ? 1 : 0
  }

  const unchanged = result.snapshot !== null && result.snapshot === result.parent
  process.stdout.write(
    `스냅샷  ${result.snapshot?.slice(0, 12) ?? '(쓰지 않음)'}${unchanged ? ' (내용 그대로)' : ''}\n` +
      `뿌리    ${result.root.slice(0, 12)}\n\n` +
      `문서    ${stats.documents} 개 — 캐시 ${stats.cached} · 파싱 ${stats.parsed}\n` +
      `파일    읽지 않음 ${stats.files.hits} · 읽음 ${stats.files.misses}\n` +
      `객체    새로 ${stats.objects.written} · 이미 있어서 건너뜀 ${stats.objects.reused}\n` +
      `저장소  객체 ${result.store.count()} 개\n`,
  )
  return hasError(result.workspace.diagnostics) ? 1 : 0
}

function commandLog(parsed: Parsed): number {
  const store = openStore(flag(parsed, 'store'), parsed.positional[0] ?? 'rules')
  const history = [...store.history()]

  if (hasFlag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify(history, null, 2)}\n`)
    return 0
  }
  if (history.length === 0) {
    process.stdout.write('이력이 없습니다. `dockit store` 를 먼저 돌리세요\n')
    return 0
  }
  for (const { id, snapshot } of history) {
    const meta = (snapshot.meta ?? {}) as { at?: string; documents?: number }
    process.stdout.write(
      `${id.slice(0, 12)}  ${meta.at ?? '(시각 없음)'}  문서 ${meta.documents ?? '?'} 개` +
        `  뿌리 ${snapshot.root.slice(0, 12)}\n`,
    )
  }
  process.stdout.write(`\n스냅샷 ${history.length} 개\n`)
  return 0
}

function commandInit(parsed: Parsed): number {
  const root = parsed.positional[0] ?? 'rules'
  const retentionFlag = flag(parsed, 'retention') ?? 'head'
  if (retentionFlag !== 'head' && retentionFlag !== 'all') {
    process.stderr.write(`--retention 은 head 또는 all 입니다: ${retentionFlag}\n`)
    return 2
  }
  const retention: Retention = retentionFlag
  const preset = flag(parsed, 'preset') ?? 'preset/principle'

  // 설정 파일은 루트 바로 위에 둔다 — 규약을 찾는 순서와 같다.
  const base = join(root, '..')
  const schemaPath = join(base, DEFAULT_SCHEMA_PATH)
  const configPath = join(base, STORE_CONFIG_PATH)
  const force = hasFlag(parsed, 'force')

  const existing = [schemaPath, configPath].filter((path) => existsSync(path))
  if (existing.length > 0 && !force) {
    process.stderr.write(`이미 있습니다: ${existing.join(' · ')}\n덮어쓰려면 --force 를 주세요\n`)
    return 1
  }

  write(schemaPath, `# doc-kit 저작 규약.\nversion: 1\nextends: ${preset}\n`)
  write(configPath, storeConfigText(retention))

  process.stdout.write(
    `${schemaPath} 를 썼습니다 (${preset})\n${configPath} 를 썼습니다 (retention: ${retention})\n`,
  )
  if (retention === 'all') {
    process.stdout.write('\n이력을 전부 보존합니다 — `dockit gc` 는 돌지 않습니다\n')
  } else {
    process.stdout.write(
      '\nHEAD 에서 닿는 것만 남깁니다. `dockit gc` 가 나머지를 거두고,\n' +
        '지운 이력은 기록하지 않습니다 — 되돌릴 수 없습니다\n',
    )
  }
  return 0
}

function commandGc(parsed: Parsed): number {
  const root = parsed.positional[0] ?? 'rules'
  const { schema } = resolveSchema(root, flag(parsed, 'schema'))
  const config = loadStoreConfig(root)
  const dryRun = hasFlag(parsed, 'dry-run')

  const result = collectGarbage({
    root,
    schema,
    ...(flag(parsed, 'store') === undefined ? {} : { store: flag(parsed, 'store')! }),
    retention: config.retention,
    dryRun,
  })

  if (hasFlag(parsed, 'json')) {
    process.stdout.write(`${JSON.stringify({ ...result, origin: config.origin }, null, 2)}\n`)
    return 0
  }

  if (result.skipped) {
    process.stdout.write(
      `정책: ${result.retention} (${config.origin})\n\n` +
        '이력을 전부 보존하는 프로젝트입니다. 거두지 않습니다.\n' +
        `바꾸려면 ${STORE_CONFIG_PATH} 의 retention 을 head 로 두세요\n`,
    )
    return 0
  }

  process.stdout.write(
    `정책: ${result.retention} (${config.origin})\n` +
      `뿌리: ${result.roots.map((id) => id.slice(0, 12)).join(' ') || '(HEAD 없음)'}\n\n` +
      `객체    ${result.objects.before} → ${result.objects.kept} (거둠 ${result.objects.removed})\n` +
      `파생    ${result.derived.before} → ${result.derived.kept} (거둠 ${result.derived.removed})\n`,
  )
  if (dryRun) process.stdout.write('\n--dry-run 이므로 지우지 않았습니다\n')
  return 0
}

function commandCat(parsed: Parsed): number {
  const prefix = parsed.positional[0]
  if (prefix === undefined) {
    process.stderr.write('객체 주소를 주세요\n')
    return 2
  }
  const store = openStore(flag(parsed, 'store'), flag(parsed, 'root') ?? 'rules')
  // `log` 와 `store` 는 앞 12 자만 보여 준다. 그것을 그대로 받아야 한다.
  const matches = store.matching(prefix)
  if (matches.length > 1) {
    process.stderr.write(
      `주소가 여럿과 겹칩니다: ${prefix}\n${matches.map((id) => `  ${id}`).join('\n')}\n`,
    )
    return 2
  }
  const id = matches[0]
  const object = id === undefined ? null : store.read(id)
  if (id === undefined || object === null) {
    process.stderr.write(`그런 객체가 없습니다: ${prefix}\n`)
    return 2
  }

  const body =
    object.type === 'blob'
      ? store.blob(id)
      : object.type === 'tree'
        ? store.tree(id)
        : store.snapshot(id)

  if (hasFlag(parsed, 'json') || object.type !== 'blob') {
    process.stdout.write(`${JSON.stringify({ type: object.type, body }, null, 2)}\n`)
    return 0
  }
  process.stdout.write(`${body as string}\n`)
  return 0
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
  const out = flag(parsed, 'out') ?? '.dockit/site'
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
  store: commandStore,
  log: commandLog,
  cat: commandCat,
  gc: commandGc,
  init: commandInit,
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
