import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_AUX, aux, mergeAux, resolveAux, widenedSubjects } from '../../src/model/aux.js'

test('역할은 상속하지 않는다', () => {
  const merged = mergeAux(aux({ role: 'norm' }), aux())
  assert.equal(merged.role, undefined)
  assert.equal(mergeAux(aux({ role: 'norm' }), aux({ role: 'example' })).role, 'example')
})

test('대상은 좁아지기만 한다', () => {
  const parent = aux({ subject: ['domain', 'app'] })
  assert.deepEqual(mergeAux(parent, aux({ subject: ['domain'] })).subject, ['domain'])
  // 조상 밖의 대상은 병합에서 사라진다
  assert.deepEqual(mergeAux(parent, aux({ subject: ['infra'] })).subject, [])
  assert.deepEqual(mergeAux(parent, aux({ subject: ['domain', 'infra'] })).subject, ['domain'])
})

test('조상이 대상을 선언하지 않았으면 제약이 없다', () => {
  assert.deepEqual(mergeAux(aux(), aux({ subject: ['infra'] })).subject, ['infra'])
  assert.deepEqual(mergeAux(aux({ subject: ['domain'] }), aux()).subject, ['domain'])
})

test('주제는 합집합이고 중복을 지운다', () => {
  const merged = mergeAux(aux({ topic: ['validation'] }), aux({ topic: ['invariant', 'validation'] }))
  assert.deepEqual(merged.topic, ['validation', 'invariant'])
})

test('수명주기는 선언된 항목만 덮어쓴다', () => {
  const merged = mergeAux(
    aux({ lifecycle: { status: 'active', since: '2026-01-01', level: 'must' } }),
    aux({ lifecycle: { status: 'deprecated' } }),
  )
  assert.deepEqual(merged.lifecycle, {
    status: 'deprecated',
    since: '2026-01-01',
    level: 'must',
  })
})

test('관계 링크는 선언한 노드에만 붙는다', () => {
  const parent = aux({ relations: [{ kind: 'refines', target: 'a/b#c' }] })
  assert.deepEqual(mergeAux(parent, aux()).relations, [])
})

test('빈 체인은 빈 보조데이터로 해석된다', () => {
  assert.deepEqual(resolveAux([]), EMPTY_AUX)
})

test('체인 전체가 순서대로 병합된다', () => {
  const resolved = resolveAux([
    aux({ subject: ['domain', 'app'], topic: ['validation'] }),
    aux({ subject: ['domain'], lifecycle: { status: 'active' } }),
    aux({ role: 'norm', topic: ['invariant'] }),
  ])
  assert.equal(resolved.role, 'norm')
  assert.deepEqual(resolved.subject, ['domain'])
  assert.deepEqual(resolved.topic, ['validation', 'invariant'])
  assert.deepEqual(resolved.lifecycle, { status: 'active' })
})

test('넓히려 한 대상을 사실대로 돌려준다', () => {
  const parent = aux({ subject: ['domain'] })
  assert.deepEqual(widenedSubjects(parent, aux({ subject: ['domain', 'infra'] })), ['infra'])
  assert.deepEqual(widenedSubjects(parent, aux({ subject: ['domain'] })), [])
  assert.deepEqual(widenedSubjects(aux(), aux({ subject: ['infra'] })), [])
})
