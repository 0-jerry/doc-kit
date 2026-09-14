/**
 * rule-kit 공개 진입점.
 *
 * 각 층은 자신의 하위 모듈에서 재수출한다. 이 파일은 조립만 하고
 * 어떤 로직도 갖지 않는다 — 층 경계를 한눈에 보이게 하는 것이 유일한 목적이다.
 */

export const VERSION = '0.2.0-alpha.0'

// L2 문서 객체 모델
export * from './model/index.js'

// L1 저작 규약
export * from './schema/index.js'

// 공통 진단
export * from './diagnostic/index.js'

// 마크다운 ↔ 모델
export * from './parse/index.js'
export * from './serialize/index.js'

// 원칙 검사
export * from './validate/index.js'

// L3 조작 프로토콜
export * from './api/index.js'

// 문서 간 인덱스와 질의
export * from './workspace/index.js'
export * from './query/index.js'

// 사람용 출력
export * from './render/index.js'
