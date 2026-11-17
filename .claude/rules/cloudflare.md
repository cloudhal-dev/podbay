---
paths:
  - "wrangler.jsonc"
  - "docs/cloudflare/**"
  - "vite.config.ts"
  - "workers/lib/models.ts"
  - "workers/types.ts"
---

# This is a Cloudflare surface

Load the `podbay-cloudflare` skill before you edit.

- Every fact about the platform comes from its current source, read today, and gets an entry in `docs/cloudflare/ledger.json` in the same change. Never from memory.
- A binding, a Durable Object class or a table name is sticky: changing one is a decision (an ADR first).
