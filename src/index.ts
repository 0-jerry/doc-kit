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

// L3 조작 프로토콜
// export * from './api/index.js'
