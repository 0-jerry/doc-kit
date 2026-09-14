/**
 * 원칙 프리셋 — "왜 그렇게 판단하는가"를 남기는 문서.
 * 사용자 선언과 같은 형식이며 특별 취급을 받지 않는다.
 */
export const principle = {
  version: 1,
  collections: { principle: 'principle' },
  documentTypes: {
    principle: {
      description: '지속되는 판단 근거. 상황이 바뀌어도 잘 변하지 않는 것.',
      order: 'strict',
      maxDepth: 3,
      sections: [
        { key: 'norm', heading: '기준', required: true, defaultRole: 'norm', maxBlocks: 3 },
        { key: 'rationale', heading: '근거', required: true, defaultRole: 'rationale' },
        { key: 'example', heading: '예시', defaultRole: 'example' },
        { key: 'exception', heading: '예외', defaultRole: 'exception' },
      ],
    },
  },
  roles: {
    norm: {
      description: '지켜야 할 것을 말하는 규범 진술.',
      forms: ['paragraph', 'list'],
      maxSentences: 3,
    },
    rationale: { description: '왜 그런지에 대한 설명.' },
    example: { description: '따른 경우.', forms: ['code', 'quote', 'paragraph'] },
    'counter-example': { description: '어긴 경우.', forms: ['code', 'quote', 'paragraph'] },
    exception: { description: '적용하지 않는 경우.' },
    note: { description: '어느 쪽도 아닌 보충.' },
  },
  vocabularies: {
    subject: { description: '적용 대상.', closed: false },
    topic: { description: '주제.', closed: false },
    status: {
      description: '수명주기. 앞이 더 강하게 적용된다.',
      closed: true,
      ordered: true,
      values: ['active', 'proposed', 'deprecated', 'superseded'],
    },
    level: {
      description: '강제 수준. 앞이 강하다.',
      closed: true,
      ordered: true,
      values: ['must', 'should', 'may'],
    },
  },
  relations: {
    refines: { description: '더 좁은 상황으로 구체화한다.', acyclic: true },
    conflicts: { description: '동시에 만족시킬 수 없다.', symmetric: true },
    supersedes: { description: '대체한다.', acyclic: true, inverse: 'superseded-by' },
    'superseded-by': { description: '대체되었다.', acyclic: true, inverse: 'supersedes' },
    references: { description: '참고한다.' },
  },
  limits: { maxChildren: 9, maxBlocksPerDocument: 60 },
}
