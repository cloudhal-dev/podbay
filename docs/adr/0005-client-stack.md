# ADR-0005: The client stays a single-page app on one JSON API; TanStack Start and Exact are not adopted now

- Status: **Proposed** (awaits the project lead)
- Date: 2026-11-17
- Sources: read on 2026-11-17 and listed at the end. Each finding below was read in the project's own documentation, repository or registry entry on that day.

## Context

Podbay's client is a React single-page app: TanStack Router with code-based routes, TanStack Query, Kumo components, built by Vite and served as static assets. It talks to one JSON API in the Worker. Two alternatives were put forward and looked at:

- **TanStack Start**, the full-stack framework on top of TanStack Router. Its first stable release is `@tanstack/react-start` 1.169 (13 October 2026).
- **Exact**, a cross-platform application runtime from Expo, previewed on 9 November 2026. Interfaces are written in its own typed language and run on the web and natively (iOS, macOS; Android, Windows and Linux earlier in their work).

What a client stack has to give Podbay, whatever it is:

1. **A strict content policy that is one static header.** The page loads its own code only; the single inline script is named by hash ([`shared/security-headers.ts`](../../shared/security-headers.ts)).
2. **The mail frame.** A stranger's HTML is shown sanitised, in a sandboxed `srcdoc` frame without an origin.
3. **Deny by default, in one table.** Every way into the Worker is listed with the right it needs, and a test enumerates them.
4. **Exact pins of stable releases**, with a written exception for anything below 1.0.
5. **Everything tested in three tiers**, without an account and without a network.

The app has no public page: everything is behind sign-in, so nothing is gained from search engines or from rendering on the server for visitors.

## Findings

### TanStack Start

| For | Against |
|---|---|
| Rendering on the server, streaming, typed calls from the client to server functions | **File-based routing only.** Code-based routes are not supported (the request was closed as not planned), so every route would be rewritten |
| An official Cloudflare setup; a custom Worker entry can keep Durable Objects and other handlers | **Rendering on the server ends the static policy.** It writes inline scripts that differ per request; they need a nonce, so the policy becomes a header made per request. The nonce option is not in the documentation and has open defects |
| Stable since October 2026 | **A second way into the Worker.** Server functions sit beside the API, are guarded function by function, and no list of them is documented for the route-table test |
| | Two security advisories in its server-function layer in 2026; a dependency below 1.0 (`@tanstack/react-start-rsc` 0.1) arrives with it |
| | No documented way to test its server side in the Workers runtime |
| | Its single-page mode costs the same rewrite and adds only the server functions |
| | Rendering on the server is a Worker request in the user's account for something static assets do for free |

### Exact

| For | Against |
|---|---|
| One source for the web and native hosts; iOS and macOS are its most complete | **"Exact is pre-1.0 and changes daily. There is no API stability, no backwards compatibility, and no migration guide, by design."** No release, tag or package exists, so there is nothing to pin |
| The web target drives the real DOM with a small runtime; accessibility through HTML elements | **No React tier.** It cannot be adopted a part at a time: the components, the router, the queries and the editor would all be replaced |
| A passkey package; tooling that lets an agent drive and test an app on every host | **The mail frame cannot be written in it today.** An author-facing `srcdoc` is withheld and its `iframe` has no sandbox attribute; the reader would stay a hand-written page outside the framework |
| MIT | Its web runtime needs inline styles allowed in the page's policy, and WebAssembly evaluation for several features |
| | Rich text editing is Markdown; there is no editor for HTML mail |
| | Almost all of it is written by one person; the design record is private; the agent tooling is not usable apart from it |

## Decision

1. **The web client stays as it is**: a React single-page app on TanStack Router and Query, served as static assets.
2. **The JSON API is the only contract between a client and the Worker.** No server surface is added that belongs to one client framework. This keeps one route table, and it is what makes any later client possible, a native one included, without touching the web app.
3. **TanStack Start is not adopted.** It is looked at again on the triggers below.
4. **Exact is not adopted for the web client.** It is the first candidate to look at when the project decides to build a native client. That is a decision about scope and is not taken here: a native client is not in phase A, and it needs sign-in for apps, which is phase B. When that time comes the first step is a short, time-boxed trial of the one thing that decides it: showing a hostile message safely on a phone.
5. **Ideas may be borrowed without the dependency**: a clock owned by the test, and assertions on the accessibility tree, fit the browser tests Podbay already has.
6. **The triggers are read again at the end of each milestone**, and the result is written into the [roadmap](../roadmap.md).

## Triggers

Look at **TanStack Start** again when one of these is true:

- Podbay gets a page that is public or must load without a session (a shared link, a landing page).
- First load is measured to be a problem that splitting the code does not fix.
- TanStack Router stops supporting code-based routes, or Start begins to.
- Start documents a content policy without inline scripts, or a supported nonce, with the open defects closed.

Look at **Exact** again when one of these is true:

- It has a first tagged release with a statement about stability and a packaged tool.
- Its `iframe` gets an author-facing `srcdoc` and a sandbox, on the web and natively.
- Its web runtime works under a policy without inline styles.
- It gets a React tier or a way to embed it in an existing web app.
- It gets an editor for HTML.
- The project decides to build a native client.

## Consequences

- No work is spent on a rewrite. The rounds on the [roadmap](../roadmap.md) go on.
- The rules that depend on the client's shape (the static policy, the mail frame, the route table) stay as they are tested today.
- Typed calls between the app and the Worker are still wanted. They come from shared schemas (rule D2), not from a framework.
- If a native client is decided on later, it meets an API that was kept free of any one client.

## Sources

- TanStack Start: `tanstack.com/blog/tanstack-start-1-0`; the guides for hosting, server functions, middleware, single-page mode and selective rendering under `tanstack.com/start/latest/docs/framework/react/`; the registry entry of `@tanstack/react-start` 1.169.5; issues 5808, 7740, 8550 and 8789 and the security advisories of `github.com/TanStack/router`; `developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/` and `developers.cloudflare.com/workers/static-assets/billing-and-limitations/`.
- Exact: `ccheever.expo.app`; `github.com/expo/exact` (`README.md`, `LICENSE`, `rules/DEFERRED.md`, `docs/contract-for-agents.md`, `docs/contract-for-humans.md`, `docs/recipes/website-hosting.md`).
