/** 섹션을 규약이 정한 자리에 만든다. */

import { z } from 'zod'
import { Document, Section, parseFragment } from '../../model/index.js'
import { insertAt, orderedInsertIndex, parentAt } from '../tree.js'
import {
  type CommandContext,
  type CommandHandler,
  type CommandResult,
  fail,
  ok,
  refusal,
} from '../command.js'

const ensureSchema = z
  .object({
    op: z.literal('section.ensure'),
    /** 부모 섹션의 조각 주소. 생략하면 문서 바로 아래. */
    at: z.string().min(1).optional(),
    key: z.string().min(1),
  })
  .strict()

export type EnsureSection = z.infer<typeof ensureSchema>

export class SectionEnsure implements CommandHandler<EnsureSection> {
  readonly op = 'section.ensure'
  readonly schema = ensureSchema

  apply(
    document: Document | null,
    command: EnsureSection,
    context: CommandContext,
  ): CommandResult {
    if (document === null) return fail(refusal('CMD004', '고칠 문서가 없습니다'))

    let parentPath: readonly import('../../model/index.js').PathStep[] = []
    if (command.at !== undefined) {
      const fragment = parseFragment(command.at)
      if (fragment === null) {
        return fail(
          refusal('CMD007', `주소 형식이 아닙니다: ${command.at}`, { document: document.id }),
        )
      }
      const found = document.resolve(fragment)
      if (found === null) {
        return fail(
          refusal('CMD005', `그런 노드가 없습니다: ${command.at}`, { document: document.id }),
        )
      }
      parentPath = found.path
    }
    const parent = parentAt(document, parentPath)
    if (parent === null) {
      return fail(refusal('CMD005', `섹션이 아닌 곳에는 섹션을 둘 수 없습니다: ${command.at}`))
    }

    const keyPath = [
      ...parentPath.flatMap((step) => (step.kind === 'section' ? [step.key] : [])),
      command.key,
    ]
    const spec = context.schema.sectionAt(document.type, keyPath)
    if (spec === null) {
      return fail(
        refusal('CMD006', `규약에 없는 섹션입니다: ${keyPath.join('/')}`, {
          document: document.id,
          hint: '규약의 sections 에 먼저 선언하세요',
        }),
      )
    }

    const existing = parent.children.some(
      (child) => child instanceof Section && child.key === command.key,
    )
    if (existing && !spec.repeatable) return ok(document)

    const siblings =
      parentPath.length === 0
        ? context.schema.sectionsOf(document.type)
        : (context.schema.sectionAt(document.type, keyPath.slice(0, -1))?.sections ?? [])
    const order = siblings.map((sibling) => sibling.key)

    const section = new Section({
      key: spec.key,
      heading: spec.heading,
      depth: Math.min(6, parentPath.length + 2),
    })
    const updated = insertAt(
      document,
      parentPath,
      orderedInsertIndex(parent, spec.key, order),
      section,
    )
    if (updated === null) return fail(refusal('CMD005', '섹션을 끼울 자리를 찾지 못했습니다'))
    return ok(updated)
  }
}
