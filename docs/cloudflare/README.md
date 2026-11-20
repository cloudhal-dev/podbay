# Cloudflare facts ledger

Rule V5 of the [engineering rules](../engineering-rules.md): Cloudflare facts come from current sources, never memory. [`ledger.json`](ledger.json) is where each fact is recorded: what Podbay relies on, the page it was read from, the day it was read and a quote from that page.

A fact is anything Cloudflare decides and Podbay depends on:

- a key, a binding kind or a compatibility flag in `wrangler.jsonc`;
- a runtime API the Worker calls (the `email` handler, the send binding, R2, Durable Object storage, Workers AI);
- a limit or a plan fact that the design cites (a size, a quota, a price, a beta label);
- a behaviour of the local tooling that the tests or local development depend on.

## Entry format

```json
{
	"id": "wrangler.send_email",
	"kind": "config",
	"relies": "A `send_email` entry with only a `name` gives the Worker the `EMAIL` send binding.",
	"source": "https://developers.cloudflare.com/email-service/api/send-emails/workers-api/",
	"pageUpdated": "2026-10-30",
	"verifiedAt": "2026-11-17",
	"evidence": "Configure a `send_email` binding in your Wrangler configuration file to enable email sending:",
	"code": ["wrangler.jsonc", "modules/mail/worker/email-sender.ts"],
	"note": "Optional. Where the page is narrower than the code assumes, or disagrees with it."
}
```

| Field | Meaning |
|---|---|
| `id` | Unique and dotted. The prefix says what it is: `wrangler.`, `runtime.`, `limit.`, `plan.`, `tooling.` |
| `kind` | `config`, `runtime`, `limit`, `plan` or `tooling` |
| `relies` | One or two sentences: what Podbay relies on |
| `source` | The page, under `https://developers.cloudflare.com/`. A file under `https://raw.githubusercontent.com/cloudflare/` is allowed when no docs page states the fact |
| `pageUpdated` | The "Last updated" date printed on the page, or `null` when the source shows none |
| `verifiedAt` | The day the source was read and the fact confirmed, or `null` |
| `evidence` | A quote copied from the source, at most 200 characters |
| `code` | The repository files that rely on the fact. Each must exist |
| `note` | Optional. Anything a reader must know that the quote does not say |

An entry that could not be confirmed stays in the ledger with `"verifiedAt": null`, and its `evidence` starts with `needs verification:` and says what is missing. An honest `null` is better than a guess.

## Ids for `wrangler.jsonc`

The check derives the ids it expects from the configuration file:

| In `wrangler.jsonc` | Ledger id |
|---|---|
| A top-level key or binding kind, such as `send_email` | `wrangler.send_email` |
| A value of `compatibility_flags`, such as `nodejs_compat` | `wrangler.compatibility_flags.nodejs_compat` |
| A key under `assets`, such as `run_worker_first` | `wrangler.assets.run_worker_first` |
| A directive in a `migrations` step, such as `new_sqlite_classes` | `wrangler.migrations.new_sqlite_classes` |
| The same keys inside an `env` environment | The same ids |

`$schema` needs no entry.

## Adding or refreshing an entry

1. Read the current page as Markdown. Every docs page has a copy at `<page-url>/index.md`, and each product lists its pages at `https://developers.cloudflare.com/<product>/llms.txt`:

   ```bash
   curl -sS -L https://developers.cloudflare.com/email-service/platform/limits/index.md
   ```

2. Find the sentence, table row or line of code that states the fact. Copy it into `evidence` exactly as it is written.
3. Set `pageUpdated` from the page's "Last updated" line and `verifiedAt` to today.
4. If the page does not state the fact, or says something else, set `verifiedAt` to `null`, describe the gap after `needs verification:`, and raise it in the change. When the docs and the observed behaviour disagree, the behaviour wins and the entry keeps both in `note`.
5. Change the code and the ledger in the same commit.

## The check

`scripts/checks/ledger.ts` fails when:

- an entry lacks a field, has an unknown field or an unknown `kind`;
- `source` is outside the two allowed hosts;
- `evidence` is empty or longer than 200 characters;
- `pageUpdated` or `verifiedAt` is neither a `yyyy-mm-dd` date nor `null`;
- `verifiedAt` is `null` and `evidence` does not start with `needs verification:`, or the other way round;
- two entries share an id, or a `code` path does not exist;
- `wrangler.jsonc` uses a key, a binding kind, a compatibility flag, an asset option or a migration directive without an entry;
- a `wrangler.*` entry matches nothing in `wrangler.jsonc`.

Age is a report, not a failure. This lists the entries that are unverified or were verified more than 90 days ago:

```bash
node scripts/checks/ledger.ts --stale
```

The check cannot tell whether a quote is still on the page. Refreshing an entry means reading the page again.
