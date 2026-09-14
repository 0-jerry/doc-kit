/**
 * 명령을 모으고 적용한다. 전부 되거나 전부 안 된다 —
 * 반쯤 적용된 문서를 남기면 에이전트가 무엇을 되돌려야 할지 알 수 없다.
 */

import { z } from 'zod'
import { type Diagnostic, hasError } from '../diagnostic/index.js'
import type { Document } from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { validateDocument } from '../validate/index.js'
import {
  type CommandContext,
  type CommandHandler,
  type CommandResult,
  refusal,
} from './command.js'
import { BlockInsert, BlockRemove, BlockUpdate } from './commands/block.js'
import { DocumentCreate, DocumentSetAux } from './commands/document.js'
import { NodeMove } from './commands/node.js'
import { RelationLink, RelationUnlink } from './commands/relation.js'
import { SectionEnsure } from './commands/section.js'

/**
 * 인자 타입을 지운 처리기. 레지스트리는 명령 종류를 몰라도 되고,
 * 각 처리기는 자기 인자 타입을 그대로 유지한다.
 */
export interface ErasedHandler {
  readonly op: string
  readonly creates: boolean
  parse(input: unknown): z.SafeParseReturnType<unknown, unknown>
  apply(document: Document | null, command: unknown, context: CommandContext): CommandResult
}

function erase<C>(handler: CommandHandler<C>): ErasedHandler {
  return {
    op: handler.op,
    creates: handler.creates ?? false,
    parse: (input) => handler.schema.safeParse(input),
    apply: (document, command, context) => handler.apply(document, command as C, context),
  }
}

export const HANDLERS: readonly ErasedHandler[] = Object.freeze([
  erase(new DocumentCreate()),
  erase(new DocumentSetAux()),
  erase(new SectionEnsure()),
  erase(new BlockInsert()),
  erase(new BlockUpdate()),
  erase(new BlockRemove()),
  erase(new NodeMove()),
  erase(new RelationLink()),
  erase(new RelationUnlink()),
])

export const OPS: readonly string[] = HANDLERS.map((handler) => handler.op)

export interface ApplyOptions {
  readonly schema: Schema
  /**
   * 적용 뒤 원칙 검사를 함께 돌릴지. 기본은 돈다 —
   * 에이전트가 쓰기 전에 무엇이 깨지는지 먼저 보게 하기 위한 것이다.
   */
  readonly validate?: boolean
}

export interface ApplyResult {
  /** 실패하면 입력 문서를 그대로 돌려준다. */
  readonly document: Document | null
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
}

function handlerFor(op: unknown): ErasedHandler | null {
  return HANDLERS.find((handler) => handler.op === op) ?? null
}

/** 명령 하나를 적용한다. */
export function applyCommand(
  document: Document | null,
  command: unknown,
  options: ApplyOptions,
): ApplyResult {
  const op = (command as { op?: unknown } | null)?.op
  const handler = handlerFor(op)
  if (handler === null) {
    return {
      document,
      ok: false,
      diagnostics: [
        refusal('CMD000', `모르는 명령입니다: ${String(op)}`, {
          hint: `쓸 수 있는 명령: ${OPS.join(' · ')}`,
        }),
      ],
    }
  }

  const parsed = handler.parse(command)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    return {
      document,
      ok: false,
      diagnostics: [refusal('CMD000', `${handler.op} 의 인자가 형식을 벗어났습니다: ${issues}`)],
    }
  }

  const context: CommandContext = { schema: options.schema }
  const result = handler.apply(document, parsed.data, context)
  if (!result.ok) return { document, ok: false, diagnostics: result.diagnostics }
  return { document: result.document, ok: true, diagnostics: [] }
}

/**
 * 명령 여러 개를 순서대로 적용한다. 하나라도 거절되면 아무것도 적용하지 않는다.
 * 성공하면 결과 문서에 원칙 검사를 돌려 진단을 함께 돌려준다 — 적용은 막지 않는다.
 */
export function applyCommands(
  document: Document | null,
  commands: readonly unknown[],
  options: ApplyOptions,
): ApplyResult {
  let current = document
  for (const [index, command] of commands.entries()) {
    const result = applyCommand(current, command, options)
    if (!result.ok) {
      return {
        document,
        ok: false,
        diagnostics: result.diagnostics.map((item) => ({
          ...item,
          message: `${index + 1}번째 명령: ${item.message}`,
        })),
      }
    }
    current = result.document
  }

  const diagnostics =
    options.validate === false || current === null
      ? []
      : validateDocument(current, options.schema)

  return { document: current, ok: true, diagnostics }
}

/** 적용 결과가 규약을 깨뜨리는가. 쓰기 전에 묻는 질문이다. */
export function breaksRules(result: ApplyResult): boolean {
  return !result.ok || hasError(result.diagnostics)
}
