/**
 * `extends` 로 이어진 선언들을 하나로 합친다.
 *
 * 병합은 **키 단위 교체**다. 문서 타입·역할·어휘·관계는 같은 이름이 있으면
 * 자식 선언이 통째로 이긴다. 섹션 목록을 부분 병합하지 않는 것은 의도다 —
 * 반쯤 겹친 섹션 목록이 어떤 순서로 합쳐졌는지 추적하는 비용이 재선언 비용보다 크다.
 */

/** 선언의 원시 형태. zod 를 통과하기 전이므로 아직 아무것도 보장되지 않는다. */
export type RawDeclaration = Record<string, unknown>

const BY_KEY = ['collections', 'documentTypes', 'roles', 'vocabularies', 'relations'] as const

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function mergePair(base: RawDeclaration, child: RawDeclaration): RawDeclaration {
  const merged: RawDeclaration = { ...base, ...child }

  for (const key of BY_KEY) {
    if (base[key] === undefined && child[key] === undefined) continue
    merged[key] = { ...asRecord(base[key]), ...asRecord(child[key]) }
  }

  if (base['limits'] !== undefined || child['limits'] !== undefined) {
    merged['limits'] = { ...asRecord(base['limits']), ...asRecord(child['limits']) }
  }

  // `extends` 는 이미 해소된 뒤이므로 결과에 남기지 않는다.
  delete merged['extends']
  return merged
}

/** 기반부터 순서대로 얹는다. 뒤에 오는 선언이 이긴다. */
export function mergeDeclarations(layers: readonly RawDeclaration[]): RawDeclaration {
  return layers.reduce<RawDeclaration>((base, child) => mergePair(base, child), {})
}
