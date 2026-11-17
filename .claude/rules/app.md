---
paths:
  - "app/**"
  - "index.html"
  - "public/**"
---

# This is the app

Load the `podbay-ui` skill before you edit.

- No markup is injected anywhere but the mail frame; the page runs under a strict content policy.
- The Worker decides; the app only shows. A sensitive change goes through `useFreshProof()`.
- `public/_headers` is generated: change `shared/security-headers.ts`, then run `node scripts/checks/headers.ts --write`.
