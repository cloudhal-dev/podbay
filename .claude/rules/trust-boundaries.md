---
paths:
  - "workers/auth/**"
  - "workers/routes/**"
  - "workers/mcp/**"
  - "workers/agent/**"
  - "workers/app.ts"
  - "workers/index.ts"
  - "workers/email-sender.ts"
  - "workers/lib/inbound.ts"
  - "workers/lib/filenames.ts"
  - "workers/lib/secrets.ts"
  - "workers/durableObject/**"
  - "app/lib/mail-html.ts"
  - "app/lib/attachments.ts"
  - "app/components/EmailIframe.tsx"
  - "shared/security-headers.ts"
  - "shared/mail-frame.ts"
  - "shared/attachment-risk.ts"
  - "migrations/**"
  - ".github/**"
  - ".claude/settings.json"
  - ".claude/agents/**"
  - "package.json"
  - "pnpm-workspace.yaml"
---

# This file is on a trust boundary

Load the `podbay-security` skill before you edit, and find the boundary in its section 1.

- A change here ships a regression test that fails without the control (hard rule 7).
- A new route goes into `workers/auth/route-table.ts` with its right; a sensitive one is marked `fresh`.
- Update section 2 of the skill and `docs/status.md` in the same change.
