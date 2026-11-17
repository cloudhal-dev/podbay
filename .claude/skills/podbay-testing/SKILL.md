---
name: podbay-testing
description: How Podbay is tested - the three tiers (unit in Node, handlers in the real Workers runtime, the built app in a real browser), which tier proves what, the helpers that exist, and the rules a test must keep. Use it whenever you write, change, debug or review a test, add code that needs one, see a failing or flaky test, or need to drive the app in a browser or deliver a test message.
---

# Testing Podbay

A rule without an automated check is not a rule. Tests here are the checks: they are written as statements of the rule, and they are trusted, so they must not lie.

## 1. The tiers

| Tier | Where | Runs in | Use it for | Command |
|---|---|---|---|---|
| 0 | `test/unit/` | Node (Vitest) | Pure functions, tables and lists that must not drift, the mail renderer (jsdom), the static checks | `pnpm test` |
| 3 | `test/workerd/`, `test/workerd-agent/` | The real Workers runtime, every binding local | Routes, the guard, sign-in, D1 and Durable Object behaviour, headers, anything about who may do what | `pnpm test:workerd` |
| 6 | `test/e2e/` | The built app in the installed Chrome | What only a browser can show: content policies, the mail frame, downloads, WebAuthn, whole journeys | `pnpm e2e` |

Put a test in the lowest tier that can prove the rule. A rule about access is proven at tier 3 even when a tier 6 journey also passes through it.

## 2. What exists already

**Tier 3, `test/workerd/helpers.ts`:** `migrate`, `setupOwner`, `seedUser`, `seedMembership`, `signIn`, `request` (sends the app's own `Origin`), `createMailbox`, `mime` and `inbound` (a message for the `email` handler), `ageSessions` (make a session old instead of waiting), and `Browser`: a cookie-keeping client with a client address of its own, so the per-address sign-in limits do not couple tests. `enableApp`, `registerPasskey` and `passkeySignIn` do the second step and passkeys as a person's devices do.

**Doubles, `test/helpers/`:** `authenticator.ts` (a software passkey that makes real attestations and signatures, and `totpCode`), `fake-ai.ts` (the model; no test ever calls a real one).

**Tier 6, `test/e2e/fixtures.ts`:** the `app` fixture gives a page that is watched from outside. `app.signIn()` uses the run's one session; `app.deliver(mime(...))` delivers a message; `app.openMessage(subject)` returns the mail frame; `app.contacted()` is every host the browser tried to reach; `app.seen()` and `app.frameViolations(frame)` are policy violations and messages; `app.watch` has dialogs, new windows and errors. `scripts/e2e-server.ts` builds the app and serves it on a throwaway instance with secrets of its own.

## 3. Rules for a test

1. **Name it as the rule**, in plain words: "a reader sees the members and changes nothing". A person reading only the test names should learn what the product promises.
2. **Test the refusal.** For every allowed case there is a refused one: without a session, as a non-member, from another origin, with a stale session, with a used token.
3. **It must be able to fail.** Take the control out once and watch the test fail. A test that cannot fail is worse than none.
4. **Uniform answers are asserted as equal**: an unknown, a used and an expired token give byte-identical answers.
5. **Pinned lists change on purpose.** The public routes, the routes that need fresh proof, the MCP tools and the sandbox tokens are written out in tests. When one fails, decide whether the list should change; do not edit it to match.
6. **No secret is asserted, printed or stored.** Assert that a token is absent from the database, not what it is.
7. **Nothing leaves the machine**: no model, no real mail, no network. In the browser, `app.contacted()` must stay empty unless the test is about a request the reader allowed.
8. **Do not wait for time.** Age the data (`ageSessions`), or drop the cached copy of a session (`browser.forget("session_data")`).
9. **A test does not depend on the developer's machine.** Feature flags and secrets are stated by the test configuration, never taken from `.dev.vars`.

## 4. Things that will surprise you

- **Sign-in is limited per client address** (ten a minute). At tier 3 give each test its own `Browser`; at tier 6 use `app.signIn()`, and sign in through the page only in a test about signing in.
- **The session is cached in a cookie for a minute.** A route marked fresh reads the database; other routes may still see the cached copy.
- **The mail frame runs in a process of its own in Chrome.** Requests from inside it can be invisible to the browser's request events, so "nothing left" is asked of the proxy (`app.contacted()`), never of `page.on("request")`.
- **The frame element is replaced when its document changes.** Use locators (`page.frameLocator(...)`), which follow it; a handle goes stale.
- **While the sanitiser parses a hostile message the page reports two kinds of policy violation** (an event handler attribute, a `<base>`). Nothing ran; the hostile-mail tests accept exactly those two.
- **Development mode serves no content policy.** Anything about a policy is tested on the built app.

## 5. When a test fails

Read the failure before changing anything. Decide which is wrong: the code, the test, or the rule. If the rule is wrong, that is a decision ([`podbay-change`](../podbay-change/SKILL.md), section 1). Report a test you could not make pass, with its output; never delete or skip it to finish.
