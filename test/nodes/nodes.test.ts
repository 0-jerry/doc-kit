/**
 * 노드 트리 저장 형태. 노드 하나가 디렉터리 하나이고,
 * 부모는 자식을 소유하지 않고 이름만 인덱스로 들고 있다.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseDocument } from '../../src/parse/index.js'
import { loadPreset } from '../../src/schema/index.js'
import { serializeDocument } from '../../src/serialize/index.js'
import {
  NODE_FILE,
  type NodeFile,
  type NodeFiles,
  readEntries,
  readNodeTree,
  splitDocument,
} from '../../src/nodes/index.js'

const schema = loadPreset('preset/principle')

const TEXT = `---
type: principle
id: 불변식은-생성자에서-검증한다
subject: [domain-layer]
topic: [validation]
status: active
---

## 기준

<!-- dk: id=core -->
불변식은 생성자에서 검증한다.

## 근거

유효하지 않은 상태가 존재할 수 없다.

### 더 좁은 경우

값 객체는 더 그렇다.

## 예시

<!-- dk: role=counter-example -->
\`\`\`swift
init(age: Int) { self.age = age }
\`\`\`
`

const NAME = '불변식은-생성자에서-검증한다'

function original() {
  return parseDocument(TEXT, {
    schema,
    path: `principle/${NAME}.md`,
    collection: 'principle',
    name: NAME,
  }).document!
}

/** 메모리 위의 노드 파일 모음. */
function store(files: readonly NodeFile[]): NodeFiles {
  const map = new Map(files.map((file) => [file.path, file.content]))
  return {
    read: (path) => map.get(path) ?? null,
    directories: (directory) => {
      const prefix = directory === '' ? '' : `${directory}/`
      const found = new Set<string>()
      for (const path of map.keys()) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length).split('/')
        if (rest.length === 2 && rest[1] === NODE_FILE) found.add(rest[0]!)
      }
      return [...found]
    },
  }
}

function assemble(files: readonly NodeFile[]) {
  return readNodeTree({ schema, collection: 'principle', name: NAME, files: store(files) })
}

test('제목마다 노드 디렉터리 하나가 생긴다', () => {
  const files = splitDocument(original(), schema).map((file) => file.path)
  assert.deepEqual(files, [
    `principle/${NAME}/${NODE_FILE}`,
    `principle/${NAME}/norm/${NODE_FILE}`,
    `principle/${NAME}/rationale/${NODE_FILE}`,
    `principle/${NAME}/rationale/더-좁은-경우/${NODE_FILE}`,
    `principle/${NAME}/example/${NODE_FILE}`,
  ])
})

test('부모는 자식 내용 대신 이름만 인덱스로 갖는다', () => {
  const files = splitDocument(original(), schema)
  const root = files[0]!.content
  assert.match(root, /children:\n  - norm\n  - rationale\n  - example\n/)
  // 자식의 내용은 루트에 들어 있지 않다
  assert.ok(!root.includes('불변식은 생성자에서 검증한다'))

  const rationale = files.find((file) => file.path.endsWith(`rationale/${NODE_FILE}`))!.content
  assert.match(rationale, /children:\n  - 더-좁은-경우\n/)
  assert.ok(rationale.includes('유효하지 않은 상태가 존재할 수 없다.'))
  assert.ok(!rationale.includes('값 객체는 더 그렇다'))
})

test('노드는 자기가 정의한 내용만 소유한다', () => {
  const files = splitDocument(original(), schema)
  const norm = files.find((file) => file.path.endsWith(`norm/${NODE_FILE}`))!.content
  assert.equal(norm, '---\n---\n\n<!-- dk: id=core -->\n불변식은 생성자에서 검증한다.\n')
})

test('규약이 아는 제목은 다시 적지 않고, 모르는 제목만 적는다', () => {
  const files = splitDocument(original(), schema)
  const norm = files.find((file) => file.path.endsWith(`norm/${NODE_FILE}`))!.content
  assert.ok(!norm.includes('title:'))
  const nested = files.find((file) => file.path.includes('더-좁은-경우'))!.content
  assert.match(nested, /title: 더 좁은 경우/)
})

test('섹션이 정한 기본 역할은 적지 않고 읽을 때 되살린다', () => {
  const files = splitDocument(original(), schema)
  const norm = files.find((file) => file.path.endsWith(`norm/${NODE_FILE}`))!.content
  assert.ok(!norm.includes('role='))

  const rebuilt = assemble(files).document!
  assert.equal(rebuilt.sections[0]?.blocks[0]?.aux.role, 'norm')
  // 기본값과 다른 역할은 그대로 남는다
  const example = files.find((file) => file.path.endsWith(`example/${NODE_FILE}`))!.content
  assert.match(example, /role=counter-example/)
})

test('인덱스를 따라 주입해 원래 트리로 합쳐진다', () => {
  const result = assemble(splitDocument(original(), schema))
  assert.deepEqual(result.diagnostics, [])

  const document = result.document!
  assert.equal(document.id, `principle/${NAME}`)
  assert.equal(document.type, 'principle')
  assert.deepEqual(document.aux.subject, ['domain-layer'])
  assert.deepEqual(
    document.sections.map((section) => section.key),
    ['norm', 'rationale', 'example'],
  )
  assert.equal(document.sections[1]?.sections[0]?.heading, '더 좁은 경우')
  assert.equal(document.sections[1]?.sections[0]?.depth, 3)
})

test('트리 → 문서 → 트리 는 같은 파일을 낸다', () => {
  const once = splitDocument(original(), schema)
  const twice = splitDocument(assemble(once).document!, schema)
  assert.deepEqual(twice, once)
})

test('합친 문서에는 저장 형태의 인덱스가 따라 나오지 않는다', () => {
  const text = serializeDocument(assemble(splitDocument(original(), schema)).document!, { schema })
  assert.ok(!text.includes('children:'))
  assert.ok(text.includes('## 기준'))
  assert.ok(text.includes('### 더 좁은 경우'))

  // 합친 문서를 다시 읽고 흩어도 같은 트리가 된다
  const reparsed = parseDocument(text, {
    schema,
    path: `principle/${NAME}.md`,
    collection: 'principle',
    name: NAME,
  }).document!
  assert.deepEqual(splitDocument(reparsed, schema), splitDocument(original(), schema))
})

test('NODE001 — 루트 노드 파일이 없으면 오류', () => {
  const result = assemble([])
  assert.equal(result.document, null)
  assert.equal(result.diagnostics[0]?.code, 'NODE001')
})

test('NODE002 — 인덱스가 가리키는 노드가 없으면 오류', () => {
  const files = splitDocument(original(), schema).filter(
    (file) => !file.path.endsWith(`norm/${NODE_FILE}`),
  )
  const result = assemble(files)
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE002'))
  // 나머지는 그대로 합쳐진다
  assert.deepEqual(
    result.document?.sections.map((section) => section.key),
    ['rationale', 'example'],
  )
})

test('NODE003 — 인덱스에 없는 디렉터리는 경고', () => {
  const files = [
    ...splitDocument(original(), schema),
    { path: `principle/${NAME}/떠도는노드/${NODE_FILE}`, content: '---\n---\n\n문단.\n' },
  ]
  const result = assemble(files)
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE003'))
})

test('NODE004 — 노드 파일 안의 제목은 경고', () => {
  const files = splitDocument(original(), schema).map((file) =>
    file.path.endsWith(`norm/${NODE_FILE}`)
      ? { ...file, content: `${file.content}\n## 안에 있는 제목\n\n문단.\n` }
      : file,
  )
  const result = assemble(files)
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE004'))
})

test('NODE005 — 경로가 될 수 없는 인덱스 이름은 거부한다', () => {
  const read = (content: string) =>
    readNodeTree({
      schema,
      collection: 'principle',
      name: NAME,
      files: store([{ path: `principle/${NAME}/${NODE_FILE}`, content }]),
    })

  for (const key of ['"../../탈출"', '".."', '"a/b"', '"a#b"']) {
    const result = read(`---\ntype: principle\nid: ${NAME}\nchildren: [${key}]\n---\n\n`)
    assert.ok(
      result.diagnostics.some((item) => item.code === 'NODE005'),
      `${key} 를 거부해야 합니다`,
    )
    // 거부한 이름으로는 파일을 읽으려 하지도 않는다
    assert.ok(!result.diagnostics.some((item) => item.code === 'NODE002'))
  }
})

test('NODE006 — 인덱스에 같은 이름이 두 번 있으면 오류', () => {
  const result = readNodeTree({
    schema,
    collection: 'principle',
    name: NAME,
    files: store([
      {
        path: `principle/${NAME}/${NODE_FILE}`,
        content: `---\ntype: principle\nid: ${NAME}\nchildren: [norm, norm]\n---\n\n`,
      },
      { path: `principle/${NAME}/norm/${NODE_FILE}`, content: '---\n---\n\n진술.\n' },
    ]),
  })
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE006'))
  // 한 번만 끼워진다
  assert.equal(result.document?.sections.length, 1)
})

test('NODE004 — 루트 노드 파일 안의 제목도 경고한다', () => {
  const result = readNodeTree({
    schema,
    collection: 'principle',
    name: NAME,
    files: store([
      {
        path: `principle/${NAME}/${NODE_FILE}`,
        content: `---\ntype: principle\nid: ${NAME}\n---\n\n## 기준\n\n진술.\n`,
      },
    ]),
  })
  assert.ok(result.diagnostics.some((item) => item.code === 'NODE004'))
})

test('디렉터리 항목은 이름 순이고, 점 항목과 끊긴 링크를 빼며, 링크는 가리키는 곳의 종류를 따른다', () => {
  const base = mkdtempSync(join(tmpdir(), 'dockit-entries-'))
  try {
    mkdirSync(join(base, 'b'))
    mkdirSync(join(base, '.hidden'))
    writeFileSync(join(base, NODE_FILE), '')
    symlinkSync(join(base, 'b'), join(base, 'a'))
    symlinkSync(join(base, NODE_FILE), join(base, 'c.md'))
    symlinkSync(join(base, '없음'), join(base, 'd'))

    assert.deepEqual(readEntries(base), [
      { name: 'a', isDirectory: true },
      { name: 'b', isDirectory: true },
      { name: 'c.md', isDirectory: false },
      { name: NODE_FILE, isDirectory: false },
    ])
    assert.deepEqual(readEntries(join(base, '없는-디렉터리')), [])
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
