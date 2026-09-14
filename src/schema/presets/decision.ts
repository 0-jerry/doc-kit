/** 결정 기록 프리셋 — "그때 왜 그렇게 정했는가"를 남기는 문서. */
export const decision = {
  version: 1,
  extends: 'preset/principle',
  collections: { decision: 'decision' },
  documentTypes: {
    decision: {
      description: '한 시점의 선택과 그 대가. 나중에 뒤집을 때 근거가 된다.',
      order: 'strict',
      maxDepth: 3,
      sections: [
        { key: 'context', heading: '맥락', required: true, defaultRole: 'note' },
        { key: 'decision', heading: '결정', required: true, defaultRole: 'norm', maxBlocks: 2 },
        { key: 'rationale', heading: '근거', required: true, defaultRole: 'rationale' },
        { key: 'consequence', heading: '대가', required: true, defaultRole: 'note' },
        { key: 'alternative', heading: '대안', defaultRole: 'note' },
      ],
    },
  },
}
