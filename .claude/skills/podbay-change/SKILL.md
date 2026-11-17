---
name: podbay-change
description: How a change is made in Podbay, from the first read to the commit. Use it at the start of ANY task that edits code, tests, migrations, configuration or documents in this repository - a feature, a fix, a refactor, a dependency update, a round of work - and whenever you are about to commit, are about to write or change a decision (ADR), or are unsure what "done" means here.
---

# How a change is made here

Podbay stores other people's mail. The way of working is part of the product: every rule has a check, every claim in a document is true today, and a change is done when it is proven, not when it compiles.

## 1. Before the first edit

1. Read [`AGENTS.md`](../../../AGENTS.md) (the hard rules), [`docs/roadmap.md`](../../../docs/roadmap.md) (where the project is going and what comes next) and [`docs/status.md`](../../../docs/status.md) (what is enforced, what is open).
2. Find which skills the change needs, and load them before editing:

   | The change touches | Load |
   |---|---|
   | A trust boundary: sign-in, authorisation, mail rendering, attachments, the sender, the agent and MCP, tokens, CI, dependencies | [`podbay-security`](../podbay-security/SKILL.md) |
   | Anything under `app/` | [`podbay-ui`](../podbay-ui/SKILL.md) |
   | `wrangler.jsonc`, a binding, a limit, a compatibility date or flag, or any statement about how Cloudflare behaves | [`podbay-cloudflare`](../podbay-cloudflare/SKILL.md) |
   | Any test, or code that needs one | [`podbay-testing`](../podbay-testing/SKILL.md) |

3. Ask whether it is a **decision**. A change to something an ADR decided, to a contract, to a persisted format or to a sticky name (a binding, a Durable Object class, a table, a route other programs call) is not an edit: write an ADR in [`docs/adr/`](../../../docs/adr/README.md) with status **Proposed** and say so in your report. Only the project lead accepts an ADR. Build on a proposed decision only when the work is easy to undo.
4. Say in one or two sentences what will change and what must stay as it is. If you cannot, read more.

## 2. The order of work

1. **Core first.** The pure function or the Worker code, with its unit and Workers-runtime tests. Then the app. Then the browser.
2. **Prove the control.** A test for a rule must fail when the control is taken out. Try that at least once for a boundary test.
3. **Run what CI runs**: `pnpm check`, then `pnpm test:workerd`, then `pnpm e2e` when the change can be seen in a browser. Read the result; a failed run is reported with its output, not retried until green.
4. **Try it for real** when it has a screen: the built app on a throwaway instance (`pnpm e2e` does this; by hand, `PODBAY_STATE_DIR=<dir> PODBAY_OFFLINE=1 pnpm exec vite preview`). Development mode serves no content policy, so it proves nothing about one.
5. **Keep the records true, in the same change:**

   | When you | Update |
   |---|---|
   | Add a check, or close a gap | [`docs/status.md`](../../../docs/status.md) section 1, 2 or 3 |
   | Move a boundary or add a proof | Section 2 of `podbay-security` |
   | Rely on a Cloudflare fact | `docs/cloudflare/ledger.json` |
   | Edit a file that came from the seed | `node scripts/checks/copies.ts --fix` |
   | Remove lint warnings or shrink an oversized file | `node scripts/checks/ratchets.ts --update` (it only ever goes down) |
   | Finish or reorder roadmap work | [`docs/roadmap.md`](../../../docs/roadmap.md) |
   | Add a dependency | An exact version at least three days old (`node scripts/pins.ts --resolve <name>`); a 0.x one needs a dated `pinExceptions` entry |

6. **Commit.** Conventional commits, signed off (`git commit -s`). Code with its tests in one commit, documents in another when both are large. Add files by explicit path, then read `git show --stat` of each commit: a commit must contain what its message says. Never push, publish, deploy or open a pull request unless asked.

## 3. Done means

- [ ] The rule the change is about has an automated check, and that check was seen to fail without the change.
- [ ] `pnpm check` and `pnpm test:workerd` pass; `pnpm e2e` passes when a browser can see the change.
- [ ] No ratchet went up, no check was skipped, no test was weakened to pass.
- [ ] Every document that describes the changed thing is true again, and nothing planned is described as existing.
- [ ] What was not done, not verified, or decided on your own is written in the report, first.

## 4. The developer's machine

- **`.wrangler/state` is the developer's local data** (their account, their test mail). Never delete, reset or migrate it by hand. Use a throwaway state directory for experiments.
- **Secrets stay unread.** Do not print or quote `.dev.vars`. Tests and scripts generate their own values per run.
- **Nothing leaves the machine**: no model call, no real mail, no Cloudflare account (rule D7). Optional features stay off unless the task is about them.
- **Throwaway accounts and data** made for a check are removed afterwards, and the report says they were made.
- The development server uses port 5173; the browser tests use 4174 and 4175. Do not start a second server on a port in use.

## 5. The report

Lead with what is now true and how it was proven. Then, in this order: what failed or was not verified; decisions you took that the lead has not seen; defects you found on the way, each with what you did about it. Do not report a control you planned as one that exists.

## 6. Never

- Raise a ratchet, skip a check, or loosen a test to get a green run.
- Mark an ADR accepted, or change an accepted one (write a new one that supersedes it).
- Name another mail product in this repository, or bring code, schema, text or assets from one.
- Add a dependency under AGPL or GPL, or edit the vendored `security-audit` skill.
- State a Cloudflare fact from memory.
