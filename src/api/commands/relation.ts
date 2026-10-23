/** 노드 사이의 관계 링크를 잇고 끊는다. */

import { z } from 'zod'
import { Document, type Relation, parseAddress } from '../../model/index.js'
import { replaceAt } from '../tree.js'
import { locate } from './block.js'
import {
  type CommandContext,
  type CommandHandler,
  type CommandResult,
  fail,
  ok,
  refusal,
} from '../command.js'

const linkSchema = z
  .object({
    op: z.literal('relation.link'),
    at: z.string().min(1),
    kind: z.string().min(1),
    target: z.string().min(1),
  })
  .strict()

const unlinkSchema = linkSchema.extend({ op: z.literal('relation.unlink') })

export type LinkRelation = z.infer<typeof linkSchema>
export type UnlinkRelation = z.infer<typeof unlinkSchema>

function rewrite(
  document: Document,
  at: string,
  next: (current: readonly Relation[]) => readonly Relation[],
): CommandResult {
  const found = locate(document, at)
  if ('ok' in found) return found

  const relations = next(found.node.aux.relations)
  const aux = { ...found.node.aux, relations }

  if (found.node instanceof Document) return ok(found.node.with({ aux }))
  const updated = replaceAt(document, found.path, found.node.with({ aux }))
  if (updated === null) return fail(refusal('CMD005', '고칠 자리를 찾지 못했습니다'))
  return ok(updated)
}

export class RelationLink implements CommandHandler<LinkRelation> {
  readonly op = 'relation.link'
  readonly schema = linkSchema

  apply(document: Document | null, command: LinkRelation, context: CommandContext): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))

    if (context.schema.relation(command.kind) === null) {
      return fail(
        refusal('CMD014', `규약에 없는 관계입니다: ${command.kind}`, {
          document: document.id,
          hint: `쓸 수 있는 관계: ${context.schema.relationKinds.join(' · ')}`,
        }),
      )
    }
    const address = parseAddress(command.target)
    if (address === null) {
      return fail(
        refusal('CMD015', `관계 대상이 주소 형식이 아닙니다: ${command.target}`, {
          document: document.id,
          hint: '`<컬렉션>/<문서>` 또는 `<컬렉션>/<문서>#<노드>` 로 적으세요',
        }),
      )
    }

    const found = locate(document, command.at)
    if ('ok' in found) return found

    // 링크의 양끝은 안정 주소여야 편집에도 살아남는다.
    if (found.node.stableId === null && !(found.node instanceof Document)) {
      return fail(
        refusal('CMD016', '관계의 출발 노드에 안정 식별자가 없습니다', {
          document: document.id,
          address: command.at,
          hint: '먼저 `<!-- dk: id=… -->` 로 이름을 주세요',
        }),
      )
    }
    // 위치 주소는 다른 편집에 밀려 다른 노드를 가리키게 된다. 다른 문서여도 같다 (REF006).
    if (address.fragment !== null && address.fragment.kind !== 'stable') {
      return fail(
        refusal('CMD016', '관계는 문서나 안정 주소로만 걸 수 있습니다', {
          document: document.id,
          hint: '위치 주소는 편집하면 달라집니다. 대상에 `<!-- dk: id=… -->` 로 이름을 주세요',
        }),
      )
    }
    if (address.document === document.id && address.fragment === null) {
      return fail(
        refusal('CMD016', '같은 문서 안의 링크는 안정 주소로만 걸 수 있습니다', {
          document: document.id,
          hint: '위치 주소는 편집하면 달라집니다',
        }),
      )
    }

    return rewrite(document, command.at, (current) =>
      current.some(
        (relation) => relation.kind === command.kind && relation.target === command.target,
      )
        ? current
        : [...current, { kind: command.kind, target: command.target }],
    )
  }
}

export class RelationUnlink implements CommandHandler<UnlinkRelation> {
  readonly op = 'relation.unlink'
  readonly schema = unlinkSchema

  apply(document: Document | null, command: UnlinkRelation): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))
    return rewrite(document, command.at, (current) =>
      current.filter(
        (relation) => !(relation.kind === command.kind && relation.target === command.target),
      ),
    )
  }
}
