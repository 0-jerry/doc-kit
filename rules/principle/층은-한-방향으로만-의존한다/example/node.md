---
---

<!-- dk: role=counter-example -->
```ts
// src/model/block.ts
import { validateBlock } from '../validate/index.js' // 모델이 검사를 안다
```

```ts
// src/validate/checks/structure.ts
import { Block } from '../../model/index.js' // 검사가 모델을 안다
```
