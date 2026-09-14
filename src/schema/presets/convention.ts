/** 컨벤션 프리셋 — "이 프로젝트에서는 이렇게 쓴다"를 남기는 문서. */
export const convention = {
  version: 1,
  extends: 'preset/principle',
  collections: { convention: 'convention' },
  documentTypes: {
    convention: {
      description: '합의된 작성 방식. 원칙보다 자주 바뀐다.',
      order: 'strict',
      maxDepth: 3,
      sections: [
        { key: 'rule', heading: '규약', required: true, defaultRole: 'norm', maxBlocks: 2 },
        { key: 'rationale', heading: '근거', required: true, defaultRole: 'rationale' },
        { key: 'example', heading: '예시', defaultRole: 'example' },
        { key: 'counter-example', heading: '반례', defaultRole: 'counter-example' },
        { key: 'exception', heading: '예외', defaultRole: 'exception' },
      ],
    },
  },
}
