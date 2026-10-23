/**
 * 흩어진 노드 파일을 읽어 문서 하나로 합친다 — "주입"에 해당하는 과정이다.
 *
 * 부모는 자식을 소유하지 않는다. 자기 내용만 들고 있고, 조립기가 하위 디렉터리에서
 * 노드를 찾아 순서대로 끼운다. 디렉터리가 곧 인덱스이므로 형제를 더하는 일이 부모 파일을
 * 고치지 않는다 — 서로 다른 브랜치에서 노드를 더해도 충돌하지 않는다.
 */

import { type Diagnostic, diagnostic } from '../diagnostic/index.js'
import {
  Block,
  type Child,
  Document,
  Section,
  aux as makeAux,
  formatDocumentId,
  isSectionKey,
} from '../model/index.js'
import { type SourceParse, parseSource } from '../parse/index.js'
import type { Schema } from '../schema/index.js'
import { NODE_FILE, childDirectory, documentDirectory, nodePath } from './layout.js'
import { compareSiblings, rankerAt } from './order.js'

/** 파일을 읽어 오는 방법. 파일 시스템을 직접 알지 않게 해 테스트를 쉽게 한다. */
export interface NodeFiles {
  /** 없으면 null. */
  read(path: string): string | null
  /** 그 디렉터리 바로 아래의 하위 디렉터리 이름들. */
  directories(path: string): readonly string[]
}

export interface ReadNodeTreeOptions {
  readonly schema: Schema
  readonly collection: string
  readonly name: string
  readonly files: NodeFiles
}

export interface NodeTreeResult {
  readonly document: Document | null
  readonly diagnostics: readonly Diagnostic[]
}

function report(
  code: string,
  severity: 'error' | 'warning',
  message: string,
  path: string,
  hint?: string,
): Diagnostic {
  return diagnostic({
    code,
    severity,
    message,
    path,
    ...(hint === undefined ? {} : { hint }),
  })
}

/** 하위 노드 이름으로 쓸 수 있는가. 경로로 쓰이므로 구분자나 상위 참조는 안 된다. */
function isNodeName(key: string): boolean {
  return isSectionKey(key) && key !== '.' && key !== '..'
}

/**
 * 옛 `children` 인덱스에 적힌 하위 노드 이름들을 거른다.
 *
 * 인덱스는 작성자가 쓴 값이고 곧 디렉터리 이름이 된다. 걸러 내지 않으면
 * `../..` 같은 값으로 작업공간 밖을 읽게 된다 — 경로로 쓰기 전에 본다.
 */
function legacyIndexOf(index: readonly string[], path: string, diagnostics: Diagnostic[]): readonly string[] {
  const keys: string[] = []
  const seen = new Set<string>()

  for (const key of index) {
    if (!isNodeName(key)) {
      diagnostics.push(
        report('NODE005', 'error', `하위 노드 이름으로 쓸 수 없습니다: ${key}`, path,
          '이름은 디렉터리 하나를 가리켜야 합니다. 경로 구분자나 상위 참조는 쓸 수 없습니다'),
      )
      continue
    }
    if (seen.has(key)) {
      diagnostics.push(
        report('NODE006', 'error', `인덱스에 같은 이름이 두 번 있습니다: ${key}`, path,
          '노드 하나는 한 번만 끼워집니다. 나눌 생각이면 다른 이름의 디렉터리를 만드세요'),
      )
      continue
    }
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/** 노드 파일이 자기 안에 제목을 담고 있으면 알린다. 제목은 노드를 만들기 때문이다. */
function reportInlineHeadings(
  children: readonly Child[],
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!children.some((child) => child instanceof Section)) return
  diagnostics.push(
    report('NODE004', 'warning', '노드 파일 안에 제목이 있습니다', path,
      '제목은 노드를 만듭니다. 하위 디렉터리로 나누세요'),
  )
}

/**
 * 노드 파일에는 제목 줄이 없으므로 블록이 자기 역할을 모른다.
 * 노드의 자리에서 규약이 정한 기본 역할을 얹어 준다 — 읽고 나면 다른 층은
 * 단일 파일에서 읽은 것과 구분할 수 없다.
 */
function applyDefaultRole(
  children: readonly Child[],
  schema: Schema,
  type: string,
  keyPath: readonly string[],
): readonly Child[] {
  const role = schema.defaultRoleAt(type, keyPath)
  if (role === null) return children
  return children.map((child) => {
    if (!(child instanceof Block) || child.aux.role !== undefined) return child
    return child.with({ aux: makeAux({ ...child.aux, role }) })
  })
}

interface ReadContext {
  readonly schema: Schema
  readonly type: string
  readonly files: NodeFiles
  readonly root: string
  readonly diagnostics: Diagnostic[]
}

/** 읽은 노드 하나와, 형제 사이에서 자리를 정하는 데 쓸 `order`. */
interface ReadNode {
  readonly section: Section
  readonly order: string
}

/** 노드 하나와 그 자손을 읽는다. 노드 파일이 없으면 null — 호출자가 무엇이 빠졌는지 알린다. */
function readNode(
  context: ReadContext,
  directory: string,
  key: string,
  keyPath: readonly string[],
  depth: number,
): ReadNode | null {
  const path = nodePath(directory)
  const text = context.files.read(path)
  if (text === null) return null

  const source = parseSource(text, {
    schema: context.schema,
    path,
    type: context.type,
    depthOffset: depth,
  })
  if (source === null) {
    context.diagnostics.push(report('PRS002', 'error', 'frontmatter 를 읽을 수 없습니다', path))
    return null
  }
  context.diagnostics.push(...source.diagnostics)

  const own = applyDefaultRole(source.children, context.schema, context.type, keyPath)
  reportInlineHeadings(own, path, context.diagnostics)
  const injected = readChildren(context, directory, source, keyPath, depth)

  const heading =
    source.reserved.get('title')?.[0] ??
    context.schema.sectionAt(context.type, keyPath)?.heading ??
    key

  return {
    section: new Section({
      key,
      heading,
      depth,
      aux: source.aux,
      stableId: source.stableId,
      // 제목 줄은 어느 파일에도 없다. 합칠 때 새로 쓴다.
      raw: null,
      origin: null,
      children: [...own, ...injected],
    }),
    order: source.reserved.get('order')?.[0] ?? '',
  }
}

/** 하위 노드를 찾아 순서대로 끼운다. 옛 인덱스가 있으면 그것을 따른다. */
function readChildren(
  context: ReadContext,
  directory: string,
  source: SourceParse,
  keyPath: readonly string[],
  depth: number,
): Section[] {
  const legacy = source.reserved.get('children')
  if (legacy !== undefined) {
    return readLegacyChildren(context, directory, legacy, keyPath, depth)
  }

  const path = nodePath(directory)
  const rank = rankerAt(context.schema, context.type, keyPath)
  const found: (ReadNode & { readonly name: string })[] = []

  for (const name of context.files.directories(directory)) {
    if (!isNodeName(name)) {
      context.diagnostics.push(
        report('NODE005', 'error', `하위 노드 이름으로 쓸 수 없습니다: ${name}`, path,
          '이름은 섹션 키가 됩니다. 숫자로만 된 이름이나 주소 구분자는 쓸 수 없습니다'),
      )
      continue
    }
    const node = readNode(context, childDirectory(directory, name), name, [...keyPath, name], depth + 1)
    if (node === null) {
      // 병합에서 한쪽이 노드를 지우고 다른 쪽이 그 디렉터리에 파일을 더하면 껍데기만 남는다.
      if (context.files.read(nodePath(childDirectory(directory, name))) === null) {
        context.diagnostics.push(
          report('NODE003', 'warning', `노드 파일이 없는 디렉터리입니다: ${name}`, path,
            `${childDirectory(directory, name)}/${NODE_FILE} 를 만들거나 디렉터리를 지우세요`),
        )
      }
      continue
    }
    found.push({ ...node, name })
  }

  return found
    .sort((a, b) =>
      compareSiblings(
        { rank: rank(a.name), order: a.order, name: a.name },
        { rank: rank(b.name), order: b.order, name: b.name },
      ),
    )
    .map((node) => node.section)
}

/** 옛 `children` 인덱스를 따라 끼운다. 인덱스는 형제 모두가 고치는 목록이라 병합에 약하다. */
function readLegacyChildren(
  context: ReadContext,
  directory: string,
  legacy: readonly string[],
  keyPath: readonly string[],
  depth: number,
): Section[] {
  const path = nodePath(directory)
  context.diagnostics.push(
    report('NODE007', 'warning', 'children 인덱스는 더 쓰지 않습니다', path,
      '하위 디렉터리가 곧 인덱스입니다. `dockit split --document <id>` 로 다시 쓰면 인덱스가 빠집니다'),
  )

  const index = legacyIndexOf(legacy, path, context.diagnostics)
  const sections: Section[] = []

  for (const key of index) {
    const child = childDirectory(directory, key)
    const node = readNode(context, child, key, [...keyPath, key], depth + 1)
    if (node !== null) {
      sections.push(node.section)
      continue
    }
    if (context.files.read(nodePath(child)) === null) {
      context.diagnostics.push(
        report('NODE002', 'error', `인덱스가 가리키는 노드가 없습니다: ${key}`, nodePath(child),
          `${child}/${NODE_FILE} 를 만들거나 부모의 children 에서 빼세요`),
      )
    }
  }

  // 디렉터리는 있는데 인덱스에 없으면 합쳐지지 않는다. 조용히 빠지지 않게 알린다.
  const indexed = new Set(index)
  for (const found of context.files.directories(directory)) {
    if (indexed.has(found)) continue
    context.diagnostics.push(
      report('NODE003', 'warning', `인덱스에 없는 노드 디렉터리입니다: ${found}`, path,
        `children 에 '${found}' 를 더하거나 디렉터리를 지우세요`),
    )
  }

  return sections
}

/** 노드 트리를 읽어 문서 하나로 합친다. */
export function readNodeTree(options: ReadNodeTreeOptions): NodeTreeResult {
  const { schema, collection, name, files } = options
  const root = documentDirectory(collection, name)
  const path = nodePath(root)
  const diagnostics: Diagnostic[] = []

  const text = files.read(path)
  if (text === null) {
    return {
      document: null,
      diagnostics: [
        report('NODE001', 'error', '루트 노드 파일이 없습니다', path, `${path} 를 만드세요`),
      ],
    }
  }

  const source = parseSource(text, { schema, path, collection })
  if (source === null) {
    return {
      document: null,
      diagnostics: [report('PRS002', 'error', 'frontmatter 를 읽을 수 없습니다', path)],
    }
  }
  diagnostics.push(...source.diagnostics)

  let id: string
  try {
    id = formatDocumentId(collection, source.stableId ?? name)
  } catch (error) {
    diagnostics.push(report('PRS008', 'error', (error as Error).message, path))
    return { document: null, diagnostics }
  }

  const context: ReadContext = { schema, type: source.type, files, root, diagnostics }
  reportInlineHeadings(source.children, path, diagnostics)
  const injected = readChildren(context, root, source, [], 1)

  return {
    document: new Document({
      id,
      type: source.type,
      path,
      /*
       * frontmatter 조각은 버린다. 거기에는 `children` 인덱스가 적혀 있는데,
       * 그것은 흩어 두기 위한 저장 형태의 일이지 문서의 내용이 아니다.
       * 합친 문서를 한 파일로 내보낼 때 따라 나가면 안 된다.
       */
      raw: null,
      origin: null,
      sourceLength: null,
      aux: source.aux,
      children: [...source.children, ...injected],
    }),
    diagnostics,
  }
}
