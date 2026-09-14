/** 블록을 끼우고 고치고 뺀다. */

import { z } from 'zod'
import {
  Block,
  Document,
  EMPTY_AUX,
  Section,
  type Visit,
  parseFragment,
} from '../../model/index.js'
import { parseBlockSource } from '../../parse/index.js'
import { applyAuxPatch } from '../aux-patch.js'
import { keyPathOf } from '../key-path.js'
import { insertAt, replaceAt } from '../tree.js'
import {
  type CommandContext,
  type CommandHandler,
  type CommandResult,
  auxPatchSchema,
  fail,
  ok,
  refusal,
} from '../command.js'

const positionSchema = z.union([z.literal('start'), z.literal('end'), z.number().int().min(0)])

/** 주소 문자열을 방문으로 바꾼다. 형식이 틀렸는지 없는 노드인지 구분해 말한다. */
export function locate(document: Document, address: string): Visit | CommandResult {
  const fragment = parseFragment(address)
  if (fragment === null) {
    return fail(
      refusal('CMD007', `주소 형식이 아닙니다: ${address}`, {
        document: document.id,
        hint: '`섹션키/인덱스` 또는 안정 식별자로 적으세요',
      }),
    )
  }
  const visit = document.resolve(fragment)
  if (visit === null) {
    return fail(refusal('CMD005', `그런 노드가 없습니다: ${address}`, { document: document.id }))
  }
  return visit
}

function isRefusal(value: Visit | CommandResult): value is CommandResult {
  return 'ok' in value
}

const insertSchema = z
  .object({
    op: z.literal('block.insert'),
    /** 블록을 담을 섹션의 주소. */
    at: z.string().min(1),
    position: positionSchema.default('end'),
    /** 마크다운 조각. 블록 하나여야 한다. */
    markdown: z.string().min(1),
    aux: auxPatchSchema.optional(),
  })
  .strict()

export type InsertBlock = z.infer<typeof insertSchema>

export class BlockInsert implements CommandHandler<InsertBlock> {
  readonly op = 'block.insert'
  readonly schema = insertSchema

  apply(document: Document | null, command: InsertBlock, context: CommandContext): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))

    const found = locate(document, command.at)
    if (isRefusal(found)) return found
    if (!(found.node instanceof Section)) {
      return fail(
        refusal('CMD008', `블록은 섹션 안에만 둘 수 있습니다: ${command.at}`, {
          document: document.id,
        }),
      )
    }

    const source = parseBlockSource(command.markdown)
    if (source === null) {
      return fail(
        refusal('CMD009', '마크다운 조각이 블록 하나가 아닙니다', {
          document: document.id,
          hint: '명령 하나가 블록 하나를 만듭니다. 나눠서 보내세요',
        }),
      )
    }

    const keyPath = keyPathOf(found)
    const spec = context.schema.sectionAt(document.type, keyPath)
    if (spec?.maxBlocks !== undefined && found.node.blocks.length >= spec.maxBlocks) {
      return fail(
        refusal('CMD010', `'${found.node.key}' 섹션의 블록 상한(${spec.maxBlocks})을 넘습니다`, {
          document: document.id,
          hint: '내용을 다른 섹션으로 옮기거나 문서를 쪼개세요',
        }),
      )
    }

    const role = command.aux?.role ?? context.schema.defaultRoleAt(document.type, keyPath)
    const aux = applyAuxPatch(EMPTY_AUX, {
      ...command.aux,
      ...(role === null || role === undefined ? {} : { role }),
    })

    const block = new Block({ ...source, aux })
    const index =
      command.position === 'start'
        ? 0
        : command.position === 'end'
          ? found.node.children.length
          : command.position
    const updated = insertAt(document, found.path, index, block)
    if (updated === null) return fail(refusal('CMD005', '블록을 끼울 자리를 찾지 못했습니다'))
    return ok(updated)
  }
}

const updateSchema = z
  .object({
    op: z.literal('block.update'),
    at: z.string().min(1),
    markdown: z.string().min(1).optional(),
    aux: auxPatchSchema.optional(),
  })
  .strict()

export type UpdateBlock = z.infer<typeof updateSchema>

export class BlockUpdate implements CommandHandler<UpdateBlock> {
  readonly op = 'block.update'
  readonly schema = updateSchema

  apply(document: Document | null, command: UpdateBlock): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))
    if (command.markdown === undefined && command.aux === undefined) {
      return fail(refusal('CMD011', '고칠 것이 없습니다. markdown 이나 aux 중 하나는 주세요'))
    }

    const found = locate(document, command.at)
    if (isRefusal(found)) return found
    if (!(found.node instanceof Block)) {
      return fail(refusal('CMD008', `블록이 아닙니다: ${command.at}`, { document: document.id }))
    }

    let next = found.node
    if (command.markdown !== undefined) {
      const source = parseBlockSource(command.markdown)
      if (source === null) {
        return fail(refusal('CMD009', '마크다운 조각이 블록 하나가 아닙니다'))
      }
      next = next.with(source)
    }
    if (command.aux !== undefined) {
      next = next.with({ aux: applyAuxPatch(next.aux, command.aux) })
    }

    const updated = replaceAt(document, found.path, next)
    if (updated === null) return fail(refusal('CMD005', '고칠 자리를 찾지 못했습니다'))
    return ok(updated)
  }
}

const removeSchema = z
  .object({ op: z.literal('block.remove'), at: z.string().min(1) })
  .strict()

export type RemoveBlock = z.infer<typeof removeSchema>

export class BlockRemove implements CommandHandler<RemoveBlock> {
  readonly op = 'block.remove'
  readonly schema = removeSchema

  apply(document: Document | null, command: RemoveBlock): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))
    const found = locate(document, command.at)
    if (isRefusal(found)) return found
    if (!(found.node instanceof Block)) {
      return fail(refusal('CMD008', `블록이 아닙니다: ${command.at}`, { document: document.id }))
    }
    const updated = replaceAt(document, found.path, null)
    if (updated === null) return fail(refusal('CMD005', '뺄 자리를 찾지 못했습니다'))
    return ok(updated)
  }
}
