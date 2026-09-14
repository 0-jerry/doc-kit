/**
 * 진단 하나의 모양. 파싱·검증·조작이 모두 같은 형태로 보고한다.
 * 모델만 알고, 판정 로직은 갖지 않는다.
 */

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  /** 진단 코드. 접두사가 층을 가리킨다 — PRS · SCH · STR · AUX · REF · CMD */
  readonly code: string
  readonly severity: Severity
  readonly message: string
  /** 문서 식별자. 문서를 만들지 못한 단계에서는 없을 수 있다. */
  readonly document?: string
  /** 노드 주소 문자열. */
  readonly address?: string
  /** 원본 파일 경로. */
  readonly path?: string
  /** 원문에서의 줄 번호. */
  readonly line?: number
  /** 어떻게 고치면 되는지 한 줄. */
  readonly hint?: string
}

export interface DiagnosticInit extends Omit<Diagnostic, 'code' | 'severity' | 'message'> {
  readonly code: string
  readonly severity: Severity
  readonly message: string
}

export function diagnostic(init: DiagnosticInit): Diagnostic {
  return init
}

export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): Record<Severity, number> {
  return {
    error: diagnostics.filter((item) => item.severity === 'error').length,
    warning: diagnostics.filter((item) => item.severity === 'warning').length,
  }
}

/** 사람이 읽는 한 줄. */
export function formatDiagnostic(item: Diagnostic): string {
  const where = [item.path ?? item.document, item.line === undefined ? null : `${item.line}`]
    .filter((part) => part !== null && part !== undefined)
    .join(':')
  const address = item.address === undefined ? '' : ` (${item.address})`
  const hint = item.hint === undefined ? '' : `\n    → ${item.hint}`
  return `${where} ${item.severity} ${item.code} ${item.message}${address}${hint}`
}
