import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  effectiveAux,
  formatFragment,
  indexStep,
  parseFragment,
  pathFragment,
  sectionStep,
  stableFragment,
  aux,
} from '../../src/model/index.js'
import { block, document, section } from '../helpers.js'

function sample() {
  return document([
    section('norm', [block('불변식은 생성자에서 검증한다', { stableId: 'core' })]),
    section('rationale', [
      block('유효하지 않은 상태가 존재할 수 없다'),
      section('detail', [block('중첩된 섹션')], {}),
    ]),
    section('norm', [block('두 번째 같은 키')]),
  ])
}

test('순회는 깊이 우선이고 각 노드의 위치 주소를 붙인다', () => {
  const paths = [...sample().walk()].map((visit) => formatFragment(pathFragment(visit.path)))
  assert.deepEqual(paths, [
    'norm',
    'norm/0',
    'rationale',
    'rationale/0',
    'rationale/detail',
    'rationale/detail/0',
    'norm~2',
    'norm~2/0',
  ])
})

test('같은 키의 섹션은 물결 접미사로 가린다', () => {
  const doc = sample()
  const first = doc.resolve(parseFragment('norm/0')!)
  const second = doc.resolve(parseFragment('norm~2/0')!)
  assert.equal(first?.node.kind === 'block' && first.node.text, '불변식은 생성자에서 검증한다')
  assert.equal(second?.node.kind === 'block' && second.node.text, '두 번째 같은 키')
})

test('안정 식별자로 노드를 찾는다', () => {
  const found = sample().resolve(stableFragment('core'))
  assert.equal(found?.node.stableId, 'core')
  assert.deepEqual(found?.path, [sectionStep('norm'), indexStep(0)])
})

test('안정 식별자가 없으면 섹션 키로 한 번 더 시도한다', () => {
  const found = sample().resolve(stableFragment('rationale'))
  assert.equal(found?.node.kind, 'section')
  assert.equal(found?.node.kind === 'section' && found.node.key, 'rationale')
})

test('없는 주소는 null 이다', () => {
  const doc = sample()
  assert.equal(doc.resolve(stableFragment('없음')), null)
  assert.equal(doc.resolve(parseFragment('norm/9')!), null)
  assert.equal(doc.resolve(parseFragment('norm~7/0')!), null)
})

test('리프를 지나 더 내려가는 주소는 거부한다', () => {
  assert.equal(sample().resolve(parseFragment('norm/0/0')!), null)
})

test('조상 체인은 문서부터 직계 부모까지다', () => {
  const found = sample().resolve(parseFragment('rationale/detail/0')!)
  assert.deepEqual(
    found?.ancestors.map((node) => (node.kind === 'document' ? 'document' : node.key)),
    ['document', 'rationale', 'detail'],
  )
})

test('보조데이터는 조상에서 자손으로 흐른다', () => {
  const doc = document(
    [
      section('norm', [block('진술', { aux: aux({ role: 'norm', subject: ['domain'] }) })], {
        aux: aux({ subject: ['domain', 'app'], topic: ['invariant'] }),
      }),
    ],
    { aux: aux({ subject: ['domain', 'app', 'infra'], lifecycle: { status: 'active' } }) },
  )
  const found = doc.resolve(parseFragment('norm/0')!)
  const resolved = effectiveAux(found!)
  assert.equal(resolved.role, 'norm')
  assert.deepEqual(resolved.subject, ['domain'])
  assert.deepEqual(resolved.topic, ['invariant'])
  assert.deepEqual(resolved.lifecycle, { status: 'active' })
})

test('with 은 원본을 바꾸지 않는다', () => {
  const doc = sample()
  const changed = doc.with({ children: [] })
  assert.equal(doc.children.length, 3)
  assert.equal(changed.children.length, 0)
  assert.equal(changed.id, doc.id)
  assert.notEqual(changed, doc)
})

test('인덱스 걸음으로 찾은 섹션은 키 주소로 정규화된다', () => {
  const found = sample().resolve(pathFragment([indexStep(2)]))
  assert.deepEqual(found?.path, [sectionStep('norm', 2)])
})

test('숫자 조각은 형제 인덱스로 해석한다', () => {
  const found = sample().resolve(parseFragment('2')!)
  assert.equal(found?.node.kind, 'section')
  assert.deepEqual(found?.path, [sectionStep('norm', 2)])
})

test('문서 자신의 주소에는 조각이 붙지 않는다', () => {
  assert.equal(sample().address([]).fragment, null)
})
