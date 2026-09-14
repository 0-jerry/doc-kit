import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset, loadSchema } from '../../src/schema/index.js'
import { validateDocument } from '../../src/validate/index.js'
import { countSentences } from '../../src/validate/checks/structure.js'

const schema = loadPreset('preset/principle')

function check(body: string, options: { name?: string; schemaOverride?: typeof schema } = {}) {
  const name = options.name ?? 'sample'
  const active = options.schemaOverride ?? schema
  const { document } = parseDocument(body, {
    schema: active,
    path: `principle/${name}.md`,
    collection: 'principle',
    name,
  })
  assert.notEqual(document, null)
  return validateDocument(document!, active).map((item) => item.code)
}

const HEAD = '---\ntype: principle\nid: sample\n---\n\n'
const VALID = `${HEAD}## 기준\n\n진술이다.\n\n## 근거\n\n그래서 그렇다.\n`

test('규약을 지킨 문서는 진단이 없다', () => {
  assert.deepEqual(check(VALID), [])
})

test('SCH002 — 필수 섹션이 없으면 오류', () => {
  assert.ok(check(`${HEAD}## 기준\n\n진술이다.\n`).includes('SCH002'))
})

test('SCH003 — 섹션 순서가 뒤집히면 오류', () => {
  assert.ok(check(`${HEAD}## 근거\n\n설명.\n\n## 기준\n\n진술.\n`).includes('SCH003'))
})

test('SCH004 — 반복할 수 없는 섹션이 거듭되면 오류', () => {
  assert.ok(check(`${VALID}\n## 근거\n\n또 설명.\n`).includes('SCH004'))
})

test('SCH001 — 규약에 없는 섹션은 오류', () => {
  assert.ok(check(`${VALID}\n## 딴소리\n\n문단.\n`).includes('SCH001'))
})

test('SCH005 — 규약에 없는 역할은 오류', () => {
  assert.ok(check(`${VALID}\n<!-- rk: role=없는역할 -->\n문단.\n`).includes('SCH005'))
})

test('SCH007 — 역할이 요구하는 형태가 아니면 오류', () => {
  // norm 은 paragraph·list 만 쓸 수 있다
  assert.ok(check(`${HEAD}## 기준\n\n\`\`\`ts\ncode\n\`\`\`\n\n## 근거\n\n설명.\n`).includes('SCH007'))
})

test('SCH009 — 파일 이름과 식별자가 다르면 오류', () => {
  assert.ok(check(VALID, { name: '다른이름' }).includes('SCH009'))
})

test('STR001 — 규범 진술이 길면 경고', () => {
  const long = '하나다. 둘이다. 셋이다. 넷이다.'
  assert.ok(check(`${HEAD}## 기준\n\n${long}\n\n## 근거\n\n설명.\n`).includes('STR001'))
})

test('STR002 — 섹션 블록 수 상한을 넘으면 오류', () => {
  const blocks = ['하나.', '둘.', '셋.', '넷.'].join('\n\n')
  assert.ok(check(`${HEAD}## 기준\n\n${blocks}\n\n## 근거\n\n설명.\n`).includes('STR002'))
})

test('STR003 — 깊이 상한을 넘으면 오류', () => {
  const deep = `${HEAD}## 기준\n\n진술.\n\n### 더 좁게\n\n문단.\n\n#### 더더 좁게\n\n문단.\n\n## 근거\n\n설명.\n`
  assert.ok(check(deep).includes('STR003'))
})

test('STR004 — 형제가 임계값을 넘으면 경고', () => {
  const many = Array.from({ length: 11 }, (_, index) => `문단 ${index}.`).join('\n\n')
  assert.ok(check(`${HEAD}## 기준\n\n진술.\n\n## 근거\n\n${many}\n`).includes('STR004'))
})

test('AUX001 — 자손이 조상보다 넓은 대상을 주장하면 오류', () => {
  const body = `---\ntype: principle\nid: sample\nsubject: [domain]\n---\n\n## 기준\n\n<!-- rk: subject=[infra] -->\n진술.\n\n## 근거\n\n설명.\n`
  assert.ok(check(body).includes('AUX001'))
})

test('AUX002 — 닫힌 어휘 밖의 값은 오류', () => {
  const body = `---\ntype: principle\nid: sample\nstatus: 아무거나\n---\n\n${VALID.slice(HEAD.length)}`
  assert.ok(check(body).includes('AUX002'))
})

test('AUX003 — 자손이 조상보다 강하면 오류', () => {
  const body = `---\ntype: principle\nid: sample\nstatus: deprecated\n---\n\n## 기준\n\n<!-- rk: status=active -->\n진술.\n\n## 근거\n\n설명.\n`
  assert.ok(check(body).includes('AUX003'))
})

test('AUX004 — 안정 식별자 중복과 섹션 키 충돌은 오류', () => {
  const duplicated = `${HEAD}## 기준\n\n<!-- rk: id=core -->\n진술.\n\n## 근거\n\n<!-- rk: id=core -->\n설명.\n`
  assert.ok(check(duplicated).includes('AUX004'))
  const clashing = `${HEAD}## 기준\n\n<!-- rk: id=rationale -->\n진술.\n\n## 근거\n\n설명.\n`
  assert.ok(check(clashing).includes('AUX004'))
})

test('AUX005 — 관계 대상이 주소 형식이 아니면 오류', () => {
  const body = `---\ntype: principle\nid: sample\nrefines: 그냥이름\n---\n\n${VALID.slice(HEAD.length)}`
  assert.ok(check(body).includes('AUX005'))
})

test('SCH006 — 섹션이 허용하지 않은 역할은 오류', () => {
  const restricted = loadSchema({
    version: 1,
    extends: 'preset/principle',
    documentTypes: {
      principle: {
        sections: [
          { key: 'norm', heading: '기준', required: true, defaultRole: 'norm', allowedRoles: ['norm'] },
          { key: 'rationale', heading: '근거', required: true, defaultRole: 'rationale' },
        ],
      },
    },
  })
  const body = `${HEAD}## 기준\n\n<!-- rk: role=note -->\n진술.\n\n## 근거\n\n설명.\n`
  assert.ok(check(body, { schemaOverride: restricted }).includes('SCH006'))
})

test('문장 수는 마침표류로 센다', () => {
  assert.equal(countSentences('하나다.'), 1)
  assert.equal(countSentences('하나다. 둘이다!'), 2)
  assert.equal(countSentences('마침표 없음'), 1)
  assert.equal(countSentences('   '), 0)
})

test('SCH002 — 중첩된 필수 섹션도 검사한다', () => {
  const nested = loadSchema({
    version: 1,
    extends: 'preset/principle',
    documentTypes: {
      principle: {
        maxDepth: 4,
        sections: [
          {
            key: 'norm',
            heading: '기준',
            required: true,
            defaultRole: 'norm',
            sections: [{ key: 'detail', heading: '세부', required: true }],
          },
          { key: 'rationale', heading: '근거', required: true, defaultRole: 'rationale' },
        ],
      },
    },
  })
  const without = `${HEAD}## 기준\n\n진술.\n\n## 근거\n\n설명.\n`
  assert.ok(check(without, { schemaOverride: nested }).includes('SCH002'))

  const with_ = `${HEAD}## 기준\n\n진술.\n\n### 세부\n\n문단.\n\n## 근거\n\n설명.\n`
  assert.ok(!check(with_, { schemaOverride: nested }).includes('SCH002'))
})

test('STR004 — 문서 직속 자식도 형제 상한을 본다', () => {
  const many = Array.from({ length: 12 }, (_, index) => `떠도는 문단 ${index}.`).join('\n\n')
  assert.ok(check(`${HEAD}${many}\n\n## 기준\n\n진술.\n\n## 근거\n\n설명.\n`).includes('STR004'))
})
