---
---

```ts
const bodyChanged = patch.text !== undefined || patch.source !== undefined
return new Block({ ..., raw: bodyChanged ? null : this.raw })
```
