/**
 * 검사기를 모으고 실행해 진단을 취합한다. 판정 로직은 하나도 갖지 않는다.
 */

import type { Diagnostic } from '../diagnostic/index.js'
import type { Document } from '../model/index.js'
import type { Schema } from '../schema/index.js'
import { type Check, CheckContext } from './check.js'
import {
  ClosedVocabulary,
  RelationTargetForm,
  StableIdUniqueness,
  StrengthNarrowing,
  SubjectNarrowing,
} from './checks/aux.js'
import {
  AllowedRole,
  FileNameMatchesId,
  KnownDocumentType,
  KnownRole,
  KnownSection,
  RequiredSections,
  RoleForm,
  SectionOrder,
  SectionRepetition,
} from './checks/conformance.js'
import {
  BlockLimit,
  DepthLimit,
  DocumentSizeLimit,
  FanOutLimit,
  SentenceLimit,
} from './checks/structure.js'

/** 기본 검사기 묶음. 각 항목은 원칙 하나에 대응한다. */
export const DEFAULT_CHECKS: readonly Check[] = Object.freeze([
  new KnownDocumentType(),
  new FileNameMatchesId(),
  new RequiredSections(),
  new SectionOrder(),
  new SectionRepetition(),
  new KnownSection(),
  new KnownRole(),
  new AllowedRole(),
  new RoleForm(),
  new SentenceLimit(),
  new BlockLimit(),
  new DepthLimit(),
  new FanOutLimit(),
  new DocumentSizeLimit(),
  new SubjectNarrowing(),
  new ClosedVocabulary(),
  new StrengthNarrowing(),
  new StableIdUniqueness(),
  new RelationTargetForm(),
])

export class CheckRegistry {
  readonly checks: readonly Check[]

  constructor(checks: readonly Check[] = DEFAULT_CHECKS) {
    this.checks = checks
  }

  /** 코드로 걸러낸 사본. 특정 검사만 끄고 싶을 때 쓴다. */
  without(codes: readonly string[]): CheckRegistry {
    const excluded = new Set(codes)
    return new CheckRegistry(this.checks.filter((check) => !excluded.has(check.code)))
  }

  run(document: Document, schema: Schema): readonly Diagnostic[] {
    const context = new CheckContext(schema, document)
    const diagnostics: Diagnostic[] = []

    for (const check of this.checks) {
      if (check.kind === 'document') diagnostics.push(...check.run(context))
    }

    const nodeChecks = this.checks.filter((check) => check.kind === 'node')
    if (nodeChecks.length > 0) {
      // 문서 자신도 보조데이터를 갖는 노드다. 빠뜨리면 frontmatter 가 검사를 피해 간다.
      for (const visit of [document.self(), ...document.walk()]) {
        for (const check of nodeChecks) diagnostics.push(...check.run(visit, context))
      }
    }

    return diagnostics
  }
}

/** 한 문서를 기본 검사기로 검사한다. */
export function validateDocument(document: Document, schema: Schema): readonly Diagnostic[] {
  return new CheckRegistry().run(document, schema)
}
