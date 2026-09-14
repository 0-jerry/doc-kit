/** 문서 자체를 만들고 고치는 명령들. */

import { z } from 'zod'
import {
  Document,
  EMPTY_AUX,
  formatDocumentId,
  isWellFormedSegment,
} from '../../model/index.js'
import { applyAuxPatch } from '../aux-patch.js'
import {
  type CommandContext,
  type CommandHandler,
  type CommandResult,
  auxPatchSchema,
  fail,
  ok,
  refusal,
} from '../command.js'

const createSchema = z
  .object({
    op: z.literal('document.create'),
    collection: z.string().min(1),
    name: z.string().min(1),
    /** 생략하면 컬렉션이 정한 타입을 쓴다. */
    type: z.string().min(1).optional(),
    aux: auxPatchSchema.optional(),
  })
  .strict()

export type CreateDocument = z.infer<typeof createSchema>

export class DocumentCreate implements CommandHandler<CreateDocument> {
  readonly op = 'document.create'
  readonly schema = createSchema
  readonly creates = true

  apply(
    document: Document | null,
    command: CreateDocument,
    context: CommandContext,
  ): CommandResult {
    if (document !== null) {
      return fail(refusal('CMD001', '이미 있는 문서 위에 새 문서를 만들 수 없습니다'))
    }
    if (!isWellFormedSegment(command.collection) || !isWellFormedSegment(command.name)) {
      return fail(
        refusal('CMD002', '컬렉션과 이름에 주소 문법과 충돌하는 문자를 쓸 수 없습니다', {
          hint: '공백 · # / ~ [ ] 를 뺀 이름을 쓰세요',
        }),
      )
    }

    const type = command.type ?? context.schema.typeForCollection(command.collection)
    if (type === null || type === undefined) {
      return fail(
        refusal('CMD003', `컬렉션 '${command.collection}' 의 문서 타입을 알 수 없습니다`, {
          hint: 'type 을 함께 주거나 규약의 collections 에 더하세요',
        }),
      )
    }
    if (context.schema.documentType(type) === null) {
      return fail(
        refusal('CMD003', `규약에 없는 문서 타입입니다: ${type}`, {
          hint: `쓸 수 있는 타입: ${context.schema.documentTypeNames.join(' · ')}`,
        }),
      )
    }

    const id = formatDocumentId(command.collection, command.name)
    return ok(
      new Document({
        id,
        type,
        path: `${command.collection}/${command.name}.md`,
        aux: command.aux === undefined ? EMPTY_AUX : applyAuxPatch(EMPTY_AUX, command.aux),
      }),
    )
  }
}

const setAuxSchema = z
  .object({
    op: z.literal('document.setAux'),
    aux: auxPatchSchema,
  })
  .strict()

export type SetDocumentAux = z.infer<typeof setAuxSchema>

export class DocumentSetAux implements CommandHandler<SetDocumentAux> {
  readonly op = 'document.setAux'
  readonly schema = setAuxSchema

  apply(document: Document | null, command: SetDocumentAux): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))
    return ok(document.with({ aux: applyAuxPatch(document.aux, command.aux) }))
  }
}
