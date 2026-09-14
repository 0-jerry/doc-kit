/** 보조데이터 부분 선언을 기존 값 위에 얹는다. 선언한 항목만 바뀐다. */

import { type Aux, type Lifecycle, aux as makeAux } from '../model/index.js'
import type { AuxPatch } from './command.js'

const LIFECYCLE_KEYS = ['status', 'since', 'until', 'level'] as const

export function applyAuxPatch(current: Aux, patch: AuxPatch): Aux {
  const lifecycle: Record<string, string> = { ...current.lifecycle }
  for (const key of LIFECYCLE_KEYS) {
    const value = patch[key]
    if (value !== undefined) lifecycle[key] = value
  }

  const role = patch.role ?? current.role

  return makeAux({
    ...(role === undefined ? {} : { role }),
    subject: patch.subject ?? current.subject,
    topic: patch.topic ?? current.topic,
    lifecycle: lifecycle as Lifecycle,
    relations: patch.relations ?? current.relations,
  })
}
