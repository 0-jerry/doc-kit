/**
 * 저작 규약 선언의 형식. 문서 타입·섹션·역할·어휘·관계를 사용자가 선언한다.
 * 이 파일은 "무엇을 쓸 수 있는가"만 정의하고, 검사도 해석도 하지 않는다.
 */

import { z } from 'zod'
import { isSectionKey, isWellFormedSegment } from '../model/index.js'

const name = z
  .string()
  .refine(isWellFormedSegment, '주소 문법과 충돌하는 문자가 있습니다 (공백 · # / ~ [ ])')

const sectionKey = z
  .string()
  .refine(isSectionKey, '섹션 키는 주소 문법과 충돌할 수 없고 숫자로만 이뤄질 수 없습니다')

const blockForm = z.enum(['paragraph', 'list', 'code', 'table', 'quote', 'other'])

export interface SectionSpec {
  key: string
  heading: string
  /** 같은 섹션을 가리키는 다른 제목들. 문서를 옮겨올 때 쓴다. */
  aliases: string[]
  required: boolean
  /** 같은 키의 섹션을 여러 번 쓸 수 있는가. */
  repeatable: boolean
  /** 이 섹션 안 블록이 별도 선언 없이 갖는 역할. */
  defaultRole?: string | undefined
  /** 허용 역할. 생략하면 제한하지 않는다. */
  allowedRoles?: string[] | undefined
  /** 직속 블록 수 상한 (원칙 P4, 오류). */
  maxBlocks?: number | undefined
  /** 중첩 섹션. */
  sections: SectionSpec[]
}

export const sectionSpecSchema: z.ZodType<SectionSpec, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      key: sectionKey,
      heading: z.string().min(1),
      aliases: z.array(z.string().min(1)).default([]),
      required: z.boolean().default(false),
      repeatable: z.boolean().default(false),
      defaultRole: name.optional(),
      allowedRoles: z.array(name).optional(),
      maxBlocks: z.number().int().positive().optional(),
      sections: z.array(sectionSpecSchema).default([]),
    })
    .strict(),
)

export const documentTypeSchema = z
  .object({
    description: z.string().optional(),
    sections: z.array(sectionSpecSchema).default([]),
    /** `strict` 면 선언된 순서를 지켜야 한다. */
    order: z.enum(['strict', 'any']).default('strict'),
    /** 트리 깊이 상한 (원칙 P6, 오류). 문서를 1 로 센다. */
    maxDepth: z.number().int().positive().default(3),
  })
  .strict()

export const roleSchema = z
  .object({
    description: z.string().optional(),
    /** 이 역할이 쓸 수 있는 블록 형태. 생략하면 제한하지 않는다. */
    forms: z.array(blockForm).optional(),
    /** 문장 수 상한 (원칙 P3, 경고). */
    maxSentences: z.number().int().positive().optional(),
  })
  .strict()

export const vocabularySchema = z
  .object({
    description: z.string().optional(),
    /** 닫힌 어휘면 목록 밖의 값을 쓸 수 없다 (원칙 P8, 오류). */
    closed: z.boolean().default(false),
    values: z.array(z.string().min(1)).default([]),
    /**
     * `values` 의 순서가 강도 순인가. 앞이 강하다.
     * 자손이 조상보다 강한 값을 주장하지 못하게 하는 데 쓴다.
     */
    ordered: z.boolean().default(false),
    /** 외부 목록 파일 경로. 로더가 읽어 `values` 에 합친다. */
    source: z.string().min(1).optional(),
    /**
     * 값 → 파일 경로 글롭. 어떤 파일이 어떤 대상인지는 어휘가 소유한다 —
     * 도구는 프로젝트의 경로 규칙을 모른다.
     */
    paths: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  })
  .strict()

export const relationSchema = z
  .object({
    description: z.string().optional(),
    /** 양방향이어야 하는가. */
    symmetric: z.boolean().default(false),
    /** 순환을 금지하는가 (원칙 P11, 오류). */
    acyclic: z.boolean().default(false),
    /** 짝이 되는 반대 관계의 이름. */
    inverse: name.optional(),
  })
  .strict()

export const limitsSchema = z
  .object({
    /** 형제 수 상한 (원칙 P9, 경고). */
    maxChildren: z.number().int().positive().default(9),
    /** 문서 전체 블록 수 상한 (경고). */
    maxBlocksPerDocument: z.number().int().positive().default(60),
  })
  .strict()
  .default({})

export const declarationSchema = z
  .object({
    version: z.literal(1),
    /** 상속할 선언. 프리셋 이름(`preset/…`) 또는 상대 경로. */
    extends: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    /** 디렉터리 이름 → 문서 타입. */
    collections: z.record(name, name).default({}),
    documentTypes: z.record(name, documentTypeSchema).default({}),
    roles: z.record(name, roleSchema).default({}),
    /** `subject` `topic` `status` `level` 네 어휘를 선언한다. */
    vocabularies: z.record(name, vocabularySchema).default({}),
    relations: z.record(name, relationSchema).default({}),
    limits: limitsSchema,
  })
  .strict()

export type Declaration = z.infer<typeof declarationSchema>
export type DocumentTypeSpec = z.infer<typeof documentTypeSchema>
export type RoleSpec = z.infer<typeof roleSchema>
export type VocabularySpec = z.infer<typeof vocabularySchema>
export type RelationSpec = z.infer<typeof relationSchema>
export type Limits = z.infer<typeof limitsSchema>
export type BlockFormName = z.infer<typeof blockForm>
