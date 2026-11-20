# ADR-0019: Figures in the administration area: an instance's counts, a mailbox's own figures, and charts by echarts

- Status: **Accepted**
- Date: 2026-11-20
- Decided by: Halil (@madraka), project lead, on 2026-11-20, as proposed, with options B1 and A1 ([#132](https://github.com/cloudhal-dev/podbay/pull/132), comment 7033486834). The lead decided what to build on 2026-11-20 ([#130](https://github.com/cloudhal-dev/podbay/issues/130), comment 7024361515); this record proposes how, and what that decision left open.
- Proposed by: the coding agent, for issue [#130](https://github.com/cloudhal-dev/podbay/issues/130)
- Sources: read on 2026-11-20 and listed at the end. Every fact about the code was read on `main` at e856154. The facts about echarts were read in its published source at the 6.1.0 tags, its package metadata, its advisories and its handbook on that day, by a research agent and an independent reading in the audit (#132, comment 7025381113); each was checked against the installed Kumo files or the source. No Cloudflare fact is relied on (see "Within one request"). Nothing of this record is built.

**Two choices for the lead, before anything else.** The record follows the lead's decision everywhere but in one place, and reads one word of it one way. **The lead took both as proposed on 2026-11-20: every member (B1), and the audit log's entries about the instance (A1).**

1. **Who sees a mailbox's figures.** The lead's words name a mailbox's *owners*. This record proposes **every member** of the mailbox (option B1, decision 2): a member already reads every message and could count them, so the figures tell them nothing new, and a manager who is a reader of a mailbox then sees it, as the lead's first point asks. The other way, owners only (option B2), is written out and costs one new right.
2. **What "activity" is.** This record reads the instance's "activity" as **the audit log's entries about the instance**: people, invitations, memberships, keys, recovery, mailboxes made and deleted, counted by kind and day (decision 1). If the lead meant mail, that is option A2, and the record explains why it is not proposed: an instance's total of mail gives one mailbox's traffic away when there are few.

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

- **The accounts database** (D1) holds people (`user`, with `instance_roles`), mailboxes, memberships, invitations and an audit log (`audit`: `at`, `actor_user_id`, `action`, `target`, `detail`, indexed on `at`).
- **The audit log has twenty kinds of entry.** Nine are written by their own statements in `workers/auth/`: `invitation.created`, `invitation.accepted`, `invitation.revoked`, `key.created`, `key.revoked`, `membership.set`, `membership.removed`, `recovery.issued`, `recovery.used`. Eleven are written through `writeAudit` or `auditStatement` (`workers/auth/store.ts`): `setup.owner_created`, `mailbox.created`, `mailbox.settings_updated` and `mailbox.deleted` there; `mailbox.bulk` and `mailbox.bulk_undone` (`workers/routes/bulk.ts`); `mailbox.rules_changed`, `mailbox.sender_blocked`, `mailbox.sender_unblocked` and `mailbox.auto_reply_changed` (`workers/routes/rules.ts`); `mailbox.known_addresses_forgotten` (`workers/routes/known-addresses.ts`). Several are what members do inside a mailbox, and bulk deeds and blocked senders follow its mail. (Issue #130 said nine; it counted only the first group.)
- **Routes the area already has** under `instance.manage`: the people (`GET /api/v1/users`), the invitations (`GET /api/v1/invitations`), and every mailbox with its members' count and owners (`GET /api/v1/registry/mailboxes`). None says anything about mail.
- **What arrived.** `fileArrival` (`workers/durableObject/originals.ts`) files every message that arrives, writing the mailbox's own time of arrival (`arrival.started_at`) as `emails.date` on every path, so no stranger can put a message on another day. Since ADR-0015 (2026-11-17) each such row has an original (`raw_key`) or is marked `unparsed`; a row written before then has neither. Other rows of `emails` are not arrivals: messages written here, drafts (also deleted ones in Trash), mail waiting in Scheduled, and sent mail a person moved elsewhere. `emails(date)` has an index.
- **What left.** Outgoing mail has a row in `submissions` with its `state` (`waiting`, `sending`, `sent`, `failed`), `requested_at` (when Send was pressed), `sent_at` and `error`. A sent row stays while its message is kept. A failed row goes when the person sends again or takes the message back to a draft, and with the draft; an automatic reply that fails is removed (`forgetFailed`), one that leaves is a `sent` row like any other. Only `submissions(state, send_at)` is indexed; no index serves `sent_at`, and sent rows are never pruned.
- **Rights.** `mailbox.read` belongs to every member (reader, sender, owner); `mailbox.manage` to owners (`workers/auth/authorize.ts`). A person who is not a member of a mailbox gets 404 at every route of it, whatever their instance role (hard rule 3); the one exception is who the members are. A manager who adds themselves to a mailbox needs fresh proof, and it is written down.
- **Programs' keys** reach `/mcp` only (`workers/app.ts`); no route under `/api/v1` takes one.
- **How full a mailbox is** is decided to be shown (#119, 2026-11-19), with a record of its own still to come.

### echarts

- **Version, and a floor.** 6.1.0 is the current stable release of `echarts` (npm `latest`, published 2026-05-19), and of `zrender` (2026-05-04). echarts 6.1.0 depends on `zrender` 6.1.0 and `tslib` 2.3.0, both exactly; zrender on `tslib` 2.3.0. **6.1.0 is also a security floor:** advisory GHSA-fgmj-fm8m-jvvx (CVE-2026-45249, a cross-site scripting fault, "medium") affects every version below 6.1.0 and is fixed in it. Kumo's peer range, `^6.0.0`, admits the versions it affects.
- **The app registers the modules, not Kumo.** Kumo's chart passes on the `echarts` it is given (`echarts` is a required prop of `Chart` and `TimeseriesChart`); the imports of `echarts/core` in its chunk are examples in its comments. So the list of modules Podbay registers decides what is on the page. Kumo's `TimeseriesChart` asks for `LineChart` (or `BarChart`), `GridComponent`, `TooltipComponent`, `BrushComponent`, `ToolboxComponent` and `CanvasRenderer`, and it sets `aria` and, when asked, `markLine` and a hidden legend.
- **No eval.** The one `new Function` in echarts is in `src/coord/geo/GeoJSONResource.ts`, for map data given as a string, and only where `JSON.parse` is missing. It is reached by map and geo modules, **and by the brush** (`BrushTargetManager` imports `Geo`). It cannot run in a browser that has `JSON.parse`, so the page's policy needs no `'unsafe-eval'`. Nothing else on that path uses `eval`, `Function(…)` or a timer given a string.
- **Nothing loaded by itself.** No worker, no `blob:` script, no request of its own. zrender loads an image only when a chart's options name one; map data comes only through `registerMap`.
- **The toolbox** brings Save as image and Data view (which use `document.write`, `window.open` and `innerHTML`). `TimeseriesChart` sets `toolbox: { show: false }` and configures no feature; it needs the toolbox only for the brush. None of its features is shown, and none takes a stranger's text.
- **Styles** are set through the CSSOM (`style.cssText`); echarts' own HTML tooltip carries `style` attributes, which the page's `style-src 'self' 'unsafe-inline'` allows.
- **Tooltips are HTML.** echarts writes a tooltip with `innerHTML`. Its default tooltip escapes the series name, each item's name and each value (`encodeHTML`), and so does a string template; a formatter given as a function is not escaped. Kumo passes such a function as `tooltip.dangerousHtmlFormatter` and drops a plain `formatter`. Kumo's own `SankeyChart` and map charts pass `dangerousHtmlFormatter` themselves (Sankey's `tooltipFormatter` is unescaped HTML). `TimeseriesChart` hides echarts' tooltip (`showContent: false`) and draws its own in React.
- **Licences.** echarts is Apache-2.0 and carries a `NOTICE` ("Apache ECharts / Copyright 2017-2026 The Apache Software Foundation…"); it holds code from d3 under BSD-3-Clause in a file every build has (`src/util/number.ts`). zrender is BSD-3-Clause ("Copyright (c) 2017, Baidu Inc."); its SVG renderer's `src/svg/patch.ts` is "Modified from snabbdom … Licensed under the MIT License". tslib is 0BSD. None is GPL or AGPL.
- **Size.** The whole library is about 1.1 MB minified and 368 KB compressed; the size of the modules Podbay registers is not published, and is measured in Podbay's own build.

### Within one request

The lead's decision is to ask each mailbox when the page opens. Gathering every mailbox's figures inside one request of the Worker would make that request's work grow with the number of mailboxes, against limits of the platform this record would then have to name. This record avoids that: no request reads more than one mailbox's figures (decision 3), and the instance's figures come from the accounts database in a fixed number of queries, whatever the number of mailboxes (decision 1). So no platform limit is relied on, and no Cloudflare fact is needed.

## Options

### A. What an instance's figures are made of

| | Option | For | Against |
|---|---|---|---|
| A1 | The accounts database's counts (people, mailboxes, invitations) and the audit log's entries **of a named list of kinds about the instance**, by kind and day; no mail traffic, and no kind about what members do inside a mailbox | No mailbox's traffic or activity is in any total, so none can be worked out, however few mailboxes there are. It is what the lead's third point lists for the instance, read as the audit log. One request, a fixed number of queries | An instance-wide chart of mail is not there; mail charts are per mailbox |
| A2 | Also every mailbox's received and sent, summed; or every kind of the audit log | A chart of all mail, or of all activity | With two mailboxes, a manager who is a member of one subtracts it and has the other's daily traffic or deeds, which the lead's first point excludes. A threshold (only with at least *k* mailboxes the viewer is not a member of) narrows it but does not close it: mailboxes are made and deleted, and two totals a day apart give one away. Reading every mailbox in one request also grows with their number |
| A3 | As A2, with noise added to each total | A chart that cannot be inverted exactly | A figure that is not true is shown as one; the proof that the noise is enough is a study of its own |

### B. Who may read a mailbox's figures

| | Option | For | Against |
|---|---|---|---|
| B1 | `mailbox.read`: every member | A member already reads every message and can count them; figures tell them nothing new. Owners see them, and a manager sees them for exactly the mailboxes they are a member of, as the lead's first point says. No new right | Readers and senders see them too, where the lead's words name owners |
| B2 | Owners only: a new right, `mailbox.figures`, given to owners, and to a manager only through a membership | Exactly "a mailbox's owners" | A new right in `authorize`, its table and its tests; a manager who is a reader of a mailbox would not see its figures, against the lead's first point, unless the right is also given to a manager's membership of any role, which is a rule of its own; and a reader is kept from counting what they can read |

### C. Where the figures of several mailboxes are put together

| | Option | For | Against |
|---|---|---|---|
| C1 | In the browser: the Overview asks each mailbox the viewer is a member of for its figures, one request each, and sums them on the screen | No request of the Worker reads more than one mailbox, and each is under that mailbox's own right; nothing new is a read across mailboxes | A person with many mailboxes waits for many requests; a bound is needed |
| C2 | In the Worker, one request for all the viewer's mailboxes | One request | Its work grows with the number of mailboxes, and it is a new read across mailboxes |

## Decision

1. **The instance's figures hold no mail and no mailbox's activity** (option A1). A new route, `GET /api/v1/instance/figures`, right `instance.manage`, answers from the accounts database only, in four queries whatever the number of mailboxes:
   - how many people (by instance role), how many mailboxes, how many invitations wait;
   - **the instance's activity:** the audit log's entries for each of the last thirty days, counted by kind, of these kinds only: `setup.owner_created`, `invitation.created`, `invitation.accepted`, `invitation.revoked`, `membership.set`, `membership.removed`, `key.created`, `key.revoked`, `recovery.issued`, `recovery.used`, `mailbox.created`, `mailbox.deleted`;
   - **not counted, now and later:** `mailbox.settings_updated`, `mailbox.bulk`, `mailbox.bulk_undone`, `mailbox.rules_changed`, `mailbox.sender_blocked`, `mailbox.sender_unblocked`, `mailbox.auto_reply_changed`, `mailbox.known_addresses_forgotten`, and every kind added after this record until it is placed on one list or the other. A test fails when the Worker writes a kind that is on neither list;
   - it names no person, no address and no mailbox; a kind is shown in the app's own words, never as its code. A list of the audit log's entries, with who did what, is #11's and not this record's.
2. **A mailbox's figures are its own, read from it alone.** A new route, `GET /api/v1/mailboxes/:mailboxId/figures`, right `mailbox.read` (option B1; owners only is option B2, the lead's choice above), is one call to that mailbox's object. It answers:
   - **arrived**, for each of the last thirty days (UTC): the rows `fileArrival` wrote (`raw_key` set, or `unparsed`), by `date`, the mailbox's own time of arrival, in whatever place they are now. A row filed before ADR-0015 (2026-11-17) has neither and is not counted: an instance that existed then shows fewer arrivals for its first thirty days of figures, and none of it after 2026-12-17;
   - **sent**, for each of those days: `submissions` with `state = 'sent'`, by `sent_at`. It includes automatic replies the mailbox sent (ADR-0008), which a stranger's mail causes; the answer says how many of them were automatic, so a screen can show both;
   - **waiting, now:** the rows `waiting` or `sending`;
   - **marked not sent, now:** the rows `failed` today, as the rail already says of Drafts. It is not a count by day: a failed row goes when the person sends again, takes the message back or deletes its draft, and `requested_at` is when Send was pressed, not when it failed; a count of failures by day would need a stored form, and is not made;
   - how full the mailbox is joins this answer when #119's record decides how it is read.
   A message deleted for good is no longer counted: the figures are what the mailbox holds. Its answer has a fixed size: thirty days of three numbers, and three more. **One index is added** to the mailbox's database, `submissions(state, sent_at)`, an additive change of its schema (D2) and no new data, so the count of sent mail reads the last thirty days and not every message ever sent; arrivals use `emails(date)`, which exists.
3. **Several mailboxes are put together in the browser** (option C1). The Overview sums the figures of the mailboxes the viewer is a member of, asking each one; it asks at most twenty, and past that it shows each mailbox's figures on its own page instead of a sum. A manager who is not a member of a mailbox gets 404 at its figures, as at every route of it, so no screen can show them. No route of a mailbox is limited in rate today; these two reads are no more costly than a list of messages.
4. **Where they are shown.**
   - **The Overview** (`/admin`), for whoever manages the instance: the instance's figures (decision 1) as tiles and a chart of its activity, and the chart of their own mailboxes (decision 3).
   - **A mailbox's page** in the area (`/admin/mailboxes/<address>`): its figures and chart, when the viewer is a member.
   - **A mailbox's own settings** (`/mailbox/<address>/settings`), for its members who do not manage the instance: the same figures, so a mailbox's owners see their own mailbox's figures, as the lead's first point asks.
   - **No chart, and no part of echarts,** on the screens where mail is read and written: the lists, a conversation, writing a message, search. Only the three screens above load the chart's module.
5. **What is never shown:** anything by sender, recipient, subject or address; anything about one person's activity (the audit log is counted by kind, never by actor); the traffic or the activity of a mailbox the viewer is not a member of, alone or inside a total; anything to a program's key (keys reach `/mcp` only, and no tool gives figures); anything that would need a token of the platform inside the Worker (the platform's own analytics stay out for that reason); and "bounced", until #33 decides what became of sent mail.
6. **The chart is Kumo's `TimeseriesChart`, on echarts 6.1.0, loaded only where a chart is shown.**
   - `echarts` 6.1.0 is added, at that exact version, in the catalog, with its reason; `zrender` 6.1.0 and `tslib` 2.3.0 come with it at the versions it names exactly. **The pin may not go below 6.1.0** (GHSA-fgmj-fm8m-jvvx); a later version is taken through the usual pins and their review.
   - **The modules Podbay registers,** and no others: `LineChart`, `BarChart`, `GridComponent`, `TooltipComponent`, `BrushComponent`, `ToolboxComponent` (for the brush; no feature of it is configured or shown), `LegendComponent` when a chart drives its series from outside, and `CanvasRenderer`. The SVG renderer is not registered; should it be, snabbdom's MIT notice joins `NOTICE` with it.
   - The app imports only `TimeseriesChart` from Kumo's chart, in one module of its own, loaded lazily (`React.lazy`) by the screens of decision 4. A static check refuses an import of `echarts`, of Kumo's chart entry, of `Chart`, `SankeyChart` or a map chart from `@cloudflare/kumo`, and the word `dangerousHtmlFormatter`, anywhere else, until this record is amended. Kumo's Sankey and map charts write HTML tooltips themselves, so they are refused by name, not by what the app writes.
   - **No tooltip of ours is HTML.** `TimeseriesChart` draws its tooltip in React, so names reach the screen as text.
   - **The page's content policy does not change:** no eval is needed (see Findings), no worker, nothing loaded by echarts itself.
   - **Licences:** `NOTICE` carries echarts' notice and the BSD attributions of zrender and of the d3 code in echarts, in the change that adds the dependency.
   - Before a chart is shown, figures are shown as Kumo's tiles and meters, so nothing waits on the chart to be read.
7. **Proof, in this order** (ADR-0018, decision 6):
   - in the Workers runtime: both routes with their rights (a member and an owner read their mailbox's figures; a non-member, also an owner or administrator of the instance, gets 404; a person without `instance.manage` gets 403 at the instance's figures); arrivals counted from `fileArrival`'s rows only (a draft deleted to Trash, a scheduled message and a sent message moved to Inbox count as nothing); neither answer holds an address, a subject or a name, with messages full of each delivered first; and the audit kinds' two lists (a kind the Worker writes on neither list fails a test);
   - in the build: the chart's chunk holds neither `new Function` nor `eval(` beyond the one in `GeoJSONResource`, and the mail screens' chunks hold no part of echarts;
   - in the browser: the Overview and a mailbox's figures load with no violation of the page's policy.
8. **Daily sums** are not built. They come with a record of their own when an instance has too many mailboxes for decision 3's bound.
9. **The feature scope** ([`docs/feature-scope.md`](../feature-scope.md)) gains a row for figures in the change that builds them.

## What is not decided here

- How full a mailbox is (#119), which joins decision 2's answer through its own record.
- What became of sent mail after the service took it (#33).
- Reading the audit log's entries (#11).
- A count of failures by day, which would need a stored form.
- Days in the viewer's own time zone. The figures are by UTC day; a person far from UTC sees a day's mail split across two bars near midnight. Moving the boundary means asking each mailbox with the viewer's offset, which is a later change to decision 2's route.

## Security: the boundaries it touches

| Boundary | What changes | What holds |
|---|---|---|
| B4, per-mailbox authorisation | A new read of a mailbox: its figures | It is a route of the mailbox, under `mailbox.read`, so the guard and `authorize` decide it as they decide every route of it: a non-member gets 404, whatever their instance role. Its answer is counts only |
| B4 | A new read for those who manage the instance: the instance's figures | It reads the accounts database only, which holds no mail, counts nothing by mailbox, and counts only the audit log's kinds about the instance; it is in the route table under `instance.manage` |
| B5, programs' keys | None | Keys reach `/mcp` only; no tool gives figures |
| B9, dependencies | `echarts` 6.1.0, with `zrender` 6.1.0 and `tslib` 2.3.0 | Pinned in the catalog at no less than the advisory's fix, licences checked by `pnpm static licences` (Apache-2.0, BSD-3-Clause, 0BSD) and their notices in `NOTICE`, loaded only by the chart's module. Under the page's policy it needs no eval, starts no worker and loads nothing by itself |
| B2, the browser | A component that can write HTML into the page (echarts' tooltip) | `TimeseriesChart` draws its tooltip in React; Kumo's charts with HTML tooltips, and `dangerousHtmlFormatter`, are refused by a static check |

## Consequences

- Two routes, two answers of a fixed shape, one additive index in each mailbox's database, and no new data stored.
- The Overview's sum of mailboxes costs one request for each, up to twenty.
- The app gains a dependency. The screens where mail is read and written carry none of it; the chart's module is fetched only by the three screens of decision 4.
- A mailbox's settings gain its figures, a screen of the mail side.

## Triggers

Come back to this record when:
- an instance has more mailboxes than decision 3's bound for many of its managers (daily sums, their own record);
- #33 decides what became of sent mail ("bounced");
- #119's record decides how a mailbox's size is read;
- **import** (phase B) writes messages with dates a person chooses, which changes what "arrived by day" can trust;
- the page's policy drops `'unsafe-inline'` for styles, which echarts' own HTML tooltip needs (not used here, but one import away);
- a new kind of audit entry is added (it goes on one of decision 1's lists);
- an echarts release or advisory touches tooltips or the modules of decision 6;
- or Kumo's chart stops depending on echarts.

## Sources

Read on 2026-11-20.

- Podbay at e856154:
  - `migrations/0002_index.sql` (the audit table);
  - `workers/auth/` (`keys.ts`, `people.ts`, `recovery.ts` and `store.ts` write the audit log; `authorize.ts`; the route table), `workers/routes/bulk.ts`, `rules.ts` and `known-addresses.ts` (the other audit kinds);
  - `workers/durableObject/migrations.ts` (the `emails` and `submissions` tables and their indexes), `originals.ts` (`fileArrival` writes `arrival.started_at` as `date`), `submissions.ts` (`takeBack`, `forgetFailed`), `auto-reply.ts`;
  - `workers/app.ts` (keys at `/mcp` only), `shared/security-headers.ts` (the page's policy).
- `@cloudflare/kumo` 2.18.1 as installed: `package.json` (`echarts` `^6.0.0`, an optional peer); `dist/chunks/chart-*.js`: the examples in comments that import `echarts/core`, `TimeseriesChart`'s options (`brush`, `toolbox: { show: false }`, `tooltip.showContent: false`, `aria`), `dangerousHtmlFormatter` (lines 146-149), and Kumo's Sankey and map charts' own `dangerousHtmlFormatter`; `ai/component-registry.md` (`TimeseriesChart` takes `echarts`).
- `node scripts/pins.ts --resolve echarts zrender`: the newest stable versions at least three days old are 6.1.0 and 6.1.0.
- npm registry: <https://registry.npmjs.org/echarts/6.1.0>, <https://registry.npmjs.org/zrender/6.1.0>, <https://registry.npmjs.org/tslib/2.3.0>, and the packages' `time` and `dist-tags`.
- GitHub advisory GHSA-fgmj-fm8m-jvvx (CVE-2026-45249), read through the GitHub advisories API: "Apache ECharts has a cross-site scripting (XSS) vulnerability", affected `< 6.1.0`, first patched `6.1.0`.
- echarts source at tag 6.1.0 (commit `c5a48f5f`): `src/component/tooltip/tooltipMarkup.ts`, `TooltipHTMLContent.ts`, `TooltipView.ts`, `seriesFormatTooltip.ts`, `src/util/format.ts`, `src/coord/geo/GeoJSONResource.ts`, `src/component/helper/BrushTargetManager.ts` (imports `Geo`), `src/core/echarts.ts`, `NOTICE`, `LICENSE`.
- zrender source at tag 6.1.0 (commit `32b66867`): `src/core/dom.ts` (`encodeHTML`), `src/core/platform.ts`, `src/canvas/Painter.ts`, `src/svg/Painter.ts`, `src/svg/patch.ts` (snabbdom, MIT), `LICENSE`.
- <https://cdn.jsdelivr.net/npm/echarts@6.1.0/NOTICE>, <https://cdn.jsdelivr.net/npm/echarts@6.1.0/licenses/LICENSE-d3>, <https://cdn.jsdelivr.net/npm/zrender@6.1.0/LICENSE>.
- echarts 6.1.0 release notes: <https://github.com/apache/echarts/releases/tag/6.1.0>.
- echarts handbook: <https://echarts.apache.org/handbook/en/best-practices/security>, <https://echarts.apache.org/handbook/en/basics/import>.
- Bundlephobia, the whole library: <https://bundlephobia.com/api/size?package=echarts@6.1.0>.
