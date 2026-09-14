/**
 * 조작 프로토콜의 공통 모양.
 *
 * 명령은 JSON 객체다. 에이전트가 그대로 내보내고, CLI 가 같은 형태를 만들고,
 * 테스트가 같은 형태를 검증한다. 어느 명령도 파일을 쓰지 않는다.
 */

import { z } from 'zod'
import type { Diagnostic, Severity } from '../diagnostic/index.js'
import type { Document } from '../model/index.js'
import type { Schema } from '../schema/index.js'

export const auxPatchSchema = z
  .object({
    role: z.string().min(1).optional(),
    subject: z.array(z.string().min(1)).optional(),
    topic: z.array(z.string().min(1)).optional(),
    status: z.string().min(1).optional(),
    since: z.string().min(1).optional(),
    until: z.string().min(1).optional(),
    level: z.string().min(1).optional(),
    relations: z
      .array(z.object({ kind: z.string().min(1), target: z.string().min(1) }).strict())
      .optional(),
  })
  .strict()

export type AuxPatch = z.infer<typeof auxPatchSchema>

export interface CommandContext {
  readonly schema: Schema
}

/** 명령 하나의 결과. 실패하면 문서를 그대로 두고 왜 안 되는지만 말한다. */
export type CommandResult =
  | { readonly ok: true; readonly document: Document }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export function ok(document: Document): CommandResult {
  return { ok: true, document }
}

export function fail(...diagnostics: Diagnostic[]): CommandResult {
  return { ok: false, diagnostics }
}

/** 명령 처리기 하나. 변형 하나만 책임진다. */
export interface CommandHandler<C = unknown> {
  readonly op: string
  /** 에이전트가 보낸 JSON 을 거르는 형식. */
  readonly schema: z.ZodType<C, z.ZodTypeDef, unknown>
  /** 문서가 아직 없을 때도 쓸 수 있는가. `document.create` 만 참이다. */
  readonly creates?: boolean
  apply(document: Document | null, command: C, context: CommandContext): CommandResult
}

/** 명령 실패 진단. 코드는 모두 CMD 접두사를 쓴다. */
export function refusal(
  code: string,
  message: string,
  options: { readonly document?: string; readonly address?: string; readonly hint?: string } = {},
): Diagnostic {
  const severity: Severity = 'error'
  return {
    code,
    severity,
    message,
    ...(options.document === undefined ? {} : { document: options.document }),
    ...(options.address === undefined ? {} : { address: options.address }),
    ...(options.hint === undefined ? {} : { hint: options.hint }),
  }
}
