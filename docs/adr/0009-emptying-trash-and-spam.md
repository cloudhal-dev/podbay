# ADR-0009: Trash and Spam can be emptied in one step

- Status: **Proposed** (awaits the project lead)
- Date: 2026-11-17
- Sources: the repository, and the Cloudflare facts already recorded in the [ledger](../cloudflare/ledger.json) on 2026-11-17.

## Context

In the mail people know from Gmail and Google Workspace, Trash and Spam each have one line above the list: empty it now. In Podbay a message is deleted for good one at a time: the app asks, then calls the route that deletes one message, its rows and its attachments. A person with four hundred messages in Trash selects a page, deletes, and does it again sixteen times.

The app could loop over the pages itself, but that is a loop of requests the page must keep alive, it stops when the tab closes, and it leaves the place half emptied without saying so. Deleting everything in a place is one thing the mailbox should do, or not do.

It is a decision because it adds a route that deletes for good (boundary B4, rule S13) and that other programs can call.

## Decision (proposed)

1. **One route empties a place**: `POST …/folders/:folderId/empty`. It takes only `trash` and `spam`; any other place is refused, so there is no way to empty the inbox by a mistaken id.
2. **It needs `mailbox.write`**, as deleting one message does. It is not marked for fresh proof: what it removes was already thrown away or reported, and the app asks first, in its own dialog, saying how many conversations go.
3. **It deletes what was there when it was asked**: the messages in that place at the start of the call, their label rows, their attachment rows, and their objects in R2. Mail that arrives in Spam while it runs stays.
4. **It works in batches and says what it did**: it answers with the number of messages deleted and whether anything is left, and the app calls again while something is. A batch is small enough for one request (a query takes 100 bound parameters, and the objects of a batch are deleted from R2 before the next batch is taken); a mailbox is never left with rows whose objects are gone, or objects whose rows are gone, beyond the batch in flight.
5. **No MCP tool and no assistant tool empties a place.** The tool list keeps saying that nothing is deleted for good from there.
6. **Sticky name, fixed by this record:** the route above.

## What is not decided here

- Deleting what has been in Trash or Spam for thirty days by itself. It needs a timer in the mailbox object and its own record.
- Acting on everything a search or a folder holds (select all four hundred, then label or move them).
- Emptying a label.

## Consequences

- Trash and Spam get a line above the list: how many conversations are there, and "Empty Trash now" or "Delete all spam now".
- Rule S13 gets one more test: after emptying, the place, the label rows, the attachment rows and the bucket hold nothing of what was there.
- The work is small: the mailbox object's method and its test in the Workers runtime, the route with its right, the app's line and dialog, a browser test.

## Triggers

Look again when one of these is true:

- A mailbox is found half emptied after a failed call.
- Automatic deletion after a period is wanted.
