# ADR-0019: Figures in the administration area: an instance's counts, a mailbox's own figures, and charts by echarts

- Status: **Proposed**
- Date: 2026-11-20
- Decided by: the project lead, when accepted. The lead decided what to build on 2026-11-20 ([#130](https://github.com/cloudhal-dev/podbay/issues/130), comment 7024361515); this record proposes how, and what that decision left open.
- Proposed by: the coding agent, for issue [#130](https://github.com/cloudhal-dev/podbay/issues/130)
- Sources: read on 2026-11-20 and listed at the end. Every fact about the code was read on `main` at a415552; the facts about echarts were read in its own published source at the release tags, its package metadata and its handbook on that day, by a research agent whose report was checked against the installed Kumo files. No Cloudflare fact is relied on (see "Within one request"). Nothing of this record is built.

## Context

On 2026-11-20 the project lead asked for the administration area (#127) to be a panel in the full sense, with figures and charts: mail received, sent, not delivered, and the like. The lead then decided four things, in these words ([#130](https://github.com/cloudhal-dev/podbay/issues/130)):

1. **Whose figures.** "A mailbox's owners see their own mailbox's figures. Someone who manages the instance sees the instance's totals, and the figures of the mailboxes they are a member of; not the daily traffic of a mailbox whose mail they cannot read."
2. **Where they come from.** "Asked of each mailbox when the page opens; nothing new is stored. Daily sums are for the day an instance has too many mailboxes for that, with a record of their own."
3. **Which figures first.** "For the instance: people, mailboxes, invitations waiting, and activity. For a mailbox: received, sent and failed by day for the last thirty days, how many wait, and how full it is (#119)."
4. **The chart dependency.** "`echarts` is added for the design system's chart, loaded only where a chart is shown, so the mail screens carry none of it."

Left open for this record: the routes and their rights; what an instance's total is made of, so that with few mailboxes it does not give one mailbox's traffic away; how the totals are gathered within one request's limits; the dependency's pin and what it does under the page's content policy; and what is never shown. "Bounced" waits for [#33](https://github.com/cloudhal-dev/podbay/issues/33).

It is a decision because it adds a read about mailboxes for those who manage the instance (boundary B4), a read of figures from each mailbox (B4), and a runtime dependency of the app (B9).

## Findings

### What the code has today

- **The accounts database** (D1) holds people (`user`, with `instance_roles`), mailboxes, memberships, invitations and an audit log. The audit log (`audit`: `at`, `actor_user_id`, `action`, `target`, `detail`, indexed on `at`) has nine kinds of entry today: `invitation.created`, `invitation.accepted`, `invitation.revoked`, `key.created`, `key.revoked`, `membership.set`, `membership.removed`, `recovery.issued`, `recovery.used`. Its `target` and `detail` can name people.
- **Routes the area already has** under `instance.manage`: the people (`GET /api/v1/users`), the invitations (`GET /api/v1/invitations`), and every mailbox with its members' count and owners (`GET /api/v1/registry/mailboxes`). None of them says anything about mail.
- **A mailbox's own database** holds every message with its place (`emails.folder_id`) and a `date`. For a message that arrived, `date` is the time it arrived (`arrival.started_at`, written by `fileArrival` in `workers/durableObject/originals.ts`), not the `Date:` its sender wrote, so it cannot be put on another day by a stranger. Outgoing mail has `submissions` with its `state` (`waiting`, `sending`, `sent`, `failed`), `requested_at`, `sent_at` and `error`.
- **Rights.** `mailbox.read` belongs to every member (reader, sender, owner); `mailbox.manage` to owners (`workers/auth/authorize.ts`). A person who is not a member of a mailbox gets 404 at every route of it, whatever their instance role (hard rule 3). The one exception is who the members are.
- **How full a mailbox is** is decided to be shown (#119, 2026-11-19), with a record of its own still to come.

### echarts

Read in its published source at the release tags, its package metadata and its handbook (see "Sources").

- **Version.** 6.1.0 is the current stable release of `echarts` (npm `latest`, published 2026-05-19), and of `zrender` (2026-05-04). echarts 6.1.0 depends on `zrender` 6.1.0 and `tslib` 2.3.0, both exactly; zrender on `tslib` 2.3.0. Kumo's peer range is `^6.0.0`.
- **No eval.** On the path a line or bar chart takes (`echarts/core`, the line and bar charts, the grid, tooltip, legend, title and data-zoom components, the canvas and SVG renderers) nothing uses `eval`, `new Function`, `Function(…)` or a timer given a string. The one `new Function` in echarts is in `src/coord/geo/GeoJSONResource.ts`, for map data given as a string where `JSON.parse` is missing; only map and geo modules reach it. The page's policy has no `'unsafe-eval'`, and needs none.
- **Nothing loaded by itself.** No worker, no `blob:` script, no request of its own. zrender loads an image only when a chart's options name one; map data comes only through `registerMap`.
- **Styles** are set through the CSSOM (`style.cssText`), and the tooltip's markup carries `style` attributes, which the page's `style-src 'self' 'unsafe-inline'` already allows.
- **Tooltips are HTML.** echarts writes a tooltip with `innerHTML`. Its default tooltip escapes the series name, each item's name and each value (`encodeHTML`, which replaces `& < > " '`), and so does a string template. A formatter given as a function is not escaped: what it returns goes into the page as it is. Kumo's chart passes such a function only as `tooltip.dangerousHtmlFormatter` (it drops a plain `formatter`), and its `TimeseriesChart` hides echarts' tooltip (`showContent: false`) and draws its own in React. echarts 6.1.0's own release notes fix a tooltip escaping fault in another kind of series (`lines`), so escaping is done series by series.
- **Licences.** echarts is Apache-2.0 and carries a `NOTICE` ("Apache ECharts / Copyright 2017-2026 The Apache Software Foundation…"); it also holds code from d3 under BSD-3-Clause, in a file every build has (`src/util/number.ts`). zrender is BSD-3-Clause ("Copyright (c) 2017, Baidu Inc."), tslib 0BSD. None is GPL or AGPL.
- **Size.** The whole library is about 1.1 MB minified and 368 KB compressed; the size of the parts a line or bar chart imports is not published, and is measured in Podbay's own build.

### Within one request

The lead's decision is to ask each mailbox when the page opens. Gathering every mailbox's figures inside one request of the Worker would make that request's work grow with the number of mailboxes, against limits of the platform this record would then have to name. This record avoids that: no request reads more than one mailbox's figures (decision 2), and the instance's figures come from the accounts database in a fixed number of queries, whatever the number of mailboxes (decision 1). So no platform limit is relied on, and no Cloudflare fact is needed.

## Options

### A. What an instance's total is made of

| | Option | For | Against |
|---|---|---|---|
| A1 | The instance's figures are the accounts database's counts (people, mailboxes, invitations) and the audit log's counts by kind and day; no mail traffic at all | No mailbox's traffic is in any total, so none can be worked out, however few mailboxes there are. It is what the lead's third point lists for the instance. One request, a fixed number of queries | An instance-wide chart of mail is not there; mail charts are per mailbox |
| A2 | The instance's figures also sum every mailbox's received and sent | A chart of all mail | With two mailboxes, a manager who is a member of one subtracts it and has the other's daily traffic, which the lead's first point excludes. A threshold (only with at least *k* mailboxes the viewer is not a member of) narrows it but does not close it: mailboxes are made and deleted, and two totals a day apart give one away. Reading every mailbox in one request also grows with their number |
| A3 | As A2, with noise added to each total | A chart that cannot be inverted exactly | A figure that is not true is shown as one; the proof that the noise is enough is a study of its own |

### B. Who may read a mailbox's figures

| | Option | For | Against |
|---|---|---|---|
| B1 | `mailbox.read`: every member | A member already reads every message and can count them; figures tell them nothing new. Owners see them, and a manager sees them for exactly the mailboxes they are a member of, as the lead's first point says. No new right | Readers and senders see them too, which the lead's first point does not name |
| B2 | `mailbox.manage`: owners only | Exactly "a mailbox's owners" | A manager who is a reader of a mailbox would not see its figures, against the lead's first point; and a reader is kept from counting what they can read |

### C. Where the figures of several mailboxes are put together

| | Option | For | Against |
|---|---|---|---|
| C1 | In the browser: the Overview asks each mailbox the viewer is a member of for its figures, one request each, and sums them on the screen | No request of the Worker reads more than one mailbox, and each is under that mailbox's own right; nothing new is a read across mailboxes | A person with many mailboxes waits for many requests; a bound is needed |
| C2 | In the Worker, one request for all the viewer's mailboxes | One request | Its work grows with the number of mailboxes, and it is a new read across mailboxes |

## Decision

1. **The instance's figures hold no mail.** A new route, `GET /api/v1/instance/figures`, right `instance.manage`, answers from the accounts database only, in four queries whatever the number of mailboxes: how many people (by instance role), how many mailboxes, how many invitations wait, and the audit log's entries for each of the last thirty days, counted by kind. It names no person, no address and no mailbox. Because it holds no mailbox's traffic, it gives none away, however few mailboxes there are (option A1). A list of the audit log's entries, with who did what, is #11's and not this record's.
2. **A mailbox's figures are its own, read from it alone.** A new route, `GET /api/v1/mailboxes/:mailboxId/figures`, right `mailbox.read` (option B1): one call to that mailbox's object, answering for each of the last thirty days (UTC): how many messages arrived (by `date`, the time of arrival, of messages in any place but Sent and Drafts), how many were sent (`submissions.sent_at`), and how many could not leave (`state = 'failed'`, by `requested_at`); and now: how many wait (`waiting` and `sending`). How full the mailbox is joins this answer when #119's record decides how it is read. A message deleted for good is no longer counted: the figures are what the mailbox holds. Its answer has a fixed size: thirty days of three numbers, and one more.
3. **Several mailboxes are put together in the browser** (option C1). The Overview sums the figures of the mailboxes the viewer is a member of, asking each one; it asks at most twenty, and past that it shows each mailbox's figures on its own page instead of a sum. A manager who is not a member of a mailbox gets 404 at its figures, as at every route of it, so no screen can show them.
4. **Where they are shown.**
   - **The Overview** (`/admin`), for whoever manages the instance: the instance's figures (decision 1) as tiles and a chart of the audit log's activity, and the chart of their own mailboxes (decision 3).
   - **A mailbox's page** in the area (`/admin/mailboxes/<address>`): its figures and chart, when the viewer is a member.
   - **A mailbox's own settings** (`/mailbox/<address>/settings`), for its members who do not manage the instance: the same figures, so a mailbox's owners see their own mailbox's figures, as the lead's first point asks.
5. **What is never shown:** anything by sender, recipient, subject or address; anything about one person's activity (the audit log is counted by kind, never by actor); the traffic of a mailbox the viewer is not a member of, alone or inside a total; anything that would need a token of the platform inside the Worker (the platform's own analytics stay out for that reason); and "bounced", until #33 decides what became of sent mail.
6. **The chart is Kumo's, on echarts, loaded only where a chart is shown.**
   - `echarts` 6.1.0 is added, at that exact version, in the catalog, with its reason; `zrender` 6.1.0 and `tslib` 2.3.0 come with it at the versions it names exactly.
   - The app imports Kumo's chart (`@cloudflare/kumo/components/chart`) in one module of its own, loaded lazily (`React.lazy`) by the screens that show a chart. A static check refuses an import of `echarts` or of that entry anywhere else, and a test of the build holds that the mail screens' chunks hold no part of echarts. Its size, measured in that build, is said in the pull request that adds it.
   - **The page's content policy does not change** (see Findings: no eval, no worker, nothing loaded by itself).
   - **No tooltip of ours is HTML.** The figures use Kumo's `TimeseriesChart`, whose tooltip React draws, so names reach the screen as text. Any other chart keeps echarts' default tooltip, which escapes names. `dangerousHtmlFormatter` is not used; a static check refuses it in the app. Should a chart ever need one, it escapes every name it is given, with a regression test (hard rule 7), and this record is amended.
   - **Licences:** `NOTICE` carries echarts' notice and the BSD attributions of zrender and of the d3 code in echarts, in the change that adds the dependency.
   - Before a chart is shown, figures are shown as Kumo's tiles and meters, so nothing waits on the chart to be read.
7. **Proof, in this order** (ADR-0018, decision 6):
   - in the Workers runtime: both routes with their rights (a member and an owner read their mailbox's figures; a non-member, also an owner or administrator of the instance, gets 404; a person without `instance.manage` gets 403 at the instance's figures); and neither answer holds an address, a subject or a name, with messages full of each delivered first;
   - in the browser: the Overview and a mailbox's figures load with no violation of the page's policy, and the mail screens load no part of echarts.
8. **Daily sums** are not built. They come with a record of their own when an instance has too many mailboxes for decision 3's bound.

## What is not decided here

- How full a mailbox is (#119), which joins decision 2's answer through its own record.
- What became of sent mail after the service took it (#33).
- Reading the audit log's entries (#11).
- Days in the viewer's own time zone. The figures are by UTC day; a person far from UTC sees a day's mail split across two bars near midnight. Moving the boundary means asking each mailbox with the viewer's offset, which is a later change to decision 2's route.

## Security: the boundaries it touches

| Boundary | What changes | What holds |
|---|---|---|
| B4, per-mailbox authorisation | A new read of a mailbox: its figures | It is a route of the mailbox, under `mailbox.read`, so the guard and `authorize` decide it as they decide every route of it: a non-member gets 404, whatever their instance role. Its answer is counts only |
| B4 | A new read for those who manage the instance: the instance's figures | It reads the accounts database only, which holds no mail, and counts nothing by mailbox; it is in the route table under `instance.manage` |
| B9, dependencies | `echarts` 6.1.0, with `zrender` 6.1.0 and `tslib` 2.3.0 | Pinned in the catalog, licences checked by `pnpm static licences` (Apache-2.0, BSD-3-Clause, 0BSD) and their notices in `NOTICE`, loaded only by the chart's module. Under the page's policy it needs no eval, starts no worker and loads nothing by itself |
| B2, the browser | A component that writes HTML into the page (echarts' tooltip) | Its default escapes names; ours draws its tooltip in React; `dangerousHtmlFormatter` is refused by a static check |

## Consequences

- Two routes, two answers of a fixed shape, and no new stored form.
- The Overview's sum of mailboxes costs one request for each, up to twenty.
- The app gains a dependency. The mail screens carry none of it; the chart's module is fetched only when a chart is shown.
- A mailbox's settings gain its figures, a screen of the mail side.

## Triggers

Come back to this record when an instance has more mailboxes than decision 3's bound for many of its managers (daily sums, their own record); when #33 decides what became of sent mail ("bounced"); when #119's record decides how a mailbox's size is read; or when Kumo's chart stops depending on echarts.

## Sources

Read on 2026-11-20.

- Podbay at a415552: `migrations/0002_index.sql` (the audit table), `workers/auth/` (the nine kinds of audit entry, `authorize.ts`, the route table), `workers/durableObject/migrations.ts` (the `emails` and `submissions` tables), `workers/durableObject/originals.ts` (`fileArrival` writes `arrival.started_at` as `date`), `shared/security-headers.ts` (the page's policy).
- `@cloudflare/kumo` 2.18.1 as installed: `package.json` (`echarts` `^6.0.0`, an optional peer), `dist/chunks/chart-*.js` (imports from `echarts/core`, `echarts/charts`, `echarts/components`, `echarts/renderers`), and the `./components/chart` entry.
- `node scripts/pins.ts --resolve echarts zrender`: the newest stable versions at least three days old are 6.1.0 and 6.1.0.
- npm registry: <https://registry.npmjs.org/echarts/6.1.0>, <https://registry.npmjs.org/zrender/6.1.0>, <https://registry.npmjs.org/tslib/2.3.0>, and the packages' `time` and `dist-tags`.
- echarts source at tag 6.1.0 (commit `c5a48f5f`): `src/component/tooltip/tooltipMarkup.ts`, `TooltipHTMLContent.ts`, `TooltipView.ts`, `seriesFormatTooltip.ts`, `src/util/format.ts`, `src/coord/geo/GeoJSONResource.ts`, `src/core/echarts.ts`, `NOTICE`, `LICENSE`; searched for `new Function`, `eval(`, `Function(`, `Worker(`, `createObjectURL`, `importScripts`, `fetch(`, `setTimeout(` with a string, `setAttribute('style'`, `innerHTML`.
- zrender source at tag 6.1.0 (commit `32b66867`): `src/core/dom.ts` (`encodeHTML`), `src/core/platform.ts`, `src/canvas/Painter.ts`, `src/svg/Painter.ts`, `LICENSE`.
- <https://cdn.jsdelivr.net/npm/echarts@6.1.0/NOTICE>, <https://cdn.jsdelivr.net/npm/echarts@6.1.0/licenses/LICENSE-d3>, <https://cdn.jsdelivr.net/npm/zrender@6.1.0/LICENSE>.
- echarts 6.1.0 release notes: <https://github.com/apache/echarts/releases/tag/6.1.0>; its security page: <https://github.com/apache/echarts/security>.
- echarts handbook: <https://echarts.apache.org/handbook/en/best-practices/security>, <https://echarts.apache.org/handbook/en/basics/import>.
- Bundlephobia, the whole library: <https://bundlephobia.com/api/size?package=echarts@6.1.0>.
- `@cloudflare/kumo` 2.18.1, `dist/chunks/chart-*.js`: `dangerousHtmlFormatter` (lines 146-149), `TimeseriesChart`'s `showContent: false` (line 695).
