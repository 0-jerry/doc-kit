import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PRESET_NAMES,
  SchemaError,
  loadPreset,
  loadSchema,
  mergeDeclarations,
} from '../../src/schema/index.js'

test('프리셋 셋을 모두 읽을 수 있다', () => {
  for (const name of PRESET_NAMES) {
    const schema = loadPreset(name)
    assert.ok(schema.documentTypeNames.length > 0, name)
  }
})

test('원칙 프리셋은 섹션과 역할을 규약으로 답한다', () => {
  const schema = loadPreset('preset/principle')
  assert.equal(schema.typeForCollection('principle'), 'principle')
  assert.deepEqual(
    schema.sectionsOf('principle').map((spec) => spec.key),
    ['norm', 'rationale', 'example', 'exception'],
  )
  assert.deepEqual(schema.sectionPathForHeading('principle', '기준'), ['norm'])
  assert.deepEqual(schema.sectionPathForHeading('principle', '  근거 '), ['rationale'])
  assert.equal(schema.sectionPathForHeading('principle', '없는 제목'), null)
  assert.equal(schema.defaultRoleAt('principle', ['norm']), 'norm')
  assert.equal(schema.sectionAt('principle', ['norm'])?.maxBlocks, 3)
  assert.equal(schema.role('norm')?.maxSentences, 3)
})

test('상속은 기반을 먼저 깔고 자식이 덮는다', () => {
  const schema = loadPreset('preset/convention')
  // 기반의 문서 타입과 역할을 그대로 갖는다
  assert.ok(schema.documentType('principle'))
  assert.equal(schema.role('norm')?.maxSentences, 3)
  // 자신의 타입도 갖는다
  assert.deepEqual(
    schema.sectionsOf('convention').map((spec) => spec.key),
    ['rule', 'rationale', 'example', 'counter-example', 'exception'],
  )
  assert.equal(schema.typeForCollection('convention'), 'convention')
  assert.equal(schema.typeForCollection('principle'), 'principle')
})

test('같은 이름의 문서 타입은 자식이 통째로 이긴다', () => {
  const schema = loadSchema({
    version: 1,
    extends: 'preset/principle',
    documentTypes: {
      principle: {
        sections: [{ key: 'norm', heading: '기준', required: true }],
      },
    },
  })
  assert.deepEqual(
    schema.sectionsOf('principle').map((spec) => spec.key),
    ['norm'],
  )
})

test('닫힌 어휘와 순서 있는 어휘에 답한다', () => {
  const schema = loadPreset('preset/principle')
  assert.equal(schema.allowsValue('status', 'active'), true)
  assert.equal(schema.allowsValue('status', '아무거나'), false)
  assert.equal(schema.allowsValue('topic', '아무거나'), true)
  assert.equal(schema.rankOf('level', 'must'), 0)
  assert.equal(schema.rankOf('level', 'may'), 2)
  assert.equal(schema.rankOf('topic', '아무거나'), null)
  assert.equal(schema.rankOf('level', '없는값'), null)
})

test('숫자로만 된 섹션 키는 선언에서 거부한다', () => {
  assert.throws(
    () =>
      loadSchema({
        version: 1,
        documentTypes: { t: { sections: [{ key: '2', heading: '둘' }] } },
      }),
    SchemaError,
  )
})

test('규약에 없는 항목은 거부한다', () => {
  assert.throws(
    () => loadSchema({ version: 1, unknownTop: {} }),
    SchemaError,
  )
  assert.throws(
    () =>
      loadSchema({
        version: 1,
        documentTypes: { t: { sections: [{ key: 'a', heading: 'A', typo: true }] } },
      }),
    SchemaError,
  )
})

test('찾을 수 없는 상속과 순환 상속을 구분해 보고한다', () => {
  assert.throws(
    () => loadSchema({ version: 1, extends: 'preset/없음' }),
    /상속할 선언을 찾을 수 없습니다/,
  )
  const cyclic: Record<string, { id: string; raw: Record<string, unknown> }> = {
    a: { id: 'A', raw: { version: 1, extends: 'b' } },
    b: { id: 'B', raw: { version: 1, extends: 'a' } },
  }
  assert.throws(
    () => loadSchema({ version: 1, extends: 'a' }, { resolveBase: (ref) => cyclic[ref] ?? null }),
    /순환합니다/,
  )
})

test('같은 선언을 다른 이름으로 가리켜도 순환을 놓치지 않는다', () => {
  // 표준 이름이 같으면 참조 문자열이 달라도 같은 선언이다
  const aliased: Record<string, { id: string; raw: Record<string, unknown> }> = {
    './b.yaml': { id: '/root/b.yaml', raw: { version: 1, extends: '../root/b.yaml' } },
    '../root/b.yaml': { id: '/root/b.yaml', raw: { version: 1, extends: './b.yaml' } },
  }
  assert.throws(
    () =>
      loadSchema({ version: 1, extends: './b.yaml' }, { resolveBase: (ref) => aliased[ref] ?? null }),
    /순환합니다/,
  )
})

test('선언의 키도 주소 문법을 지켜야 한다', () => {
  assert.throws(() => loadSchema({ version: 1, roles: { '잘못 된 키': {} } }), SchemaError)
  assert.throws(() => loadSchema({ version: 1, collections: { 'a#b': 'principle' } }), SchemaError)
})

test('병합은 키 단위 교체이고 limits 는 항목별로 합친다', () => {
  const merged = mergeDeclarations([
    { version: 1, roles: { a: { x: 1 }, b: { y: 2 } }, limits: { maxChildren: 5 } },
    { version: 1, roles: { a: { z: 3 } }, limits: { maxBlocksPerDocument: 10 } },
  ])
  assert.deepEqual(merged['roles'], { a: { z: 3 }, b: { y: 2 } })
  assert.deepEqual(merged['limits'], { maxChildren: 5, maxBlocksPerDocument: 10 })
  assert.equal(merged['extends'], undefined)
})
