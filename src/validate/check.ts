/**
 * 검사기 하나의 모양과 그것이 볼 수 있는 것.
 *
 * 검사기는 규약과 조상 체인만 본다. 파일 시스템도, 다른 문서도, 다른 검사기도
 * 볼 수 없다. 그래서 검사기 하나가 커지지 않는다.
 */

import type { Diagnostic, Severity } from '../diagnostic/index.js'
import {
  Block,
  type Document,
  Section,
  type Visit,
  effectiveAux,
  formatAddress,
  pathFragment,
} from '../model/index.js'
import type { Schema } from '../schema/index.js'

export class CheckContext {
  readonly schema: Schema
  readonly document: Document

  constructor(schema: Schema, document: Document) {
    this.schema = schema
    this.document = document
  }

  /** 방문 노드가 속한 섹션 키 경로. 블록이면 자신을 담은 섹션까지. */
  sectionPath(visit: Visit): string[] {
    const fromAncestors = visit.ancestors
      .filter((node): node is Section => node.kind === 'section')
      .map((node) => node.key)
    return visit.node instanceof Section ? [...fromAncestors, visit.node.key] : fromAncestors
  }

  /** 상속을 반영한 보조데이터. */
  resolved(visit: Visit) {
    return effectiveAux(visit)
  }

  address(visit: Visit): string {
    return formatAddress({ document: this.document.id, fragment: pathFragment(visit.path) })
  }

  line(visit: Visit): number | null {
    if (visit.node instanceof Block || visit.node instanceof Section) return visit.node.line
    return null
  }

  /** 진단을 만든다. 위치 정보를 검사기마다 다시 쓰지 않게 한다. */
  report(
    check: { readonly code: string; readonly severity: Severity },
    message: string,
    visit: Visit | null,
    hint?: string,
  ): Diagnostic {
    const line = visit === null ? null : this.line(visit)
    return {
      code: check.code,
      severity: check.severity,
      message,
      document: this.document.id,
      path: this.document.path,
      ...(visit === null ? {} : { address: this.address(visit) }),
      ...(line === null ? {} : { line }),
      ...(hint === undefined ? {} : { hint }),
    }
  }
}

/** 노드 하나를 보는 검사기. */
export interface NodeCheck {
  readonly kind: 'node'
  readonly code: string
  readonly severity: Severity
  /** 이 원칙이 무엇을 막는지 한 줄. */
  readonly principle: string
  run(visit: Visit, context: CheckContext): readonly Diagnostic[]
}

/** 문서 전체를 한 번 보는 검사기. */
export interface DocumentCheck {
  readonly kind: 'document'
  readonly code: string
  readonly severity: Severity
  readonly principle: string
  run(context: CheckContext): readonly Diagnostic[]
}

export type Check = NodeCheck | DocumentCheck
