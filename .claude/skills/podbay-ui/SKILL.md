---
name: podbay-ui
description: How Podbay's app (everything under app/) is built - React 19, TanStack Router and Query, Kumo components, the content policy the page runs under, accessibility, wording, and the patterns for forms, errors, secrets shown once and sensitive changes. Use it for ANY change under app/ - a page or route, a component, a form or dialog, an empty or error state, wording - and for every review of one. Also use it when adding a browser dependency or anything that loads, injects or renders content.
---

# Podbay's app

The app is a single-page app served as static assets. It shows strangers' mail inside a signed-in session, so its first job is to stay boring: it loads only its own code, injects no markup, and lets the Worker decide everything that matters.

## 1. What it is made of

| Part | Where |
|---|---|
| Routes (code-based) | `app/router.tsx`; one file per screen in `app/routes/` |
| Server state | TanStack Query: hooks in `app/queries/`, keys in `app/queries/keys.ts` |
| Requests | `app/services/api.ts` (mail), `app/lib/session.ts` (account), `app/lib/auth-client.ts` (passkeys and the second step). Errors are `ApiError` |
| Components | Kumo (`@cloudflare/kumo`) with Tailwind 4 and Kumo's tokens (`text-kumo-default`, `bg-kumo-base`, `border-kumo-line`); icons from `@phosphor-icons/react` |
| Shared with the Worker | `shared/` only. The app never imports from `workers/` (`pnpm static imports`) |

## 2. Rules

1. **No markup is injected.** No `dangerouslySetInnerHTML`, `innerHTML` or `srcdoc` anywhere but the mail frame (`pnpm static html`). A message body reaches the screen only through `MessageBody` and `EmailIframe`; text from a message is rendered as text.
2. **The page runs under a strict content policy** ([`shared/security-headers.ts`](../../../shared/security-headers.ts)): its own origin only, no inline script, no `eval`, no other host for scripts, styles, fonts, images or requests. A library that needs any of these does not fit. Draw what you need in the page (the QR code is an SVG built from data), and ship fonts and images with the app.
3. **The Worker decides; the app shows.** Hiding a button is a convenience, never a control. Every action must be safe when called directly.
4. **A sensitive change goes through `useFreshProof()`** ([`app/components/FreshProof.tsx`](../../../app/components/FreshProof.tsx)): it runs the change, and when the Worker asks for fresh proof it shows the sign-in steps and runs the change once more. Do not build a second confirmation.
5. **A secret is shown once and kept nowhere**: a key, a link, a recovery code lives in component state until dismissed. Never in storage, a URL, a query cache or a log.
6. **Every control has a name.** Kumo's `Input` takes `label`; a native control gets a `<label htmlFor>` or `aria-label`; an icon button gets `aria-label`. Errors are `role="alert"`. Move focus by a ref to the form, not by element id (the field library sets ids after the first paint).
7. **Attachments are downloads.** Link to a plain one; a risky one goes through the warning in `EmailAttachmentList`. Only plain image kinds are previewed or embedded (`isShowableImage`).
8. **No new lint warning.** The count in `ratchets.json` only goes down.
9. **The app asks in its own voice** (D16, `pnpm static dialogs`). Anything over the page is Kumo's `LayerDialog`: `LayerDialog.Root` for a form or a view, `LayerDialog.Alert` when the person must choose. `Content` takes exactly one `Title` and one `Body`, and at most one `Description` and one `Actions` with one `Action`; a form lives in `Body` with an `id`, and the `Action` submits it with `form="<id>"`. A confirmation is `useConfirm()` ([`app/components/Confirm.tsx`](../../../app/components/Confirm.tsx)). Never the browser's `confirm`, `alert` or `prompt`, and never Kumo's older `Dialog`. A menu is Kumo's `DropdownMenu`, not a hand-built list.

## 3. How a mailbox behaves

The mail screens follow what a person expects from a first-class web mail client (the bar is the mail people know from Gmail and Google Workspace). The behaviour was studied on the live product and written down here in our own words; nothing of it is copied: no code, no text, no asset. These are decisions; `test/e2e/mailbox.spec.ts` holds each one, `test/e2e/writing.spec.ts` the ones about writing a message, `test/e2e/bulk.spec.ts` the ones about acting on many conversations and the order of a list, `test/e2e/original.spec.ts` the ones about the original of a message, `test/e2e/remembered.spec.ts` the ones about what is remembered beyond one browser: a person's choices and the addresses a mailbox has written to, `test/e2e/live.spec.ts` the ones about what an open tab learns without being asked, and `test/e2e/sending.spec.ts` the ones about what happens after Send.

### The frame

| Behaviour | How it is built |
|---|---|
| A top bar across the width (64px) with one wide, rounded search box (48px); a rail on the left; the mail in one surface | `app/routes/mailbox.tsx`, `Header.tsx`, `Sidebar.tsx` |
| The rail collapses to icons and stays that way; on a phone it slides over the list. Folder names stay as tooltips and accessible names | `isRailCollapsed` in `useUIStore`, remembered in this browser only |
| One list **or** one conversation by default. Opening a conversation is a navigation (`?open=<id>`), so Back returns to the list and a reload shows the conversation again | `MailView.tsx`: the address is the truth |
| The reader can choose a **reading pane**: beside the list on a screen at least 1024px wide, or under it on a screen at least 640px tall, the conversation opens with the list still there. Then moving through the list with `j` and `k` opens what the cursor is on, the list keeps the keys that file a conversation, and filing the open one closes the pane | `useSplit` in `app/hooks/useDisplay.ts`, `MailView.tsx`, `MessageList.tsx` |
| The reader chooses how tall a line is: Default (40px), Comfortable (48px), Compact (32px). Both choices live in the Display menu of the top bar and are remembered in this browser only | `DisplayMenu.tsx`, `useDisplay.ts` |
| A search has **quick filters** above its results: one press adds an operator to the query (has an attachment, unread, in the inbox) and a second takes it out; the search box always says what is searched | `routes/search-results.tsx`; `toggleOperator` in `app/lib/search-parser.ts` |
| The search box has **search options**: who, subject, words, folder, dates, attachment, unread. They write the query a person could type, so the box always shows what is searched, and they open filled with what the box says | `SearchOptions.tsx`; `buildSearchQuery` and `searchOptionsOf` in `app/lib/search-parser.ts` |
| The browser tab says how much of the inbox is unread: `(3) address - Podbay` | `app/routes/mailbox.tsx` |
| Starred is a search (`is:starred`), not a folder | The rail links to the search screen |
| **Scheduled** is a place of its own in the rail, under Drafts (ADR-0016): mail that was sent and has not left yet, with how many wait beside it. Its list is not the list of the other places: what waits is shown soonest first, one line for each message with who it goes to and its time, and nothing is ticked, dragged, starred, moved or labelled there, because nothing changes a waiting message but its own deeds. **Drafts** says beside its count how many messages came back unsent, and such a line is marked "Not sent" | `Sidebar.tsx` (`waiting` and `notSent` of `GET …/folders`), `ScheduledList.tsx`, `routes/email-list.tsx`, `MessageList.tsx` |
| Every screen has a heading, shown or not | `<h1 className="sr-only">` in `MessageList.tsx` |

### The list

| Behaviour | How it is built |
|---|---|
| **Trash and Spam have a line above the list**: how much is there, and one button that deletes all of it for good (ADR-0009). The app asks first and says how much goes; the mailbox deletes in batches, the line says how far it is, and leaving the page stops it where it is. No other place has the line | `EmptyPlace.tsx`, `workers/routes/places.ts`, `workers/durableObject/emptying.ts` |
| A conversation is one dense line: checkbox, star, sender, subject and the start of the text, date. Where the list is narrow (a phone, or beside the reading pane) a line is two rows of text; this follows the width of the list, not of the screen (container queries). Unread is bold. The line under the pointer lifts, and it or the line the keyboard is on shows quick actions in place of the date | `MessageList.tsx`, shared by folders and search results |
| Each line is one real button, with a checkbox and a star beside it. No clickable `div` | `MessageList.tsx` |
| Holding Shift while ticking a line ticks, or unticks, every line from the last box used to this one | `toggle` in `MessageList.tsx` |
| The box above the list selects the page; the menu beside it selects by kind: All, None, Read, Unread, Starred, Unstarred | `MessageListToolbar.tsx` |
| With nothing selected the bar refreshes, pages, and offers "Mark this page as read". With a selection it shows, in this order: Archive, Report spam (Not spam inside Spam), Delete; then Mark as read or unread (whichever applies), Move to, Label as. In Sent it offers Delete alone of the first three: sent mail goes only to Trash | `MessageListToolbar.tsx` |
| **A line is a conversation in a place, and what is done to lines is one request**, however many are ticked (ADR-0014): from the toolbar, a line's menu, its quick actions, a drag or a key. A move takes every message of the conversation that is in that place; read, taking a star and labels take the conversation outside Spam and Trash; unread and a star go to the newest message of the line. With conversation view off a line is one message, and the request says so. The mailbox decides all of it; the app only names the lines | `act` in `app/hooks/useConversationActions.ts`; `POST …/bulk` (`workers/routes/bulk.ts`, `workers/durableObject/deeds.ts`). The request's types come from `shared/bulk.ts` with `import type`, so the schema library stays out of the app |
| Once **a whole page is ticked**, a line above the list offers everything in the place, or everything the search finds. Choosing a deed then asks in the app's own dialog with the count the mailbox gave (conversations, and messages in all); the deed runs in steps, the same line says how far it is, and leaving the page stops it where it is. Drafts offer no such line, everything in Trash is deleted for good only by emptying it, and "Move to" a label is not offered for a search across places | `SelectEverything.tsx`; `everything` in `useConversationActions.ts`; the `everything` prop of `MessageList.tsx`, given by `routes/email-list.tsx` and `routes/search-results.tsx` (`app/lib/search-filter.ts` makes the list's request and the deed's filter from the same words) |
| **The order of a list** is a person's choice: newest first, unread first or starred first, in the Display menu and in General settings, kept where the page size is kept: with the person's account. The request carries it (`order`); the Worker never acts on a stored choice | `order` in `app/hooks/useDisplay.ts`, `DisplayMenu.tsx`, `settings/GeneralSettings.tsx`, `routes/email-list.tsx`, `queries/search.ts` |
| A line has a **menu on a right click** (and on the menu key): open, reply, reply to all, forward, archive, delete, read or unread, star, spam, move to, label as, find messages from the sender, open in a new tab. On a line that is part of a selection it acts on the selection | `ConversationMenu.tsx`: a Kumo `DropdownMenu` opened at the pointer through its `anchor` |
| A line can be **dragged onto a place or a label in the rail**; a line of a selection takes the selection with it. It does what "Move to" does and is only a shortcut for the pointer. Sent and Drafts take no drop | `useDropTarget.ts`; the conversations are held in `useUIStore` while dragged, the drag itself carries only a mark |
| An action applies to what is selected, or to the line the keyboard is on | `targets()` in `MessageList.tsx` |

### What an action does

| Behaviour | How it is built |
|---|---|
| Everything done to conversations (a move, read or unread, a star, a label) says what happened in a toast with **Undo**; `z` does the same while the toast is there. Undo is a call to the mailbox, which keeps for an hour what each message had: it puts back what is still as the deed left it and leaves alone what was changed again since. A line the deed could not take (sent mail to Archive, a label in Spam) is named on the note's second line | `act`, `offerUndo` and `takeBack` in `app/hooks/useConversationActions.ts`, used by the list and the open conversation alike; the words of every note and question are in `app/lib/deed-words.ts` |
| A message's own menu acts on that message: its deeds say `message` as their unit, so a move or a mark takes it alone (labels stay the conversation's) | `messageActions` in `EmailPanel.tsx` |
| **Delete means Trash.** Only inside Trash is a message deleted for good, and then the app asks first in its own dialog | `remove` in `useConversationActions.ts` |
| Mail cannot be moved into Sent, Drafts or Scheduled: only a message that left fills Sent, only writing makes a draft, only a send fills Scheduled. A conversation in Sent goes only to Trash, and Undo puts it back into Sent from the mailbox's record. A draft is not moved with other lines: deleted from the Drafts list it goes to Trash by itself | `moveTargets`, `fromSent` and `moveTo` in `useConversationActions.ts` |

### Labels (ADR-0007)

A message is in one place and carries any number of labels. Places are fixed; everything a person makes is a label.

| Behaviour | How it is built |
|---|---|
| Labels are listed in the rail under the places, each with its colour and unread count. A label is made, renamed, recoloured and deleted there; deleting one asks first and deletes no mail | `RailLabels.tsx`, `LabelDialog.tsx` |
| A `/` in a label's name puts it under the label named before it: the rail shows the labels as a tree, each with the part of its name its parent does not already say. Where no such parent exists the label stands at the top with its whole name | `app/lib/label-tree.ts`, `RailLabels.tsx` |
| A label's list is a search (`label:<name>`), as Starred is. It never shows what is in Spam or Trash | The rail links to the search screen; `useSearchEmails` sends the label by id |
| A line and an open conversation show the labels the conversation carries as chips: a dot of the label's colour and its name | `LabelChip.tsx` |
| **"Label as"** gives or takes labels and leaves the conversation where it is; the menu stays open so several are set in one visit. **"Move to"** a label gives it and takes the conversation out of the inbox, with one Undo | `LabelMenu.tsx`, `MoveMenu.tsx`; `label` and `moveToLabel` in `useConversationActions.ts` |
| A colour is an index into a palette of classes written out in full. It is never built from input and never set as an inline style | `app/lib/labels.ts` |

### An open conversation

| Behaviour | How it is built |
|---|---|
| The bar keeps the same order as the list's: Back; Archive, Report spam, Delete; Mark as unread, Move to, Star; a More menu at the right | `email-panel/EmailPanelToolbar.tsx` |
| Filing a conversation away (archive, spam, delete, move, mark as unread) returns to the list | `away` in `EmailPanel.tsx` |
| The subject is a large, plain heading; Reply, Reply all and Forward are buttons under the last message | `EmailPanelHeader.tsx`, `EmailPanel.tsx` |
| A conversation is read **oldest first**. Its newest message and whatever is still unread are open, the rest are folded to one line each; the conversation's menu opens or folds all of them. A message deleted or reported from a conversation is no longer shown in it | `EmailPanel.tsx`, `ThreadMessage.tsx` |
| A conversation of five messages or more keeps its middle (between the first and the last two) behind one line that says how many are there | `EmailPanel.tsx` |
| Every message is as tall as it is: the conversation scrolls, never a message inside it. **Quoted text at the end of a reply is folded** behind "Show quoted text", inside the mail frame, and opens without script | `foldQuote` in `app/lib/mail-html.ts` (the renderer: load `podbay-security` before touching it) |
| **Each message has its own header and menu**: who wrote it (the name opens what can be done with the sender: write to them, find their mail, copy the address), "to" with the full details one click away, a star, Reply, and a menu: reply, reply to all, forward, delete this message, mark as unread, report spam, find messages from this sender, print, and then "Show original" and "Download message" for a message whose original is kept, or "Show headers" for one that has none. They act on that message, not on the conversation | `email-panel/MessageHeader.tsx`; `messageActions` in `EmailPanel.tsx` |
| **The original of a message** (ADR-0015) is the bytes it arrived as. "Show original" opens them as text, the first 256 KB, and says of how much: the header block, then what follows it. It is text and only text: text nodes in one preformatted block, never markup, never the mail frame, no link; a control character, and a character that changes the direction of text or takes no room, is drawn as a mark with its code point (`U+202E`), and the block is laid out left to right whatever it holds, so a line reads in the order of its bytes. "Download message" saves all of them as `message-YYYYMMDD-xxxxxxxx.eml`, a name the app makes; before that the app says, in its own dialog, that the file holds the whole message with every attachment and that another program opens it without Podbay's protections, and it names the attachments that can do harm. Only a received message has an original, and the Worker says which (`has_original`): a sent message and mail from before originals were kept offer "Show headers" instead, which says what the list is and why there is no original. What the platform recorded about SPF, DKIM and DMARC is written as the platform's statement, in a sentence, without a tick, a colour or a word of Podbay's own, and only under "Show original"; it is drawn only when the Worker gives it (`AUTHENTICATION_SHOWN` in `shared/original.ts`, off until the live check of the record is done) | `email-panel/OriginalMessage.tsx`; `markOriginal` and `authenticationWords` in `app/lib/original-text.ts`; `app/lib/original.ts`; `email-panel/EmailPanelDialogs.tsx` (the headers); `workers/routes/original.ts` |
| **A message Podbay could not read** (its structure, a text too large to keep, or a handler stopped twice) is in the inbox with the sender of the envelope, no subject and no text. Where its body would be, the app says that it could not read it and why, and offers the original to see and to save. It is never drawn in the mail frame | `email-panel/UnreadMessage.tsx`; `unparsed` in a message's answer |
| Mail from a list offers **Unsubscribe** beside the sender, when the message says how in `List-Unsubscribe`. The header is the sender's, so only an `https:` page without credentials, or a `mailto:` to one address, is taken. A page is opened by the person after the app says where it leads; a message is written for the person to send. Podbay contacts nobody by itself | `app/lib/unsubscribe.ts`, `leaveList` in `EmailPanel.tsx` |
| **Print** prints one message or the whole conversation: on paper there is the mail and none of the app (`print:` classes on the frame, the rail, the bars and the compose window). The conversation's menu also opens it in a new tab | `EmailPanel.tsx`, `routes/mailbox.tsx`, `MailView.tsx` |
| Newer and Older step to the conversation above or below in the list it was opened from (the page on screen), and read it as opening it from the list does | `useOpenConversation.ts`, `EmailPanel.tsx` |

### Writing

| Behaviour | How it is built |
|---|---|
| Writing floats: the compose window sits at the bottom right over whatever is being read and never closes it. Its title bar shows the subject once there is one, and minimises, enlarges or closes the window | `ComposeWindow.tsx` |
| **What is written is saved by itself** a moment after the person stops writing, and the window says "Saved". One window keeps one draft; sending or discarding waits for a save that is on its way, so no draft is left behind. Files are not in a draft | `saveDraft` and the effect after it in `useComposeForm.ts` |
| **Closing keeps what was written** as a draft; only Discard (the bin at the right of the bottom row) throws it away. One window keeps one draft however often it is saved | `saveAndClose`, `discard` in `useComposeForm.ts` |
| Fields have no boxes: To (with Cc and Bcc on demand), Subject, the message. Send is first in the bottom row | `ComposePanel.tsx` |
| **An answer is written under its conversation**: Reply, Reply to all and Forward from an open conversation (its buttons, a message's menu, `r` `a` `f`) open the answer where the reply buttons were. It can be moved out to the window, and moves there by itself when the conversation is left. A new message, and an answer started from a line's menu, open in the window | `InlineReply.tsx`; the message being written is held above both places by `ComposeSession.tsx`, so moving it loses nothing |
| **Files** are attached with the paperclip or by dropping them on the message. Each is listed with its size and can be taken off. Together they are held to what a message can carry (`shared/sending-limits.ts`), and the Worker holds the draft to the same. **The draft keeps its files** (ADR-0011): a file is uploaded once, into the draft, and shows how far it is; closing the window keeps it, and the draft opened in any browser has it. A message is sent from its draft, which becomes the sent message, and is not sent while a file is still on its way. A forward's files are copied inside the account and never pass through the browser; one that can do harm is named and left, and added only after the person was told what it is and agreed | `ComposePanel.tsx`, `useDraftFiles.ts`, `useComposeForm.ts`; `workers/routes/drafts.ts`, `workers/lib/outgoing.ts` |
| **An address that is done is a chip** that can be taken off; a comma, a semicolon, Enter or leaving the field ends the one in hand, and Backspace in the empty field takes the last chip off. Something that does not look like an address is marked. The value stays addresses separated by commas | `AddressField.tsx`; the rules of typing are pure functions in `app/lib/address-suggestions.ts` |
| **A forward carries the files** of the message it forwards, fetched as the reader could download them. One that can do harm when opened is left behind and named, as is what would not fit | `carryFiles` in `useComposeForm.ts` |
| **An address is completed while it is typed** (ADR-0012). The mailbox remembers the addresses it has written to and is asked a moment after the last key; its answers are shown first, at most eight, more used first. What the lists loaded in this browser show is the second source, offered at once and without Spam and Trash. Arrows choose, Enter or Tab takes, and Enter never sends the message while a suggestion is offered. A suggestion always shows the whole address; a name stands beside it, never in its place. An address the mailbox remembers can be forgotten from its suggestion, by its button or by Shift with Delete, and is then not offered again while the message is written. The mailbox learns an address only when a person sends mail from it: never from mail that arrives, so a stranger cannot plant one. The answers are kept in memory only, for as long as the message is written. It completes; it is not an address book, and nothing lists what the mailbox knows | `AddressField.tsx`; `mergeSuggestions` in `app/lib/address-suggestions.ts`; `useKnownAddresses.ts`; `GET …/known-addresses?q=` (`workers/routes/known-addresses.ts`, `workers/durableObject/known.ts`); the limits are in `shared/known-addresses.ts` |
| The **formatting bar** follows the order people know: undo and redo; size, bold, italic, underline, text colour, highlight; alignment, numbered and bulleted lists, indent less and more; quote, strikethrough, link, rule, remove formatting. What it writes into a message is literal (a size in pixels, a colour as a number), never a token of the app's theme: mail is read in other programs. The bar reads the selection through `useEditorState`, because the editor does not draw it again by itself; a menu of the bar gives the cursor back to the text when it closes (`finalFocus`), and menus are ordered above the compose window in `app/index.css` | `app/components/editor/Toolbar.tsx`, `RichTextEditor.tsx` |
| A link is added in a dialog of the app. A dialog opened from inside the compose form stops its own submit and keys there: React passes events through a portal, and the form would send the message | `RichTextEditor.tsx` |
| A new message starts in To; a reply starts in the text, above what it answers. Ctrl or Cmd with Enter sends | `ComposePanel.tsx` |
| **Send is honest** (ADR-0016). The mailbox takes a message and lets it leave later, so the app never says "sent" at the press. It says "Sending…" and offers **Undo** for the window the person chose (5, 10 or 30 seconds; there is no "off"), and for no longer: Undo is offered only while it can still work. Undo makes the message a draft again, with the same files, and opens the compose window on it as it was being written. When the window is over the app asks the mailbox, and says "Message sent" when the mailbox says so, or that the message was not sent and why. The request carries the window (`undo_seconds`); the Worker never reads a stored choice | `send`, `offerUndo` and `sayWhenGone` in `app/hooks/useSending.ts`, used by the compose form and by Send on an open draft; `POST …/emails/:id/unsend` (`workers/routes/sending.ts`) |
| **Send later** stands beside Send: a few times of the app's own (in an hour, tomorrow morning, tomorrow afternoon, Monday morning) and a date and time, in this device's time zone. Every choice is shown back with its date and time before it is taken; what travels is the instant in UTC (`send_at`). The note says when the message is scheduled for and offers Undo. A dialog opened from the compose form keeps its keys, its typing and its submit from the form, and lies above the compose window (`app/index.css`) | `SendLater.tsx`; `laterChoices`, `timeRefusal` and `timeWords` in `app/lib/sending-words.ts` |
| **A waiting message opens read-only**, with a line above it that says when it will be sent and offers its four deeds: Send now and Change the time (`POST …/emails/:id/reschedule`), Cancel send (back to Drafts) and Edit, which is cancelling and opening the draft in one press. The bar above it files nothing, and its message has no menu. Someone who may only read sees the line and no button. A waiting message inside a conversation that is open elsewhere shows the same line | `email-panel/SubmissionNotice.tsx`, `waits` in `EmailPanel.tsx`, the `waiting` prop of `EmailPanelToolbar.tsx` |
| **A message that could not leave is a draft again**, with its files. It is counted in the rail, marked on its line, and opened it says why in the app's own words (`reasonWords`: a sentence for each reason of Podbay and each code of the sending service, never the service's text and never a code), with Dismiss to take the mark off; Send sends it again, Edit shows the reason above the compose form. When nobody knows whether it left (`unknown`), the words say that it may have been sent | `SubmissionNotice.tsx`, `ComposePanel.tsx` (`notSent`), `app/lib/sending-words.ts` |

### Settings

| Behaviour | How it is built |
|---|---|
| Settings are one screen with tabs, as a mail client has them; the open tab is in the address (`?tab=`). **General** is the reader's own choices; the other tabs are about the mailbox, and **Account** says where the person's own account is looked after (password, passkeys, sessions) | `app/routes/settings.tsx`, `app/components/settings/` |
| A person's choices take effect at once, without a Save button, and are **kept with their account** (ADR-0012), so they are the same in every browser the person signs in to: conversations on a page (10, 25, 50, 100), the order of a list, conversation view on or off, snippets, actions on a line, what the Reply button of a message does, where to go after a conversation is filed, a "Send and archive" button, how long a sent message can still be taken back (ADR-0016), keyboard shortcuts on or off, light or dark, the language of the app's own words. Three **stay with the device**, because their right value depends on it: density, the reading pane, notifications of new mail (and the collapsed rail, which `useUIStore` keeps). The screen says which is which | `shared/choices.ts` is the schema, for the Worker and the app: which choices there are, their values and defaults, and where each is kept. A new choice is a line there, its Turkish, and a decision about where it is kept; `test/unit/choices.test.ts` pins the list |
| **The browser's copy draws the first paint**, so the language and the appearance hold before anything is asked. Then the account's document is read, when the app loads and when its tab is come back to, and wins for the choices that travel. A change is sent with only the keys that changed (a default as `null`); one that could not be sent stays in force here, is remembered as unsent and goes at the next contact. The copy says whose it is: when someone else signs in on the same browser, the travelling part is theirs. When the account has no document yet, the first browser brings its choices along. An unknown stored value falls back to its default. The Worker stores the choices and never decides by them | `useDisplay`, `syncChoices` and `useChoicesSync` in `app/hooks/useDisplay.ts`, called from `SessionGate` in `app/router.tsx`; `fetchChoices` and `saveChoices` in `app/lib/session.ts`; `GET` and `PUT /api/v1/me/choices` (`workers/routes/choices.ts`). The app never loads `shared/choices-schema.ts`, the strict half, so the schema library stays out of its bundle |
| With **conversation view off** every message is its own line and is read by itself; the list is asked for without conversations, which the API has always offered | `useEmails`, `EmailPanel.tsx` |
| **Send and archive**, when asked for, is a second button on an answer: it sends, files the answered conversation in Archive at once and returns to the list; the note says both when the message has left | `handleSend` in `useComposeForm.ts` |
| **Notifications**, when asked for and allowed by the browser, announce mail that arrives while Podbay is open in a tab: the sender and the subject, nothing of the message, and nothing for what was already there. The mailbox says when mail arrived and the app then asks once for the top of the inbox; a move, a label or anything else that is told makes it ask for nothing. Only while nothing is telling the tab does it look every half minute. Nothing is pushed to a closed app | `NewMailNotifier.tsx`; its look has a query key of its own (`newMailKey` in `app/hooks/useLive.ts`) |
| Light or dark is the `data-mode` attribute on the document, set before the first paint; "as this device" follows the device while the app is open. A message keeps the colours its sender gave it | `showAppearance` in `useDisplay.ts` |
| What belongs to the mailbox is saved to it with its own button, by an owner; others see it and are told who can change it: the name mail is sent under, the signature, the assistant's prompt. Labels are managed here as well as in the rail. The Mailbox tab also says that the mailbox remembers the addresses it has written to, and lets an owner have it forget them all, after the app asked (ADR-0012, decision 20) | `MailboxDetails.tsx`, `SignatureSettings.tsx`, `AssistantSettings.tsx`, `LabelSettings.tsx` |
| A setting is never shown for something the Worker does not do. Forwarding and an automatic reply have a stored shape and no behaviour, so they have no screen | The roadmap, section 4 |

### What changes elsewhere (ADR-0013)

The mailbox tells the open app that something changed, and nothing more. What changed is read through the ordinary requests, with the rights they always had.

| Behaviour | How it is built |
|---|---|
| **New mail, a move, a label and read state appear by themselves**, in every open tab and for every member of a shared mailbox, within about a second and without a reload. Nothing on the screen says that there is a connection, and nothing is different when there is none except the wait | `useLive` in `app/hooks/useLive.ts`, mounted once by the frame (`app/routes/mailbox.tsx`): one connection for the mailbox on screen, open while the tab is, seen or not |
| The connection carries **four counters and no mail** (`delivery`, `mail`, `labels`, `settings`). The app compares each with the one it holds and reads again what that kind can have touched: lists, searches, the places' counts and the labels for `mail` and `labels`, the mailbox for `settings`, the notifier's look for `delivery`. Never draw anything from the message itself: it has nothing to draw | `shared/live.ts` is the schema, for the object and the app; `refetchMoved` in `useLive.ts` |
| **The connection is never trusted to be there.** A list asks by itself every half minute without one, as it always did, and every five minutes with one. A screen that needs to be current asks `useAskEvery(mailboxId)` for its interval and never assumes a signal | `useAskEvery` and `useLiveConnected` in `useLive.ts`; `routes/email-list.tsx` |
| When it drops the app tries again after a second, then double the wait up to a minute, each time by a random part less, and from the start once a connection held for ten seconds. It says `ping` once a minute and takes ten seconds without an answer for a connection that is gone. After about four minutes it opens a new one, through the guard again, and closes the old one when the new one has spoken, so a person never sees it. A burst of messages is one refetch at once and then at most one a second | `LiveConnection` in `app/lib/live.ts`: no React, the browser handed in, so every rule is a unit test (`test/unit/live.test.ts`) |
| A failed handshake tells a page nothing, so the app **does not guess why** and shows no error for it: the ordinary requests answer 401 or 404, and what the app does with those takes over. A message of a version the app does not know ends the connection for this tab, which goes on asking | `LiveConnection`; `readLiveMessage` in `shared/live.ts` |
| The app closes its connections **before it signs out** | `closeLive` in `app/lib/live.ts`, called by `signOut` in `app/lib/session.ts` |
| The address is the app's own host and the mailbox, **never a token**; the page's `connect-src 'self'` is what lets it open and is not widened. A browser that refuses reports it, and the tab stays on asking | `liveUrl`; the `securitypolicyviolation` listener in `useLive.ts` |

### The keyboard

The keyboard does everything common: `c`, `/`, `j` `k`, `o`, `u`, `x`, `*` then `a` or `n`, `e`, `#`, `!`, `s`, `Shift+I` `Shift+U`, `r` `a` `f`, `k` `j`, `]` `[` (archive and go on) and `;` `:` (open or fold all) in an open conversation, `z` to take back the last move while its note is on screen, `g` then a letter, `?` (`useShortcuts`). Shortcuts never fire while typing, with a modifier held, or while a dialog or a menu is open.

### Not built yet

Snooze, importance markers and category tabs. Add one with its line above and its test.

A new behaviour of this kind gets a line here and a test there, in the same change.

## 4. Wording

- Plain words, short sentences, the reader's point of view: say what happens, not how it works.
- One sentence for a failed sign-in or a bad code, the same for every reason, so the answer does not say which part was wrong.
- Say what a button will do before it does something that cannot be undone.
- A term is used one way everywhere: owner, administrator, member (of the instance); owner, sender, reader (of a mailbox); key; recovery link; authenticator app; passkey.
- The experience to match is a first-class web mail client: fast, quiet, predictable. No other product is named in the app or the repository.

### Words are messages (D8, `pnpm static messages`)

The app speaks English and Turkish. Every word a person reads or hears goes through `app/i18n/`:

| To show | Write | Why |
|---|---|---|
| Words | `t("Archive")`, `t("Remove {name}", { name })` | A message is named by its English text; a value goes in by name |
| A count | `plural(count, "{count} attachment", "{count} attachments")` | Each form is a message; a language with one form translates both the same |
| A sentence with an element in it | `rich("You were invited as {email}.", { email: <strong>…</strong> })` from `~/i18n/rich` | The sentence stays whole, so a language can put the element where its grammar wants it |
| Words kept in a constant | `m("Reply")` in the constant, `t(value)` where it is shown | `t` reads the language when it is called; a module is loaded once |
| A word that is two things | `m("place\|Archive")` and `t("Archive")` | The word before the bar says what the message is about; English is what follows it |
| A date | `dateLanguage()` as the locale; `formatListDate(date, dateLanguage())` | English leaves the date order to the device; another language is named |

- **Never join pieces of a sentence in code** (`{t("Signed in as")} {email}`): word order differs. Put the value in the message.
- A new message gets its Turkish in the same change; the check fails without it, and fails for a translation the code no longer names. The Turkish catalog is `app/i18n/tr.ts`, which joins two files so that neither passes the size a file may have: `app/i18n/tr/a-to-m.ts` for messages whose English begins, in upper case, before "N", and `app/i18n/tr/n-to-z.ts` for the rest. A message goes into the one its English belongs to, in order.
- Names and code are not messages: Podbay, MCP, a header name, a search operator inside `<code>`.
- Mail is never translated, and neither is a name a person gave (a label, a mailbox). What the Worker answers is English for now.
- The language is a choice of the person (`language` in `useDisplay`: this device's, English or Türkçe), kept with their account and in the browser's copy, which the first paint is drawn from. Changing it draws the app again (`RootLayout` in `app/router.tsx`).

## 5. Patterns to reuse

| Need | Use |
|---|---|
| A setting: its name and a line about it, then the control | `Row` and `Choice` in `app/components/settings/Row.tsx` |
| A page outside a mailbox | `app/routes/security.tsx`, `app/routes/members.tsx`: a centred column of bordered sections |
| A form that makes something shown once | `app/components/InvitePerson.tsx`, `app/components/AccessKeys.tsx` |
| A list with an action per row and a confirmation | `app/components/People.tsx`, the rows in `AccessKeys.tsx` |
| Copy to the clipboard | `app/components/CopyButton.tsx` |
| Text a stranger wrote that must stay text, with what cannot be seen drawn as marks | `markOriginal` in `app/lib/original-text.ts`, as `OriginalText` in `email-panel/OriginalMessage.tsx` draws it |
| The steps of signing in | `app/components/SignInSteps.tsx` (the sign-in page and the confirmation use the same steps) |
| A list of conversations with selection, quick actions and paging | `app/components/MessageList.tsx` |
| A confirmation before something that cannot be undone | `useConfirm()` from `app/components/Confirm.tsx` |
| A dialog with a form | The "Create folder" dialog in `app/components/Sidebar.tsx` |
| Something done to conversations (move, archive, spam, delete, read, star, label) | `useConversationActions` in `app/hooks/useConversationActions.ts`; it sends one request for the lines and brings the toast and Undo |
| A line above a list that says how much is there and offers one thing to do with all of it | `EmptyPlace.tsx`, `SelectEverything.tsx` |
| A toolbar button that is only an icon | `app/components/IconButton.tsx` |
| A menu of things to tick | `app/components/LabelMenu.tsx` (`DropdownMenu.CheckboxItem`) |
| A keyboard shortcut | `useShortcuts` in `app/hooks/useShortcuts.ts`; add it to `SHORTCUT_HELP` so the `?` dialog lists it |
| Sending a message from anywhere, with Undo and the mailbox's own word afterwards | `useSending` in `app/hooks/useSending.ts`. Never say "sent" yourself |
| Choosing a time | `SendLater.tsx` (a menu of times and a dialog with a date and time, each shown back) |

## 6. A new screen

1. Add the route in `app/router.tsx`; if it works without a session, add it to `SIGNED_OUT_PATHS` or `SIGNED_OUT_PREFIXES`.
2. Add it to the list of pages in `test/e2e/policy.spec.ts`, so the content policy is tried on it.
3. If it changes anything, the route it calls is in the Worker's route table with its right, and marked fresh when the change is sensitive ([`podbay-security`](../podbay-security/SKILL.md)).

## 7. Before you finish

- [ ] `pnpm check` passes and the lint count did not rise.
- [ ] `pnpm e2e` passes; a new page is in the policy test; a new journey has a browser test when it crosses a boundary.
- [ ] You tried it in a browser on the built app, not only in development mode, and with the keyboard alone.
- [ ] Empty, loading and error states exist and say something true.
- [ ] Every new word is a message with its Turkish (`pnpm static messages`), and you read the screen once in Turkish: nothing cut off, nothing left in English.
