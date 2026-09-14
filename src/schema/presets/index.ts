import { convention } from './convention.js'
import { decision } from './decision.js'
import { principle } from './principle.js'

/** 이름 → 원시 선언. 로더가 `extends: preset/…` 를 여기서 찾는다. */
export const PRESETS: Readonly<Record<string, unknown>> = Object.freeze({
  'preset/principle': principle,
  'preset/convention': convention,
  'preset/decision': decision,
})

export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS)
