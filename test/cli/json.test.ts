/** 파일을 쓰는 명령도 `--json` 을 받아, 무엇을 썼는지 기계가 읽을 수 있게 낸다. */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../../src/cli/main.js'

const SAMPLE = `---
type: principle
id: 불변식
subject: [domain]
---

## 기준

<!-- dk: id=core -->
불변식은 생성자에서 검증한다.

## 근거

유효하지 않은 상태가 존재할 수 없게 된다.
`

/**
 * 임시 프로젝트. 규약 파일을 두지 않으면 작업 디렉터리의 규약을 집어 오므로,
 * `init` 을 시험할 때가 아니면 프리셋만 잇는 규약을 둔다.
 */
function project(options: { schema?: boolean } = {}): { base: string; root: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'dockit-json-'))
  const root = join(base, 'rules')
  mkdirSync(join(root, 'principle'), { recursive: true })
  writeFileSync(join(root, 'principle', '불변식.md'), SAMPLE, 'utf8')
  if (options.schema ?? true) {
    mkdirSync(join(base, '.dockit'), { recursive: true })
    writeFileSync(join(base, '.dockit', 'schema.yaml'), 'version: 1\nextends: preset/principle\n', 'utf8')
  }
  return { base, root, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

/** `run` 을 돌리고 표준 출력을 JSON 으로 읽는다. */
function runJson(argv: readonly string[]): { code: number; output: any } {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  let code: number
  try {
    code = run([...argv, '--json'])
  } finally {
    process.stdout.write = original
  }
  return { code, output: JSON.parse(chunks.join('')) }
}

test('index --json 은 쓴 파일과 통계, 진단을 낸다', () => {
  const { base, root, cleanup } = project()
  try {
    const out = join(base, 'out')
    const { code, output } = runJson(['index', root, '--out', out, '--store', join(base, 'store')])
    assert.equal(code, 0)
    assert.equal(output.documents, 1)
    assert.deepEqual(output.diagnostics, [])
    assert.ok(output.written.includes(join(out, 'index.json')))
    assert.ok(output.written.every((path: string) => existsSync(path)))
    assert.equal(output.stats.parsed + output.stats.cached, 1)
  } finally {
    cleanup()
  }
})

test('render --json 은 쓴 파일을 낸다', () => {
  const { base, root, cleanup } = project()
  try {
    const out = join(base, 'site')
    const { code, output } = runJson(['render', root, '--out', out])
    assert.equal(code, 0)
    assert.equal(output.out, out)
    assert.ok(output.written.includes(join(out, 'index.html')))
    assert.ok(output.written.every((path: string) => existsSync(path)))
  } finally {
    cleanup()
  }
})

test('split --json --dry-run 은 쓰지 않고 파일 내용을 낸다', () => {
  const { root, cleanup } = project()
  try {
    const { code, output } = runJson(['split', root, '--document', 'principle/불변식', '--dry-run'])
    assert.equal(code, 0)
    assert.equal(output.dryRun, true)
    assert.deepEqual(output.written, [])
    assert.ok(output.files.length > 1)
    assert.ok(!existsSync(join(root, 'principle', '불변식', 'node.md')))
  } finally {
    cleanup()
  }
})

test('split --json 은 원본이 남으면 실패로 알리고, --replace 면 지운 것을 낸다', () => {
  const { root, cleanup } = project()
  try {
    const original = join(root, 'principle', '불변식.md')
    const left = runJson(['split', root, '--document', 'principle/불변식'])
    assert.equal(left.code, 1)
    assert.deepEqual(left.output.original, { path: original, removed: false })
    assert.ok(left.output.written.every((path: string) => existsSync(path)))
    assert.ok(existsSync(original))

    const replaced = runJson(['split', root, '--document', 'principle/불변식', '--replace'])
    assert.equal(replaced.code, 0)
    assert.deepEqual(replaced.output.original, { path: original, removed: true })
    assert.ok(!existsSync(original))
  } finally {
    cleanup()
  }
})

test('assemble --json 은 합친 원문을 담고, --out 이면 쓴 경로도 낸다', () => {
  const { base, root, cleanup } = project()
  try {
    const printed = runJson(['assemble', root, '--document', 'principle/불변식'])
    assert.equal(printed.code, 0)
    assert.equal(printed.output.content, SAMPLE)
    assert.deepEqual(printed.output.written, [])

    const out = join(base, 'assembled.md')
    const written = runJson(['assemble', root, '--document', 'principle/불변식', '--out', out])
    assert.deepEqual(written.output.written, [out])
    assert.equal(readFileSync(out, 'utf8'), SAMPLE)
  } finally {
    cleanup()
  }
})

test('init --json 은 쓴 설정 파일과 정책을 낸다', () => {
  const { base, root, cleanup } = project({ schema: false })
  try {
    const { code, output } = runJson(['init', root, '--retention', 'all'])
    assert.equal(code, 0)
    assert.equal(output.retention, 'all')
    assert.equal(output.preset, 'preset/principle')
    assert.equal(output.written.length, 2)
    assert.ok(output.written.every((path: string) => existsSync(path) && path.startsWith(base)))
  } finally {
    cleanup()
  }
})
