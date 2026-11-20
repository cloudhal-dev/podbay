---
paths:
  - "workers/auth/**"
  - "workers/routes/**"
  - "workers/mcp/**"
  - "workers/agent/**"
  - "workers/app.ts"
  - "workers/index.ts"
  - "workers/arrival.ts"
  - "workers/lib/original.ts"
  - "workers/lib/messages.ts"
  - "workers/lib/outgoing.ts"
  - "workers/lib/outgoing-message.ts"
  - "workers/lib/tools.ts"
  - "workers/email-sender.ts"
  - "workers/lib/inbound.ts"
  - "workers/lib/filenames.ts"
  - "workers/lib/secrets.ts"
  - "workers/durableObject/**"
  - "app/lib/mail-html.ts"
  - "app/lib/attachments.ts"
  - "app/lib/original.ts"
  - "app/lib/original-text.ts"
  - "app/components/email-panel/OriginalMessage.tsx"
  - "app/components/EmailIframe.tsx"
  - "shared/security-headers.ts"
  - "shared/mail-frame.ts"
  - "shared/attachment-risk.ts"
  - "shared/original.ts"
  - "shared/live.ts"
  - "shared/sending.ts"
  - "shared/rules.ts"
  - "shared/rules-schema.ts"
  - "workers/lib/rule-facts.ts"
  - "packages/platform/log.ts"
  - "packages/contract/**"
  - "packages/*/package.json"
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
- A new route goes into `workers/auth/route-table.ts` with its right; a sensitive one is marked `fresh`, and one that opens a WebSocket is marked `upgrade`.
- Update section 2 of the skill and `docs/status.md` in the same change.
