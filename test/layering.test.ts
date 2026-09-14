/**
 * 원칙 P0 — 모델은 내부 어떤 층도 import 하지 않는다.
 * 층 사이 의존이 한 방향으로만 흐르는지 소스에서 직접 확인한다.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// URL.pathname 은 경로에 한글이 있으면 퍼센트 인코딩된 채로 나오므로 변환해 쓴다.
const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sources(dir: string): string[] {
  const entries = readdirSync(join(SRC, dir))
  return entries.flatMap((entry) => {
    const relative = join(dir, entry)
    if (statSync(join(SRC, relative)).isDirectory()) return sources(relative)
    return relative.endsWith('.ts') ? [relative] : []
  })
}

/** import 구문에서 모듈 지정자만 뽑는다. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*'([^']+)'/g)].map(
    (match) => match[1]!,
  )
}

test('모델은 다른 층을 import 하지 않는다', () => {
  for (const file of sources('model')) {
    const source = readFileSync(join(SRC, file), 'utf8')
    for (const specifier of specifiers(source)) {
      const isInternal = specifier.startsWith('.')
      const staysInModel = specifier.startsWith('./') && !specifier.startsWith('./..')
      assert.ok(
        !isInternal || staysInModel,
        `${file} 이 모델 밖을 import 한다: ${specifier}`,
      )
    }
  }
})

test('모델은 런타임 의존성을 갖지 않는다', () => {
  for (const file of sources('model')) {
    const source = readFileSync(join(SRC, file), 'utf8')
    const runtimeImports = [
      ...source.matchAll(/(?:^|\n)\s*import\s+(?!type\b)([^'"\n]*)from\s*'([^']+)'/g),
    ]
    for (const [, clause, specifier] of runtimeImports) {
      if (specifier!.startsWith('.')) continue
      // `import { type X }` 형태도 타입 전용으로 인정한다
      const onlyTypes = /^\s*\{[^}]*\}\s*$/.test(clause!)
        && clause!.replace(/[{}]/g, '').split(',').every((part) => /^\s*type\s/.test(part))
      assert.ok(onlyTypes, `${file} 이 외부 런타임 의존성을 갖는다: ${specifier}`)
    }
  }
})
