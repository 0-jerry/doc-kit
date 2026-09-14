import { z } from 'zod'
import type { EnforcementRef, RuleMeta } from './types.js'

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const idSchema = z
  .string()
  .regex(ID, 'kebab-case 소문자 식별자여야 합니다 (예: use-camel-case)')

const idList = z.array(idSchema).default([])

/**
 * `swiftlint:type_name` 또는 `{ tool, rule }` 두 표기를 모두 받아
 * 하나의 `EnforcementRef` 로 정규화한다.
 */
const enforcementSchema = z
  .union([
    z.string().min(1),
    z.object({ tool: z.string().min(1), rule: z.string().min(1).optional() }),
  ])
  .transform((value): EnforcementRef => {
    if (typeof value !== 'string') return value
    const [tool, ...rest] = value.split(':')
    const rule = rest.join(':').trim()
    return rule ? { tool: tool!.trim(), rule } : { tool: tool!.trim() }
  })

/** frontmatter 원시 객체를 검증하고 `RuleMeta` 로 정규화하는 스키마. */
export const frontmatterSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1, 'title 은 비어 있을 수 없습니다').max(120),
    summary: z.string().min(1).max(400).optional(),
    category: z
      .string()
      .regex(ID, 'category 는 kebab-case 여야 합니다'),
    severity: z.enum(['error', 'warning', 'info']),
    status: z
      .enum(['proposed', 'active', 'deprecated', 'superseded'])
      .default('active'),
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'since 는 YYYY-MM-DD 형식이어야 합니다')
      .optional(),
    tags: z.array(z.string().regex(ID)).default([]),
    'applies-to': z.array(z.string().min(1)).default([]),
    scope: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
    'enforced-by': z.array(enforcementSchema).default([]),
    extends: idList,
    related: idList,
    conflicts: idList,
    supersedes: idList,
    'superseded-by': idSchema.optional(),
  })
  .strict()
  .transform(
    (v): RuleMeta => ({
      id: v.id,
      title: v.title,
      summary: v.summary,
      category: v.category,
      severity: v.severity,
      status: v.status,
      since: v.since,
      tags: v.tags,
      appliesTo: v['applies-to'],
      scope: v.scope,
      enforcedBy: v['enforced-by'],
      extends: v.extends,
      related: v.related,
      conflicts: v.conflicts,
      supersedes: v.supersedes,
      supersededBy: v['superseded-by'],
    }),
  )

/** 본문에 허용되는 섹션과 그 규약. */
export const SECTION_SPEC = [
  { key: 'rule', heading: 'Rule', required: true },
  { key: 'why', heading: 'Why', required: true },
  { key: 'examples', heading: 'Examples', required: false },
  { key: 'exceptions', heading: 'Exceptions', required: false },
  { key: 'migration', heading: 'Migration', required: false },
  { key: 'references', heading: 'References', required: false },
] as const

export const SECTION_ORDER: string[] = SECTION_SPEC.map((s) => s.key)

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
}
