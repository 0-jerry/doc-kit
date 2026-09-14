/** 노드를 같은 문서 안에서 옮긴다. */

import { z } from 'zod'
import {
  type Child,
  Document,
  type PathStep,
  Section,
  type Visit,
  resolveAux,
  widenedSubjects,
} from '../../model/index.js'
import { insertAt, replaceAt } from '../tree.js'
import { locate } from './block.js'
import { type CommandHandler, type CommandResult, fail, ok, refusal } from '../command.js'

const moveSchema = z
  .object({
    op: z.literal('node.move'),
    at: z.string().min(1),
    /** 새 부모 섹션의 주소. 빈 문자열은 문서 바로 아래를 뜻한다. */
    to: z.string(),
    position: z
      .union([z.literal('start'), z.literal('end'), z.number().int().min(0)])
      .default('end'),
  })
  .strict()

export type MoveNode = z.infer<typeof moveSchema>

/** 한 경로가 다른 경로 아래에 있는가. 자기 자손으로 옮기는 것을 막는 데 쓴다. */
function isUnder(inner: readonly PathStep[], outer: readonly PathStep[]): boolean {
  if (inner.length < outer.length) return false
  return outer.every((step, index) => {
    const other = inner[index]!
    if (step.kind !== other.kind) return false
    return step.kind === 'index'
      ? step.index === (other as typeof step).index
      : step.key === (other as typeof step).key &&
          step.occurrence === (other as typeof step).occurrence
  })
}

function indexIn(position: MoveNode['position'], children: readonly Child[]): number {
  if (position === 'start') return 0
  if (position === 'end') return children.length
  return position
}

export class NodeMove implements CommandHandler<MoveNode> {
  readonly op = 'node.move'
  readonly schema = moveSchema

  apply(document: Document | null, command: MoveNode): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))

    const source = locate(document, command.at)
    if ('ok' in source) return source
    if (source.node instanceof Document) {
      return fail(refusal('CMD012', '문서 자신은 옮길 수 없습니다'))
    }
    const moving = source.node as Child

    const target = this.#target(document, command)
    if ('ok' in target) return target

    if (isUnder(target.path, source.path)) {
      return fail(
        refusal('CMD012', '노드를 자기 자신이나 자손 아래로 옮길 수 없습니다', {
          document: document.id,
        }),
      )
    }

    // 옮긴 자리에서 대상이 넓어지면 안 된다 (원칙 P7).
    const widened = widenedSubjects(target.aux, moving.aux)
    if (widened.length > 0) {
      return fail(
        refusal('CMD013', `새 부모가 다루지 않는 대상입니다: ${widened.join(' · ')}`, {
          document: document.id,
          hint: '옮기기 전에 대상을 좁히거나 새 부모의 subject 를 먼저 넓히세요',
        }),
      )
    }

    const index = indexIn(command.position, target.children)
    const detached = replaceAt(document, source.path, null)
    if (detached === null) return fail(refusal('CMD005', '옮길 노드를 떼지 못했습니다'))

    // 뗀 뒤라 자리가 밀렸을 수 있으므로 대상을 다시 찾는다.
    const after = this.#target(detached, command)
    if ('ok' in after) return after

    const moved = insertAt(detached, after.path, index, moving)
    if (moved === null) return fail(refusal('CMD005', '옮길 자리를 찾지 못했습니다'))
    return ok(moved)
  }

  /** 새 부모를 찾는다. 빈 주소는 문서 자신이다. */
  #target(
    document: Document,
    command: MoveNode,
  ):
    | CommandResult
    | {
        readonly path: readonly PathStep[]
        readonly children: readonly Child[]
        readonly aux: ReturnType<typeof resolveAux>
      } {
    if (command.to === '') {
      return { path: [], children: document.children, aux: document.aux }
    }
    const found: Visit | CommandResult = locate(document, command.to)
    if ('ok' in found) return found
    if (!(found.node instanceof Section)) {
      return fail(
        refusal('CMD008', `섹션이 아닌 곳으로는 옮길 수 없습니다: ${command.to}`, {
          document: document.id,
        }),
      )
    }
    return {
      path: found.path,
      children: found.node.children,
      aux: resolveAux([...found.ancestors.map((node) => node.aux), found.node.aux]),
    }
  }
}
