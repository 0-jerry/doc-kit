/**
 * 층 사이 의존이 한 방향으로만 흐르는지 소스에서 직접 확인한다.
 *
 *   P0  모델은 내부 어떤 층도 import 하지 않는다
 *   P0' 저장소도 내부 어떤 층도 import 하지 않는다 — 바이트만 안다
 *
 * 두 층이 양쪽 끝에서 아무것도 모르기 때문에, 문서와 바이트를 잇는 일이
 * `workspace/encode.ts` 한 곳으로 모인다.
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

/**
 * import·export 구문에서 모듈 지정자만 뽑는다.
 * 여러 줄에 걸친 `import {\n  A,\n} from 'x'` 도 센다 — 한 줄만 보면 전부 놓친다.
 */
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(/\bfrom\s*'([^']+)'/g),
    ...source.matchAll(/\bimport\s*'([^']+)'/g),
  ].map((match) => match[1]!)
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

test('저장소는 다른 층을 import 하지 않는다', () => {
  for (const file of sources('store')) {
    const source = readFileSync(join(SRC, file), 'utf8')
    for (const specifier of specifiers(source)) {
      const isInternal = specifier.startsWith('.')
      const staysInStore = specifier.startsWith('./') && !specifier.startsWith('./..')
      assert.ok(!isInternal || staysInStore, `${file} 이 저장소 밖을 import 한다: ${specifier}`)
    }
  }
})

test('저장소는 외부 런타임 의존성을 갖지 않는다 — node 기본 모듈만 쓴다', () => {
  for (const file of sources('store')) {
    const source = readFileSync(join(SRC, file), 'utf8')
    for (const specifier of specifiers(source)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      assert.fail(`${file} 이 외부 의존성을 갖는다: ${specifier}`)
    }
  }
})

test('저장소를 아는 파일은 열거된 셋뿐이다', () => {
  /*
   * 바이트와 문서의 경계를 지키는 울타리다. 늘어나는 것 자체가 문제는 아니지만,
   * 여기에 이름을 적지 않고 늘어나는 것이 문제다 — 적으면서 한 번 더 생각하게 한다.
   *
   *   encode       문서를 객체로 옮긴다 (이 변환을 아는 유일한 곳)
   *   incremental  지문으로 캐시를 판정한다
   *   gc           주소의 도달성으로 거둔다
   */
  const importers = sources('.')
    .filter((file) => !file.startsWith('store/') && !file.startsWith('cli/') && file !== 'index.ts')
    .filter((file) =>
      specifiers(readFileSync(join(SRC, file), 'utf8')).some((s) => s.includes('store/')),
    )
  assert.deepEqual(importers.sort(), [
    'workspace/encode.ts',
    'workspace/gc.ts',
    'workspace/incremental.ts',
  ])
})
