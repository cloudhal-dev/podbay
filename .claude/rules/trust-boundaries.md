---
paths:
  - "workers/auth/**"
  - "workers/routes/**"
  - "workers/index.ts"
  - "modules/mail/worker/index.ts"
  - "modules/mail/worker/routes/**"
  - "modules/mail/worker/standing.ts"
  - "modules/mail/worker/mcp/**"
  - "modules/mail/worker/agent/**"
  - "workers/app.ts"
  - "modules/mail/worker/router.ts"
  - "modules/mail/worker/arrival.ts"
  - "modules/mail/worker/lib/original.ts"
  - "modules/mail/worker/lib/messages.ts"
  - "modules/mail/worker/lib/outgoing.ts"
  - "modules/mail/worker/lib/outgoing-message.ts"
  - "modules/mail/worker/lib/tools.ts"
  - "modules/mail/worker/email-sender.ts"
  - "modules/mail/shared/inbound.ts"
  - "modules/mail/worker/lib/filenames.ts"
  - "workers/lib/secrets.ts"
  - "modules/mail/worker/durableObject/**"
  - "app/lib/mail-html.ts"
  - "app/lib/attachments.ts"
  - "app/lib/original.ts"
  - "app/lib/original-text.ts"
  - "app/components/email-panel/OriginalMessage.tsx"
  - "app/components/EmailIframe.tsx"
  - "shared/security-headers.ts"
  - "modules/mail/shared/mail-frame.ts"
  - "modules/mail/shared/attachment-risk.ts"
  - "modules/mail/shared/original.ts"
  - "modules/mail/shared/live.ts"
  - "modules/mail/shared/sending.ts"
  - "modules/mail/shared/rules.ts"
  - "modules/mail/shared/rules-schema.ts"
  - "modules/mail/worker/lib/rule-facts.ts"
  - "packages/platform/log.ts"
  - "packages/contract/**"
  - "packages/*/package.json"
  - "modules/*/package.json"
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
