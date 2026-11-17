---
name: podbay-cloudflare
description: The rule for every Cloudflare fact in Podbay (V5) - read the CURRENT source, never memory, and record it in docs/cloudflare/ledger.json. Use it for ANY change to wrangler.jsonc (a binding, a variable, the compatibility date or a flag, assets, routes), to how the Worker uses Durable Objects, D1, R2, Email Routing, the send_email binding, Workers AI, static assets or the _headers file, to the Vite plugin or the agents SDK, and whenever code, a comment or a document says how Cloudflare behaves, what a limit is, what a plan includes or what a header means. Also use it when asked "does Cloudflare still...", even when no file is named yet.
---

# Cloudflare facts come from current sources

Podbay runs on one platform and depends on its exact behaviour. That behaviour changes, and what a model or a person remembers about it is a snapshot of some earlier day. So a Cloudflare fact enters the repository in one way only: someone read the source today and wrote down where.

## 1. The method

1. **State the fact** the code will rely on, in one or two sentences. If you cannot, you do not know yet what you depend on.
2. **Read the source now.** In this order:

   | Source | How |
   |---|---|
   | The documentation page, as text | `https://developers.cloudflare.com/<path>/index.md` (follow a redirect; note the page's own "last updated" date) |
   | The API's OpenAPI document | For anything about the REST API |
   | The changelog | For "since when" and "still" |
   | The package you installed | Its shipped types and documentation in `node_modules`, for an SDK's options (the docs can be ahead or behind the version you pinned) |

3. **Quote it.** One verbatim sentence, at most 200 characters, that says the fact.
4. **Record it** in [`docs/cloudflare/ledger.json`](../../../docs/cloudflare/ledger.json), in the same change as the code.
5. **Run** `pnpm static ledger`. It fails when `wrangler.jsonc` uses something no entry covers, or an entry covers something the file no longer uses.

## 2. An entry

```json
{
	"id": "wrangler.assets.run_worker_first",
	"kind": "config",
	"relies": "Only the listed route patterns reach the Worker before the assets.",
	"source": "https://developers.cloudflare.com/workers/static-assets/binding/",
	"pageUpdated": "2026-11-12",
	"verifiedAt": "2026-11-17",
	"evidence": "You can also specify `run_worker_first` as an array of route patterns ...",
	"code": ["wrangler.jsonc", "workers/app.ts"]
}
```

| Field | Rule |
|---|---|
| `id` | Dotted and unique: `wrangler.<key>` for configuration, `runtime.<thing>` for behaviour, `limit.<thing>`, `plan.<thing>`, `tooling.<thing>` |
| `kind` | `config`, `runtime`, `limit`, `plan` or `tooling` |
| `relies` | What Podbay depends on, not what the page is about |
| `pageUpdated` | The page's own date, or `null` when it shows none |
| `verifiedAt` | The day you read it. `null` only with `evidence` starting `needs verification:` |
| `evidence` | The verbatim quote |
| `code` | The files that rely on it |
| `note` | Optional: where the source is narrower than the code assumes, or where two sources disagree |

## 3. When sources disagree

Write both down in `note`, build for the narrower one, and say so in your report. Documentation that calls a product "beta" while the API calls it generally available is a fact about both.

## 4. What is not a Cloudflare fact

Behaviour of Hono, Better Auth, React or the browser belongs in a code comment next to the code that depends on it, and in a test. The ledger is for the platform.

## 5. Staleness

`node scripts/checks/ledger.ts --stale` lists entries that are unverified or older than 90 days. Re-read the source, update `verifiedAt` and the quote, and fix the code if the fact moved. Never bump the date without reading.

## 6. Never

- Write a limit, a default, a flag name or a header's meaning from memory, including what you were trained on.
- Copy a quote from another entry or from a search result's summary instead of the page.
- Leave an entry behind for something the code stopped using.
