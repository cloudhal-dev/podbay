# ADR-0018: One workspace, one Worker, many modules: the shape that leaves room for a suite

- Status: **Proposed**
- Date: 2026-11-19
- Proposed by: the coding agent, for issue [#57](https://github.com/cloudhal-dev/podbay/issues/57). Only the project lead accepts it.
- Sources: read on 2026-11-19 and listed at the end. Each Cloudflare fact is in the [ledger](../cloudflare/ledger.json) with its address and a quote; every other fact was read in its standard's or project's own text on that day.

## Context

The project lead set the direction on 2026-11-18: this repository becomes the home of a suite. Mail is its first module; a calendar, files, bookings and an administration area may follow, and later clients other than the web app (iOS, Android, macOS, Windows, Linux) on the same JSON API. On 2026-11-19 the lead added two things: the shape of the whole comes before wording and translation, and some thirty-five languages are expected later, not two.

Today the repository is one package. One Worker (`workers/app.ts`, handlers `fetch` and `email`) serves a single-page app (`app/`) as static assets, with code both sides use in `shared/`. It holds two Durable Object classes, one D1 database and one R2 bucket.

This is a decision because it touches every path, every check that reads a path, and the names a running instance depends on. It also meets three accepted records, and says so here rather than in passing:

- The [feature scope](../feature-scope.md#2-phases) puts calendar, booking and files in phase C, "decided after phase B". This record builds none of them and pulls none forward. It only decides the shape that leaves them room.
- [ADR-0005](0005-client-stack.md) decides the web client and names the first candidate for a native one, with triggers. This record does not change it. It says what any native client will need from the API, whichever technology it is written in.
- [ADR-0003](0003-project-home-on-cloudhal-dev.md) keeps an instance off a site that holds other sessions. Several modules on one hostname are one origin to a browser, so this record must say where content people upload would be shown.

What the answer has to keep, whatever it is:

1. **A running instance survives the move.** No Durable Object, D1 row or R2 object of an installed instance is lost or orphaned because a file moved.
2. **Deny by default in one table** (S1). Every way into the Worker is in one route table with the right it needs, and one guard decides.
3. **The checks keep holding** (rule 11 of `AGENTS.md`, "debt only shrinks"): every static check, the three test tiers and the five required checks on `main`.
4. **Exact pins in one place** (V1), and nothing installed under three days old (V6).
5. **The own-account rule**: nothing runs, and no credential is kept, outside the instance owner's own account, and the Worker holds no Cloudflare account token.
6. **Original work only** (S17), and no new dependency without its own reason.

## Findings

### The platform (Cloudflare)

| Question | What the platform says | Ledger |
|---|---|---|
| Can one Worker hold several modules? | It already does: two handlers and two Durable Object classes. A Worker may be 64 MiB uncompressed, with no limit on its compressed size. Classes are limited per account (500 on Workers Paid), not per Worker | `limit.workers.script_size` |
| Can several Workers share the app? | "Only one collection of static assets can be configured in each Worker", and in the Vite plugin assets are reached "on the client and in your entry Worker" | `runtime.static_assets.one_collection` |
| What does a second Worker cost? | A call through a service binding has no request fee, but "counts toward your subrequest limit", and one request may make at most 32 Worker invocations | `runtime.service_bindings.limits` |
| Can a second Worker use the mailbox class? | Yes, by naming the Worker that defines it (`script_name`) | `config.durable_objects.script_name` |
| What survives a class's rename or move? | A rename keeps the data in the same Worker. A move to another Worker is a transfer, which needs several coordinated deploys. A delete "will delete all Durable Objects associated with the deleted class". A migration tag is a unique name that is applied once | `runtime.durable_objects.migrations.*` |
| Is there a newer way to declare classes? | `exports` replaces the `migrations` list, and a Worker "cannot return to the legacy `migrations` array" once it is deployed with it | `runtime.durable_objects.migrations.exports` |
| Local development and tests with several Workers | Auxiliary Workers run beside the entry Worker, and "all requests are routed through your entry Worker". In tests they "cannot have TypeScript entrypoints" and "cannot access the `cloudflare:test` module" | `tooling.vite_plugin.auxiliary_workers`, `tooling.vitest.auxiliary_workers` |
| Can one Worker answer on several hostnames? | "You can add multiple Custom Domains" to a Worker | `config.custom_domains.multiple` |
| How does D1 order migrations? | "Every migration file in the `migrations` folder has a specified version number in the filename. Files are listed in sequential order", and the applied ones are recorded in the `d1_migrations` table | `tooling.d1.migrations_order` |
| Can a Worker read a domain's DNS without a token? | `node:dns` resolves "via DNS over HTTPS using Cloudflare DNS at 1.1.1.1"; each query is a subrequest; nothing to switch on at this compatibility date | `runtime.nodejs.dns` |
| Do the methods of calendar and file sync reach a Worker? | The runtime takes "all HTTP request methods … except for `CONNECT`". But the HTTP library under it does not list `MKCALENDAR`, which CalDAV uses to make a calendar, and no page says whether WebDAV's methods pass Cloudflare's network to a Worker on a custom domain. **Not verified** | `runtime.request.methods` |
| How many alarms does a mailbox have? | "Each Durable Object is able to schedule a single alarm at a time", run at least once and retried up to six times | `runtime.durable_objects.alarms` |
| What cryptography does push need? | Web Push needs ECDH and ECDSA on P-256, HKDF and AES-128-GCM (RFC 8291, RFC 8292). The runtime lists all four operations, but its page does not name the curve. **P-256 not verified** | `runtime.web_crypto.operations` |

### The tooling (pnpm)

- A workspace is the directories listed under `packages` in `pnpm-workspace.yaml`, with "a single `pnpm-lock.yaml` file in the root". The repository is already a workspace of one (`packages: ["."]`).
- The `workspace:` protocol makes pnpm "refuse to resolve to anything other than a local workspace package", and the `catalog:` protocol keeps one version of a dependency in one place.
- A recursive run executes "projects in topological order", so pnpm orders the work by itself. A filter can select the packages "changed since the specified commit/branch", compared against the merge base.
- `minimumReleaseAge` "applies to all dependencies, including transitive ones". It is set in the workspace file this repository already has.
- **Two checks read the root package only.** `scripts/pins.ts` reads `package.json` and nothing else. `pnpm static licences` runs `pnpm licenses list` without `-r`, and whether that covers other workspace packages was not tested. Before a second package exists, both must read every package. Otherwise rule V1 and the licence rule stop holding for everything outside the root.

### Other clients

- **A session without a cookie jar.** Better Auth's bearer plugin is "an alternative to browser cookies", and its page warns that it "is intended only for APIs that don't support cookies or require Bearer tokens". Its `requireSignature` setting is off by default. Exact's own guide says a native host "has no cookie jar" and sends `authorization: Bearer`.
- **Exact against ADR-0005's triggers, read again on 2026-11-19:** no trigger is met.
  - There is still "no release and no package", and "no API stability … by design".
  - The author-facing `srcdoc` of its frame is still withheld (`rules/DEFERRED.md`).
  - There is "no JSX or React layer".
  - Rich text is a Markdown editor, so there is no HTML editor.
  - Its own table calls the web, macOS, iOS and Linux working, and Android and Windows early.
  - Push from a server is still refused. Its recipe for Android push goes through Expo's service, with the push credentials kept there.
- **The fallback:** Expo documents "a universal Android, iOS, and web app". macOS and Windows are separate React Native projects from Microsoft, and Linux has neither.

### Messages and languages

- **Today:**
  - A message is keyed by its English text. Turkish is one flat catalog, and a value is filled into a named placeholder.
  - `plural(count, one, other)` knows two forms, chosen by the English rule.
  - The page sets `lang` and never `dir`. A plain text search finds physical class names (`ml-`, `pr-`, `text-left` and the like) about sixty to seventy times in 26 files of `app/`, and no logical ones.
  - A plain text search finds about 145 error answers in the Worker written as English sentences, and the app shows them as they are.
- **Plurals:** CLDR has six categories (zero, one, two, few, many, other). Arabic uses all six; Russian and Polish use four; Turkish uses two. `Intl.PluralRules` has been in browsers "since September 2019" and in V8, and it tells which categories a language uses.
- **The form of a message:**
  - Unicode MessageFormat 2 has been stable in CLDR since release 47, and the current text is in CLDR 49 (2026-10-22).
  - The proposal to put it in JavaScript (`Intl.MessageFormat`) is at Stage 1.
  - W3C's guidance is that text must not be put together from pieces, because "languages vary greatly in word order", and that values must be able to change places.
- **Direction:** "add `dir="rtl"` to the html tag" for a right-to-left language, and use start and end rather than left and right (W3C). `Intl.Locale.prototype.getTextInfo()` gives a language's direction, but has been in every browser only since 2026.
- **Translators' formats:**
  - XLIFF 2.2 (an OASIS Committee Specification, 13 March 2025) has a module for plural variants.
  - gettext PO numbers its plural forms per language.
  - MessageFormat 2 defines a data model meant for "converting to or from translation formats".
- **Loading:** Vite splits a dynamic `import()` with a variable into its own chunk, one file per name.
- **The Worker's language:** `Accept-Language` states preferred languages with weights (RFC 9110, section 12.5.4), and RFC 4647's "Lookup" picks the single best tag or a default. A person's stored choice is already known to the Worker (ADR-0012).

## Options

**For the deployable:**

- **A. One Worker for all modules, the repository a workspace of packages.** Modules are source, not deployments.
- **B. One Worker per module**, the entry Worker holding the hostname and the assets, the others reached by service bindings.
- **C. A Worker per module, with mail's classes moved out of the entry Worker** by transfer migrations.

B costs a separate deploy for each module, compiled auxiliary Workers in tests without `cloudflare:test`, and subrequests on every call between modules. It gives no isolation in the browser, since one hostname is one origin. It also splits the route table and the guard, which S1 wants in one place. C adds the riskiest operation the platform has on data an instance already holds, for no gain over A.

**For the layout:** the repository stays one package with folders, or becomes a pnpm workspace with apps, modules and shared packages. Folders alone cannot keep one module from reaching into another; packages can, through what each one exports.

**For messages:** keep the TypeScript catalogs keyed by English and add plural categories (no dependency); or adopt a MessageFormat 2 runtime now (a dependency on every page, for a proposal at Stage 1); or move to XLIFF or PO files and generate code from them (a generated-file step for a workflow nobody runs yet).

## Decision (proposed)

1. **One Worker, as today.** Every module runs in the one Worker and is served from its one hostname. A module brings:
   - its routes, each entered in the one route table with its right;
   - its Durable Object classes and their migrations;
   - its D1 migrations, in the one sequence of the one database;
   - its screens, its messages and its tests.

   The shell, the Worker's entry and the app's frame, composes them. No module has its own guard, and no service binding is added between modules.

   **A module other than mail can be off**, and is off until the deployer turns it on. This is the pattern the assistant and the MCP endpoint already follow (`workers/lib/features.ts`): a variable of the Worker, on only when it is exactly `"true"`. Mail is the product and has no switch. For a module that is off:
   - its routes stay in the route table, and the guard answers them 404, as if they did not exist, as the MCP endpoint does today;
   - the shell shows none of its screens, and the app loads none of its code or messages;
   - its Durable Object classes are declared and its D1 tables made in every instance all the same, so that the order of migrations is one order everywhere. Nothing is written to them while the module is off;
   - turning a module off deletes nothing, and turning it on again finds what it held.

   What an installer is told about each module (its switch, what turning it on needs) is part of the installer's contract ([#44](https://github.com/cloudhal-dev/podbay/issues/44)).

   **One sequence of D1 migrations, owned by the repository.** The one folder `migrations/` stays the one list, and D1 applies its files in the order of the number in their names. A module's migration takes the next free number in the pull request that adds it, and its file name carries the module (`0008_mail_….sql`). Two modules developed side by side reserve no numbers: the second to merge takes the next free number before it merges, and a check will refuse two files with one number. A migration once applied is never renumbered, renamed, edited or removed: migrations are additive only, as `AGENTS.md` already says.

2. **The repository becomes a pnpm workspace of three kinds of directory.**
   - `apps/`: what is deployed or run. First `apps/podbay`: the Worker's entry, `wrangler.jsonc`, the app's shell, the Vite configuration and the browser tests. A native client would be another app.
   - `modules/`: one product area each, first `modules/mail`. A module holds its Worker side (routes, Durable Objects, arrival), its app side (screens, hooks, queries), its messages and its tests. Mail's renderer, the mail frame and everything about a message's bytes stay in mail.
   - `packages/`: what modules share, with no product logic:
     - `contract`: what every module's API has in common: the form of an error answer and its code, the vocabulary of rights, how a list is paged. It imports nothing else here.
     - `auth`: sign-in, `authorize`, the guard and the route table's machinery.
     - `ui`: the design components on Kumo, the layout and the frame of a screen.
     - `i18n`: the message runtime, plurals and loading.
     - `platform`: the one log module, the storage-key helpers and the queue behind a Durable Object's one alarm, once a second user of it exists.

   A module is two programs and what they share, in one directory with three entries:
   - `worker/`, run by the Workers runtime: routes, Durable Objects, arrival;
   - `app/`, run in a browser: screens, hooks, queries;
   - `shared/`, run by neither and so by both: the module's contract (the shapes of its requests and answers, their schemas, its error codes) and the pure functions both sides run, such as the rules' `evaluate` and the text of a message's HTML. It keeps the rule `shared/` keeps today: no Node-only, browser-only or Workers-only API.

   `worker/` and `app/` never import each other; both import their module's `shared/` and the packages. So the Worker's code cannot reach a page, and a screen cannot reach a binding. A client of any kind takes `packages/contract` and the `shared/` entry of each module it speaks to, and nothing else.

   Of the 21 files in today's `shared/`, about fifteen are mail's own (places, labels, rules and their schema, sending, bulk, the original, known addresses, attachment risk, the text of HTML, the mail frame), and go to `modules/mail/shared/`. The rest (the log, the security headers, a person's choices and their schema, fresh proof, dates) go to packages. A module imports packages and never another module's inside: what one module offers another is exported from that side's entry. `pnpm static imports`, which holds the direction between the UI and the Worker today, will hold both rules, the two sides and the modules, in the change that makes the first module. `scripts/` stays the tooling of the whole repository.

3. **Nothing an instance depends on changes name.** The following stay exactly as they are; a moved file never touches them:
   - the Worker's name in `wrangler.jsonc`;
   - the classes `MailboxDO` and `EmailAgent`, exported under those names from the Worker's entry;
   - the bindings `MAILBOX`, `EMAIL_AGENT`, `DB`, `BUCKET`, `EMAIL` and `AI`. `AI` holds no data, but the assistant's code and an installer's configuration both name it;
   - the migration tags `v1` and `v2`, and the `migrations` list itself;
   - the D1 migrations in their order;
   - the R2 keys under `raw/` and `attachments/`.

   No rename, transfer or delete migration, and no change to `exports`, is part of the move. Each would need its own record. A new module's classes are new classes with new tags. Its R2 keys have a prefix of its own, and its D1 tables a name prefix of its own.

4. **The checks move with the files, in the same change, or the change does not merge.**
   - Before the first package beyond the root exists: `scripts/pins.ts` and `pnpm static licences` read every package of the workspace. The pinned versions move into the workspace's catalog, which `pins.ts` reads, and `pinExceptions` moves with them.
   - In the change that moves files: `copies.json` (the seed's paths), `ratchets.json`, the static checks that name paths, the ledger's `code` paths, the test configurations of the three tiers, and the guidance files (`AGENTS.md`, the skills, `.claude/rules/`).
   - The five required checks keep their job names, so the ruleset does not change.

5. **The tooling is pnpm alone.**
   - One lockfile, one `pnpm-workspace.yaml`, one catalog of exact versions, and `minimumReleaseAge` in the workspace file as today.
   - No task runner: pnpm runs the work in dependency order.
   - CI keeps running everything on every pull request. A pull request costs about fourteen job-minutes and waits about eight, measured on [#56](https://github.com/cloudhal-dev/podbay/issues/56). Running only what changed (`--filter "...[origin/main]"`) waits for a trigger below.

6. **A module's API comes before its screens.** A module's routes and their shapes are written in its `shared/` entry and tested in the Workers runtime before its screens exist. So a second client is never blocked on a screen's internals, and the API keeps to [ADR-0005](0005-client-stack.md), decision 2: the JSON API is the only contract.

7. **What any client other than the web app needs is decided before one is built.** This is not a choice of technology, which stays with ADR-0005 and its triggers. It is a set of conditions on any client:
   - **A session it can hold.** A client without a cookie jar uses a bearer credential. It is granted to one person on one device, can be ended in the app like a session, and is read by the same guard. Whether it is Better Auth's bearer plugin with signatures required, or a grant beside the keys of [#24](https://github.com/cloudhal-dev/podbay/issues/24), is decided with its own record. Nothing is built before that.
   - **Push is sent by the instance.** Push to the web needs only keys the instance makes and keeps as a Worker secret. Push to a phone goes through the platform's own service (Apple's, Google's), with credentials the instance owner registers and keeps in their own account. A service that keeps those credentials for the owner, as Expo's does for Android, does not meet the own-account rule and is not the default.
   - **The mail frame's rule holds for any client.** A stranger's HTML is shown sanitised, without script, without navigation and without remote content until the reader allows it. A client that cannot do that shows the message's text and never its HTML.
   - **The first step of a native client** is the trial ADR-0005 names: a hostile message shown safely on a phone, time-boxed, before anything else is built. By the 2026-11-19 reading of the candidate, iOS and macOS are where it can be tried first.

8. **Room for thirty-five languages, and nothing built for them here.**
   - **Where messages live:** each module keeps its own messages beside its code (`modules/mail/messages/en.ts`, `tr.ts`, …), and the shell keeps its own. The app loads the catalog of the language in use, one file per language and module, by a dynamic import, so no page carries the catalogs of other languages.
   - **The form of a message**, which every new message keeps from now on:
     - it is one whole sentence;
     - its values are named placeholders that a translator may move;
     - a plural is written as forms keyed by CLDR's category names, chosen by `Intl.PluralRules` and never by a number index or by the English rule.

     `pnpm static messages` will require exactly the categories a language uses. This is the part of MessageFormat 2 that converts to it, to XLIFF or to PO by a script, so the catalogs stay TypeScript keyed by English, with no runtime dependency, until a trigger below.
   - **Direction:** a language's direction comes from the table of languages, and the root element carries `dir` as well as `lang`. Before the first right-to-left language, the physical class names in the app become logical ones, and a check keeps new ones out.
   - **Adding a language** is a catalog file per module and a row in the table of languages. The messages check says whether it is complete. The row says whether a person has reviewed it, so a language that nobody has read is shown as not reviewed, and no code is read to tell.
   - **The Worker's own words** ([#39](https://github.com/cloudhal-dev/podbay/issues/39)):
     - every error answer carries a code, and the app shows the code's message in the reader's language;
     - mail the Worker writes by itself uses the person's stored language, then RFC 4647's Lookup over `Accept-Language`, then English.

9. **What the data for the other areas changes now.** It changes only what the layout must leave room for:
   - **Administration:** a Domains screen can read a domain's records from the Worker with `node:dns`, so it fits the architecture's non-goal ("no Cloudflare account credential inside the Worker") as it is.
   - **Calendar and files:** no first slice depends on CalDAV or WebDAV. Whether their methods reach a deployed Worker is tried on a real custom domain before any record chooses them.
   - **Anything that waits for a time** (reminders, snoozed mail, outgoing mail) is a queue behind a Durable Object's one alarm, from one shared helper.
   - **Files:** a module that serves content people upload serves it from a hostname of its own, never the app's origin. One Worker can answer on several custom domains, so this asks for no second Worker. It asks that the Worker answers by hostname, that the guard knows which hostname a request came in on and never accepts the app's session on the other one, and that each hostname has its own content policy. That is a decision for that module's record, under ADR-0003.

10. **The order.** The move is several pull requests, each small enough to read, and no large pull request is open across one:
    1. the checks that must read every package (decision 4);
    2. `packages/contract` and the other shared packages, one at a time, out of `shared/`;
    3. mail into `modules/mail`, the Worker side and the app side each in its own change;
    4. the shell into `apps/podbay`.

    The file moves begin after the screens' work on controls ([#84](https://github.com/cloudhal-dev/podbay/issues/84), [#82](https://github.com/cloudhal-dev/podbay/issues/82), [#83](https://github.com/cloudhal-dev/podbay/issues/83)) has merged, since that work touches the same files. Step 1 may come at any time. Where this sits beside version 0.1 is the lead's to set in the roadmap.

## What is not decided here

- **Building any module.** Calendar, files and booking stay in phase C of the feature scope until a record moves them. Administration's next screens are phase A work of their own.
- **The name.** Whether Podbay is the suite or mail within it is the name review ([#4](https://github.com/cloudhal-dev/podbay/issues/4)). The directories are named by what they hold (`modules/mail`), so the answer does not move a file.
- **The technology of a native client.** That stays with ADR-0005 and its triggers, none of which is met.
- **A second Worker.** Not now. The triggers below say when to look again.
- **The format of the session a native client holds,** and of push: each gets its own record before it is built.
- **Whose a module's things are.** Mail's rights hang on a mailbox's membership; a calendar's or a file's will not. Each module's record decides that, and `authorize` in `workers/auth/authorize.ts` stays the one function that answers (hard rule 3 of `AGENTS.md`).

## Security: the boundaries it touches

- **B4, authorisation.** One route table and one guard for every module (decision 1) keep S1 a single check. A module that brought its own guard would be a second place to get it wrong.
- **B2, mail in the browser and in any client.** The frame's rule is stated for any client (decision 7). Content people upload is never served from the app's origin (decision 9).
- **B3, sign-in.** A bearer credential is a new kind of session. It is decided in its own record, with the guard reading it like a cookie's session, and nothing is built here.
- **B9, dependencies.** The pins and licence checks must read every package before a second one exists (decision 4); otherwise a package could slip both rules.
- **B10, CI.** The required checks keep their names. The workflow lint and the commit check already read the whole repository.

## Consequences

- An installed instance notices nothing: the move changes paths, not names.
- **One Worker is one version.** The suite is built, tested and released as one thing, and a module cannot ship without the others. The release is [#21](https://github.com/cloudhal-dev/podbay/issues/21). A module that must ship on its own schedule is the first trigger below.
- The move costs several pull requests that change many paths and every check that names one. Measured on `main` on 2026-11-19: about 230 code files (`app/`, `workers/`, `shared/`) and 115 test files change path. Until they are done, `shared/` and the folders of today stay as they are.
- A second module starts from packages it can use without copying mail. It cannot depend on mail's inside, and it cannot add a way into the Worker that is not in the one route table.
- Every new message from now on is written in the form of decision 8. The catalogs that exist are brought to it when the messages check learns plural categories.

## Triggers

Look again at **one Worker** when one of these is true:

- A module needs to be deployed on its own schedule, or needs a CPU or subrequest budget of its own.
- A hostname needs a deployment of its own, not only an answer of its own. Another hostname alone is not a trigger: one Worker answers on several custom domains.
- The Worker's uncompressed size comes within a quarter of its 64 MiB limit.

Look again at **running everything on every pull request** when a pull request's wait passes fifteen minutes, or a second module's tests double the job-minutes.

Look again at **catalogs keyed by English** when one of these is true:

- `Intl.MessageFormat` reaches Stage 3.
- A translator's tool must read the catalogs from the first language added.
- A message needs gender or a choice other than a plural.

Look again at **sync protocols** when a test on a real custom domain shows which of PROPFIND, REPORT and MKCALENDAR reach a Worker.

## Sources

Read on 2026-11-19.

- **Cloudflare:** the pages of the ledger entries named above, under `developers.cloudflare.com`:
  - `workers/platform/limits/`;
  - `workers/static-assets/binding/` and `workers/vite-plugin/reference/static-assets/`;
  - `workers/runtime-apis/bindings/service-bindings/` and `workers/platform/pricing/`;
  - `workers/wrangler/configuration/`;
  - `durable-objects/reference/durable-object-class-migrations-legacy/` and `durable-objects/reference/durable-objects-migrations/`;
  - `workers/vite-plugin/reference/api/` and `workers/testing/vitest-integration/configuration/`;
  - `workers/runtime-apis/nodejs/dns/` and `workers/runtime-apis/request/`;
  - `durable-objects/api/alarms/` and `workers/runtime-apis/web-crypto/`.

  Also the HTTP method list `KJ_HTTP_FOR_EACH_REQUEST_METHOD` in `capnproto/capnproto`, `c++/src/kj/compat/http.h`, at the head of branch `v2`.
- **pnpm:** `pnpm.io/workspaces`, `pnpm.io/catalogs`, `pnpm.io/filtering`, `pnpm.io/cli/recursive`, `pnpm.io/settings/dependency-resolution`.
- **Sessions:** `better-auth.com/docs/plugins/bearer` and `better-auth.com/docs/integrations/expo`.
- **Exact:**
  - `github.com/expo/exact`: `README.md`, `rules/DEFERRED.md`, `docs/contract-for-humans.md`, `docs/recipes/web-sessions.md`, `docs/recipes/push.md`, and its tags;
  - `docs.expo.dev` and `docs.expo.dev/modules/additional-platform-support/`;
  - `github.com/microsoft/react-native-macos` and `github.com/microsoft/react-native-windows`.
- **Standards:**
  - RFC 4791 (CalDAV), RFC 4918 (WebDAV), RFC 6764 (finding CalDAV), RFC 8291 and RFC 8292 (Web Push), RFC 9110 (section 12.5.4), RFC 4647 (Lookup);
  - `datatracker.ietf.org/doc/draft-ietf-jmap-calendars/` (revision 34, in the RFC Editor's queue) and `draft-ietf-calext-jscalendarbis/` (revision 22, in last call until 2026-11-26).
- **Languages:**
  - `unicode.org/reports/tr35/tr35-messageFormat.html` and `tr35-numbers.html`;
  - `cldr.unicode.org/downloads/cldr-47` and `cldr-49`;
  - the CLDR plural rules chart;
  - `github.com/tc39/proposal-intl-messageformat`;
  - MDN on `Intl.PluralRules` and `Intl.Locale.prototype.getTextInfo()`;
  - `w3.org/TR/international-specs/`, `w3.org/International/articles/composite-messages/` and `w3.org/International/questions/qa-html-dir`;
  - `docs.oasis-open.org/xliff/xliff-core/v2.2/`;
  - the GNU gettext manual on plural forms;
  - `vite.dev/guide/features`.
