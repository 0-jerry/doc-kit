/** 패키지 메타데이터와 코드가 벌어지지 않는지 본다. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { VERSION } from '../src/index.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

function packageJson(): { version: string; name: string; bin: Record<string, string> } {
  return JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'))
}

test('VERSION 은 package.json 과 같다', () => {
  // 손으로 적은 상수라 한 번 벌어진 적이 있다. 테스트가 아니면 또 벌어진다.
  assert.equal(VERSION, packageJson().version)
})

test('package-lock 의 버전도 함께 움직인다', () => {
  const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'))
  const version = packageJson().version
  assert.equal(lock.version, version)
  assert.equal(lock.packages['']?.version, version)
})

test('실행 파일 이름은 하나이고 빌드 산출물을 가리킨다', () => {
  const bin = packageJson().bin
  const names = Object.keys(bin)
  assert.equal(names.length, 1)
  assert.match(bin[names[0]!]!, /^\.\/dist\//)
})
