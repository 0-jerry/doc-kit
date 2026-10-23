/** `dockit diff` 의 인수·출력·종료 코드. 비교 자체는 test/workspace/diff.test.ts 가 본다. */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../../src/cli/main.js'

const doc = (norm: string) =>
  `---\ntype: principle\nid: x\nsubject: [domain]\n---\n\n## 기준\n\n${norm}\n\n## 근거\n\n근거.\n`

/** 스냅샷 둘이 쌓인 프로젝트. 앞 스냅샷의 주소를 돌려준다. */
function project(): { root: string; first: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'dockit-diff-cli-'))
  const root = join(base, 'rules')
  mkdirSync(join(root, 'principle'), { recursive: true })
  mkdirSync(join(base, '.dockit'))
  writeFileSync(join(base, '.dockit', 'schema.yaml'), 'version: 1\nextends: preset/principle\n')

  writeFileSync(join(root, 'principle', 'x.md'), doc('진술.'))
  const first = capture(['store', root, '--json']).json.snapshot as string
  writeFileSync(join(root, 'principle', 'x.md'), doc('고친 진술.'))
  capture(['store', root])
  return { root, first, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

function capture(argv: readonly string[]): { code: number; text: string; json: any } {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  let code: number
  try {
    code = run(argv)
  } finally {
    process.stdout.write = original
  }
  const text = chunks.join('')
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // 사람이 읽는 출력
  }
  return { code, text, json }
}

test('R15.1 — <뒤> 를 생략하면 HEAD 와 비교한다', () => {
  const { root, first, cleanup } = project()
  try {
    const { code, text } = capture(['diff', first.slice(0, 12), '--root', root])
    assert.equal(code, 0)
    assert.match(text, /\(HEAD\)/)
    assert.match(text, /바뀜 {4}principle\/x#norm\/0 {2}본문/)
    assert.match(text, /1 개/)
  } finally {
    cleanup()
  }
})

test('R15.11 — --json 은 같은 변경을 담고, 실패는 { error } 다', () => {
  const { root, first, cleanup } = project()
  try {
    const { json } = capture(['diff', first, '--root', root, '--json'])
    assert.equal(json.from, first)
    assert.deepEqual(json.changes, [
      { kind: 'modified', address: 'principle/x#norm/0', changed: ['body'] },
    ])

    const failed = capture(['diff', 'ffff0000', '--root', root, '--json'])
    assert.equal(failed.code, 2)
    assert.match(failed.json.error, /그런 스냅샷이 없습니다/)
  } finally {
    cleanup()
  }
})

test('R15.13 — --patch 면 사람용 출력에도 줄 차이가 붙는다', () => {
  const { root, first, cleanup } = project()
  try {
    const { text } = capture(['diff', first, '--root', root, '--patch'])
    assert.match(text, / {8}- 진술\.\n {8}\+ 고친 진술\./)
  } finally {
    cleanup()
  }
})

test('R15.14 — 차이가 있어도 0, --exit-code 면 1, 실패는 2', () => {
  const { root, first, cleanup } = project()
  try {
    assert.equal(capture(['diff', first, '--root', root]).code, 0)
    assert.equal(capture(['diff', first, '--root', root, '--exit-code']).code, 1)
    assert.equal(capture(['diff', first, first, '--root', root, '--exit-code']).code, 0)
    assert.equal(capture(['diff', '--root', root]).code, 2)
  } finally {
    cleanup()
  }
})
