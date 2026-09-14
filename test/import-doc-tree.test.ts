import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { collectRules } from '../src/collect.js'
import { importDocTree } from '../src/import-doc-tree.js'
import { buildIndex } from '../src/index-build.js'
import { validateRuleSet } from '../src/validate.js'

const PARENT = `# 네이밍 컨벤션

**상태**: 정본

**작성일**: 2026-08-13

## 적용 범위

- 공개 API 이름에 적용합니다.
`

const CHILD = `# 축약과 약어

[네이밍 컨벤션](../naming.md)의 규칙 문서입니다.

- 표준 약어만 사용합니다.
- 약어는 전부 대문자로 씁니다. 자세한 것은 [아키텍처](../../architecture.md)를 보세요.

한 파일 안에서만 통하는 축약은 공개 API 의 근거가 되지 않습니다.
`

const CODE_FIRST = `# 소스 루트

[네이밍 컨벤션](../naming.md)의 규칙 문서입니다.

\`\`\`text
sources/<패키지>/
\`\`\`

소스 루트는 패키지 이름을 첫 세그먼트로 가집니다.
`

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rulekit-dt-'))
  const docs = path.join(root, 'docs')
  await fs.mkdir(path.join(docs, 'conventions', 'naming'), { recursive: true })
  await fs.writeFile(path.join(docs, 'architecture.md'), '# 아키텍처\n')
  await fs.writeFile(path.join(docs, 'conventions', 'naming.md'), PARENT)
  await fs.writeFile(
    path.join(docs, 'conventions', 'naming', 'abbreviation.md'),
    CHILD,
  )
  await fs.writeFile(
    path.join(docs, 'conventions', 'naming', 'source-root.md'),
    CODE_FIRST,
  )

  const registry = path.join(root, 'documents.tsv')
  await fs.writeFile(
    registry,
    [
      'doc_id\tpath\tkind\ttopic\ttitle\tsummary',
      'naming\tdocs/conventions/naming.md\tindex\tnaming\t네이밍 컨벤션\t이름 규칙',
      'naming.abbreviation\tdocs/conventions/naming/abbreviation.md\trule\tnaming\t축약과 약어\t[표준](../x.md) 약어만',
      'naming.source-root\tdocs/conventions/naming/source-root.md\trule\tnaming\t소스 루트\t소스 루트 규칙',
    ].join('\n'),
  )
  const scopes = path.join(root, 'scopes.tsv')
  await fs.writeFile(
    scopes,
    ['doc_id\tpackage\tshape', 'naming.abbreviation\tDomain\t*'].join('\n'),
  )

  const out = path.join(root, 'rules')
  const report = await importDocTree({
    source: docs,
    out,
    registry,
    scopes,
    repoRoot: root,
    kinds: ['rule'],
  })
  return { root, docs, out, report }
}

test('레지스트리의 kind 로 규칙 문서만 고른다', async () => {
  const { report } = await fixture()
  assert.deepEqual(report.rules.map((r) => r.id).sort(), [
    'naming-abbreviation',
    'naming-source-root',
  ])
})

test('메타 줄을 status·since 로 환원하고 본문에서 뺀다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-abbreviation')!
  assert.equal(rule.status, 'active')
  assert.ok(!rule.sections.some((s) => s.body.includes('**상태**')))
})

test('부모 안내 문장을 extends 로 환원한다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-abbreviation')!
  // 부모(naming)는 index 라 수입되지 않았으므로 참고 문헌으로 내려간다.
  assert.deepEqual(rule.extends, [])
  assert.ok(rule.externalRefs.some((r) => r.target.includes('naming.md')))
})

test('마지막 목록까지가 규범, 그 뒤 산문이 근거다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-abbreviation')!
  const rules = rule.sections.find((s) => s.key === 'rule')!.body
  const why = rule.sections.find((s) => s.key === 'why')!.body
  assert.match(rules, /표준 약어만 사용합니다/)
  assert.match(why, /한 파일 안에서만/)
})

test('코드로 시작하는 문서도 규범 진술을 찾는다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-source-root')!
  assert.match(rule.sections.find((s) => s.key === 'rule')!.body, /첫 세그먼트/)
  assert.match(rule.sections.find((s) => s.key === 'examples')!.body, /```text/)
})

test('요약은 링크 표기를 걷어낸 평문 한 줄이다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-abbreviation')!
  assert.equal(rule.summary, '표준 약어만')
})

test('적용 범위를 스코프 TSV 에서 가져오고 * 는 버린다', async () => {
  const { report } = await fixture()
  const rule = report.rules.find((r) => r.id === 'naming-abbreviation')!
  assert.deepEqual(rule.scope, { package: ['Domain'] })
})

test('생성된 트리의 모든 상대 링크가 해석된다', async () => {
  const { out } = await fixture()
  const files = await fs.readdir(out, { recursive: true, withFileTypes: true })
  const targets: string[] = []
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = path.join(entry.parentPath, entry.name)
    const body = await fs.readFile(file, 'utf8')
    for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s#]+)[^)]*\)/g)) {
      targets.push(path.resolve(path.dirname(file), m[1]!))
    }
  }
  assert.ok(targets.length > 0)
  for (const target of targets) {
    assert.ok(
      await fs.stat(target).then(() => true, () => false),
      `깨진 링크: ${target}`,
    )
  }
})

test('적용 범위가 인덱스의 역인덱스로 들어간다', async () => {
  const { out } = await fixture()
  const set = validateRuleSet(await collectRules(out))
  const index = buildIndex(set)
  assert.deepEqual(index.byScope.package?.Domain, ['naming-abbreviation'])
  assert.equal(set.files.flatMap((f) => f.messages.filter((m) => m.fatal)).length, 0)
})
