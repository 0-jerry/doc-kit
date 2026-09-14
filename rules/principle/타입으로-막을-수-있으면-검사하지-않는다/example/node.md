---
---

```ts
// 리프는 자식을 가질 수 없다 — 검사기 대신 타입
export interface Leaf extends Node {
  readonly children?: never
}
```
