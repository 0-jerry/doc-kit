import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatAddress,
  formatDocumentId,
  formatStep,
  fragmentEquals,
  indexStep,
  isSectionKey,
  parseAddress,
  parseDocumentId,
  parseFragment,
  parseStep,
  pathFragment,
  sectionStep,
  stableFragment,
} from '../../src/model/id.js'

test('문서 식별자는 컬렉션과 이름으로 이뤄진다', () => {
  const id = formatDocumentId('principle', '불변식은-생성자에서-검증한다')
  assert.equal(id, 'principle/불변식은-생성자에서-검증한다')
  assert.deepEqual(parseDocumentId(id), {
    collection: 'principle',
    name: '불변식은-생성자에서-검증한다',
  })
})

test('주소 구분자가 섞인 식별자는 거부한다', () => {
  assert.throws(() => formatDocumentId('principle', 'a#b'), RangeError)
  assert.throws(() => formatDocumentId('principle', 'a b'), RangeError)
  assert.equal(parseDocumentId('principle'), null)
  assert.equal(parseDocumentId('/name'), null)
  assert.equal(parseDocumentId('principle/'), null)
})

test('같은 키의 섹션은 물결 접미사로 구분한다', () => {
  assert.equal(formatStep(sectionStep('norm')), 'norm')
  assert.equal(formatStep(sectionStep('norm', 3)), 'norm~3')
  assert.deepEqual(parseStep('norm~3'), sectionStep('norm', 3))
  assert.deepEqual(parseStep('norm'), sectionStep('norm'))
  assert.deepEqual(parseStep('2'), indexStep(2))
  assert.equal(parseStep('norm~0'), null)
  assert.equal(parseStep('norm~x'), null)
  assert.equal(parseStep(''), null)
})

test('걸음이 하나인 조각은 안정 식별자로 읽는다', () => {
  assert.deepEqual(parseFragment('core'), { kind: 'stable', id: 'core' })
  assert.deepEqual(parseFragment('norm/2'), {
    kind: 'path',
    steps: [sectionStep('norm'), indexStep(2)],
  })
  assert.equal(parseFragment('norm//2'), null)
})

test('주소는 읽고 쓴 결과가 같다', () => {
  for (const raw of [
    'principle/불변식은-생성자에서-검증한다',
    'principle/불변식은-생성자에서-검증한다#core',
    'principle/불변식은-생성자에서-검증한다#norm/2',
    'principle/불변식은-생성자에서-검증한다#norm~2/sub/0',
  ]) {
    const address = parseAddress(raw)
    assert.notEqual(address, null, raw)
    assert.equal(formatAddress(address!), raw)
  }
  assert.equal(parseAddress('principle#core'), null)
  assert.equal(parseAddress('principle/doc#'), null)
})

test('숫자로만 이뤄진 섹션 키는 인덱스 걸음과 구분되지 않으므로 거부한다', () => {
  assert.equal(isSectionKey('2'), false)
  assert.equal(isSectionKey('2단계'), true)
  assert.throws(() => sectionStep('2'), RangeError)
  assert.throws(() => sectionStep('norm', 0), RangeError)
  assert.throws(() => indexStep(-1), RangeError)
  assert.equal(parseStep('2~2'), null)
})

test('조각 비교는 형식이 아니라 구조로 한다', () => {
  assert.equal(fragmentEquals(pathFragment([indexStep(2)]), pathFragment([indexStep(2)])), true)
  assert.equal(
    fragmentEquals(pathFragment([sectionStep('norm')]), pathFragment([sectionStep('norm', 2)])),
    false,
  )
  assert.equal(fragmentEquals(stableFragment('core'), pathFragment([sectionStep('core')])), false)
  assert.equal(fragmentEquals(null, pathFragment([])), true)
  assert.equal(fragmentEquals(null, stableFragment('core')), false)
})

test('걸음이 없는 경로는 문서 자신을 뜻하고 왕복한다', () => {
  const address = { document: 'principle/doc', fragment: pathFragment([]) }
  assert.equal(formatAddress(address), 'principle/doc')
  assert.deepEqual(parseAddress('principle/doc'), { document: 'principle/doc', fragment: null })
})
