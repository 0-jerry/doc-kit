/** 느슨한 객체 저장소와 stat 캐시. 임시 디렉터리에서 실제 파일을 쓴다. */

import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DerivedCache, ObjectStore, StatCache, markFrom } from '../../src/store/index.js'

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), 'dockit-store-'))
}

test('쓴 객체를 주소로 다시 읽는다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const id = store.writeBlob('불변식은 생성자에서 검증한다')
    assert.equal(store.blob(id), '불변식은 생성자에서 검증한다')
    assert.ok(store.has(id))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('같은 내용은 두 번 쓰이지 않는다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const first = store.writeBlob('같은 진술')
    const second = store.writeBlob('같은 진술')
    assert.equal(first, second)
    assert.deepEqual(store.stats, { written: 1, reused: 1, read: 0 })
    assert.equal(store.count(), 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('객체 파일은 압축되어 있다 — 평문이 그대로 있지 않다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const text = '압축되어야 하는 아주 긴 진술 '.repeat(40)
    const id = store.writeBlob(text)
    const raw = readFileSync(join(directory, 'objects', id.slice(0, 2), id.slice(2)))
    assert.ok(!raw.includes(Buffer.from(text, 'utf8')))
    assert.ok(raw.byteLength < Buffer.byteLength(text, 'utf8'))
    assert.equal(store.blob(id), text)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('없는 주소와 형식이 아닌 주소는 null 이다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    assert.equal(store.read('f'.repeat(64)), null)
    assert.equal(store.read('주소가 아니다'), null)
    assert.equal(store.blob('f'.repeat(64)), null)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('종류가 다르면 그 종류로 읽히지 않는다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const blob = store.writeBlob('내용')
    assert.equal(store.tree(blob), null)
    assert.equal(store.snapshot(blob), null)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('이력은 HEAD 에서 조상으로 거슬러 간다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const root = store.writeTree({ entries: [] })
    const first = store.writeSnapshot({ parents: [], root, meta: { at: '1' } })
    store.setHead(first)
    const second = store.writeSnapshot({ parents: [first], root, meta: { at: '2' } })
    store.setHead(second)

    assert.equal(store.head(), second)
    assert.deepEqual([...store.history()].map((item) => item.id), [second, first])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('HEAD 가 없으면 이력은 비어 있다', () => {
  const directory = sandbox()
  try {
    assert.equal(new ObjectStore(directory).head(), null)
    assert.deepEqual([...new ObjectStore(directory).history()], [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stat 캐시는 수정시각이 그대로면 파일을 읽지 않는다', () => {
  const root = sandbox()
  const directory = join(root, '.store')
  try {
    mkdirSync(join(root, 'principle'), { recursive: true })
    writeFileSync(join(root, 'principle', 'a.md'), '내용', 'utf8')

    const first = StatCache.open(root, directory)
    const hash = first.hashOf('principle/a.md')
    assert.ok(hash !== null)
    assert.deepEqual(first.stats, { hits: 0, misses: 1 })
    first.save()

    const second = StatCache.open(root, directory)
    assert.equal(second.hashOf('principle/a.md'), hash)
    assert.deepEqual(second.stats, { hits: 1, misses: 0 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('내용이 바뀌면 stat 캐시가 빗나가고 해시가 달라진다', () => {
  const root = sandbox()
  const directory = join(root, '.store')
  try {
    const path = join(root, 'a.md')
    writeFileSync(path, '처음', 'utf8')
    const first = StatCache.open(root, directory)
    const before = first.hashOf('a.md')
    first.save()

    writeFileSync(path, '바뀜', 'utf8')
    const second = StatCache.open(root, directory)
    const after = second.hashOf('a.md')
    assert.notEqual(before, after)
    assert.deepEqual(second.stats, { hits: 0, misses: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stat 캐시는 사라진 파일의 항목을 버린다', () => {
  const root = sandbox()
  const directory = join(root, '.store')
  try {
    writeFileSync(join(root, 'a.md'), 'a', 'utf8')
    writeFileSync(join(root, 'b.md'), 'b', 'utf8')
    const first = StatCache.open(root, directory)
    first.hashOf('a.md')
    first.hashOf('b.md')
    first.save()

    // 이번에는 a.md 만 본다 — b.md 의 항목은 저절로 빠져야 한다
    const second = StatCache.open(root, directory)
    second.hashOf('a.md')
    second.save()

    const third = StatCache.open(root, directory)
    third.hashOf('b.md')
    assert.deepEqual(third.stats, { hits: 0, misses: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stat 캐시는 없는 파일에 null 을 준다', () => {
  const root = sandbox()
  try {
    assert.equal(StatCache.open(root, join(root, '.store')).hashOf('없다.md'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('망가진 stat 캐시는 조용히 버려진다', () => {
  const root = sandbox()
  const directory = join(root, '.store')
  try {
    writeFileSync(join(root, 'a.md'), 'a', 'utf8')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'index'), Buffer.from('쓰레기'))

    const cache = StatCache.open(root, directory)
    assert.ok(cache.hashOf('a.md') !== null)
    assert.deepEqual(cache.stats, { hits: 0, misses: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('파생 캐시는 담은 값을 그대로 돌려준다', () => {
  const directory = sandbox()
  try {
    const cache = new DerivedCache(directory)
    const key = cache.key(['규약해시', '원본해시'])
    assert.equal(cache.get(key), null)

    cache.put(key, { records: [{ address: 'principle/x' }] })
    assert.deepEqual(cache.get(key), { records: [{ address: 'principle/x' }] })
    assert.deepEqual(cache.stats, { hits: 1, misses: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('열쇠의 한 조각만 달라도 캐시가 빗나간다', () => {
  const directory = sandbox()
  try {
    const cache = new DerivedCache(directory)
    cache.put(cache.key(['규약A', '원본']), 1)
    assert.equal(cache.get(cache.key(['규약B', '원본'])), null)
    assert.equal(cache.get(cache.key(['규약A', '원본'])), 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('주소의 앞부분으로 객체를 찾는다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const id = store.writeBlob('앞부분으로 찾는다')
    assert.deepEqual(store.matching(id.slice(0, 12)), [id])
    assert.deepEqual(store.matching(id.slice(0, 12).toUpperCase()), [id])
    assert.deepEqual(store.matching(id), [id])
    // 너무 짧거나 16진수가 아니면 찾지 않는다
    assert.deepEqual(store.matching(id.slice(0, 3)), [])
    assert.deepEqual(store.matching('zzzz'), [])
    assert.deepEqual(store.matching(`${id.slice(0, 11)}${id[11] === '0' ? '1' : '0'}`), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('망가진 객체는 없는 것처럼 읽힌다', () => {
  const directory = sandbox()
  try {
    const store = new ObjectStore(directory)
    const blob = store.writeBlob('곧 망가진다')
    const tree = store.writeTree({ entries: [{ kind: 'blob', name: '', id: blob }] })
    writeFileSync(join(directory, 'objects', tree.slice(0, 2), tree.slice(2)), Buffer.from('쓰레기'))

    assert.equal(store.read(tree), null)
    assert.equal(store.tree(tree), null)
    // 거두기의 표시 단계도 터지지 않는다
    assert.deepEqual([...markFrom(store, [tree])], [tree])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('dryRun 저장소는 디스크에 쓰지 않고 자기 안에서만 보인다', () => {
  const directory = join(sandbox(), 'store')
  try {
    const store = new ObjectStore(directory, { dryRun: true })
    const id = store.writeBlob('메모리에만')
    store.setHead(id)

    assert.ok(store.has(id))
    assert.equal(store.blob(id), '메모리에만')
    assert.equal(store.head(), id)
    assert.equal(existsSync(directory), false)
    assert.equal(new ObjectStore(directory).has(id), false)
  } finally {
    rmSync(join(directory, '..'), { recursive: true, force: true })
  }
})

test('stat 캐시는 캐시 파일과 같은 시각에 고쳐진 파일을 믿지 않는다', () => {
  /*
   * 수정시각이 1 초 단위인 파일 시스템을 흉내 낸다. 해싱하고 캐시를 쓴 바로 그 초에
   * 같은 크기로 다시 고치면 (수정시각, 크기) 가 그대로라 stat 만으로는 구별되지 않는다.
   */
  const root = sandbox()
  const directory = join(root, '.store')
  try {
    const path = join(root, 'a.md')
    const second = new Date(Math.floor(Date.now() / 1000) * 1000)
    writeFileSync(path, 'must', 'utf8')
    utimesSync(path, second, second)

    const first = StatCache.open(root, directory)
    const before = first.hashOf('a.md')
    first.save()
    utimesSync(join(directory, 'index'), second, second)

    writeFileSync(path, 'may!', 'utf8')
    utimesSync(path, second, second)

    const again = StatCache.open(root, directory)
    assert.notEqual(again.hashOf('a.md'), before)
    assert.deepEqual(again.stats, { hits: 0, misses: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
