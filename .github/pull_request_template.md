## What and why

<!-- One or two sentences. Link the issue or RFC if there is one. -->

## Checklist

- [ ] `pnpm check` and `pnpm test:workerd` are green.
- [ ] **Original work.** Nothing here comes from another mail product: no code, schema, test, text, translation or asset. No dependency under AGPL or GPL.
- [ ] If this touches a trust boundary (sign-in, authorisation, mail rendering, attachments, the sender check, the agent or MCP, tokens, exports, CI or releases), it ships a regression test, and I say which one below.
- [ ] If this relies on a Cloudflare fact (a limit, a binding, an API, a plan requirement), the current source and the date I read it are in the change.
- [ ] Commits are conventional and signed off (`git commit -s`).
- [ ] If this changes anything under `app/`: pictures of each changed screen at desktop and phone width, in the light and the dark theme, are below, or I say why there is nothing to see.
