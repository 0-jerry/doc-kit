/** 바이너리 표현의 왕복과 결정성. 같은 내용이면 반드시 같은 바이트여야 한다. */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalJson,
  decodeBlob,
  decodeSnapshot,
  decodeTree,
  encodeBlob,
  encodeSnapshot,
  encodeTree,
  frame,
  objectId,
  unframe,
  writeVarint,
} from '../../src/store/index.js'

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)

test('길이 접두사는 128 경계를 넘겨 왕복한다', () => {
  // 길이는 LEB128 로 적히므로 한 바이트 경계(127/128)와 두 바이트 경계를 다 넘겨 본다
  for (const length of [0, 1, 127, 128, 129, 16383, 16384]) {
    const name = 'x'.repeat(length)
    const tree = decodeTree(encodeTree({ entries: [{ kind: 'blob', name, id: ID_A }] }))
    assert.equal(tree.entries[0]!.name, name)
  }
})

test('varint 은 길이에 따라 바이트 수가 늘어난다', () => {
  assert.equal(writeVarint(0).byteLength, 1)
  assert.equal(writeVarint(127).byteLength, 1)
  assert.equal(writeVarint(128).byteLength, 2)
  assert.equal(writeVarint(16384).byteLength, 3)
})

test('varint 은 음수를 받지 않는다', () => {
  assert.throws(() => writeVarint(-1), RangeError)
})

test('blob 은 글자를 그대로 왕복한다', () => {
  for (const text of ['', '한글', 'a\nb\n', '🙂 이모지', '  앞뒤 공백  ']) {
    assert.equal(decodeBlob(encodeBlob(text)), text)
  }
})

test('tree 는 메타데이터와 항목 순서를 지켜 왕복한다', () => {
  const tree = {
    meta: { id: 'principle/x', type: 'principle' },
    entries: [
      { kind: 'tree' as const, name: 'norm', id: ID_A },
      { kind: 'blob' as const, name: '', meta: { form: 'paragraph' }, id: ID_B },
      { kind: 'blob' as const, name: 'core', id: ID_A },
    ],
  }
  assert.deepEqual(decodeTree(encodeTree(tree)), tree)
})

test('tree 항목 순서는 정렬되지 않는다 — 순서가 뜻이다', () => {
  const given = ['rationale', 'norm', 'example']
  const tree = decodeTree(
    encodeTree({ entries: given.map((name) => ({ kind: 'tree' as const, name, id: ID_A })) }),
  )
  assert.deepEqual(tree.entries.map((entry) => entry.name), given)
})

test('순서가 다르면 다른 주소가 된다', () => {
  const of = (names: readonly string[]) =>
    objectId('tree', encodeTree({ entries: names.map((name) => ({ kind: 'tree' as const, name, id: ID_A })) }))
  assert.notEqual(of(['norm', 'rationale']), of(['rationale', 'norm']))
})

test('snapshot 은 부모와 뿌리를 왕복한다', () => {
  for (const parents of [[], [ID_A], [ID_A, ID_B]]) {
    const snapshot = { parents, root: ID_B, meta: { at: '2026-01-01T00:00:00.000Z' } }
    assert.deepEqual(decodeSnapshot(encodeSnapshot(snapshot)), snapshot)
  }
})

test('테두리는 종류와 길이를 함께 담는다', () => {
  const framed = frame('blob', encodeBlob('내용'))
  assert.deepEqual(unframe(framed), { type: 'blob', payload: encodeBlob('내용') })
})

test('테두리가 아닌 바이트는 거절한다', () => {
  assert.equal(unframe(Buffer.from('blob 없음')), null)
  assert.equal(unframe(Buffer.from([1, 2, 3])), null)
})

test('길이가 맞지 않는 테두리는 거절한다', () => {
  assert.equal(unframe(Buffer.from('blob 99\0짧다', 'utf8')), null)
})

test('정규 JSON 은 키 순서에 흔들리지 않는다', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } }),
    canonicalJson({ a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 }),
  )
})

test('메타데이터의 키 순서가 달라도 같은 주소가 된다', () => {
  const left = objectId('tree', encodeTree({ meta: { type: 'principle', id: 'x' }, entries: [] }))
  const right = objectId('tree', encodeTree({ meta: { id: 'x', type: 'principle' }, entries: [] }))
  assert.equal(left, right)
})

test('같은 종류라도 내용이 다르면 주소가 다르다', () => {
  assert.notEqual(objectId('blob', encodeBlob('가')), objectId('blob', encodeBlob('나')))
})

test('내용이 같아도 종류가 다르면 주소가 다르다', () => {
  const payload = encodeBlob('')
  assert.notEqual(objectId('blob', payload), objectId('tree', payload))
})
