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

The mail screens follow what a person expects from a first-class web mail client (the bar is the mail people know from Gmail and Google Workspace). The behaviour was studied on the live product and written down here in our own words; nothing of it is copied: no code, no text, no asset. These are decisions; `test/e2e/mailbox.spec.ts` holds each one, and `test/e2e/writing.spec.ts` the ones about writing a message.

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
| Every screen has a heading, shown or not | `<h1 className="sr-only">` in `MessageList.tsx` |

### The list

| Behaviour | How it is built |
|---|---|
| A conversation is one dense line: checkbox, star, sender, subject and the start of the text, date. Where the list is narrow (a phone, or beside the reading pane) a line is two rows of text; this follows the width of the list, not of the screen (container queries). Unread is bold. The line under the pointer lifts, and it or the line the keyboard is on shows quick actions in place of the date | `MessageList.tsx`, shared by folders and search results |
| Each line is one real button, with a checkbox and a star beside it. No clickable `div` | `MessageList.tsx` |
| Holding Shift while ticking a line ticks, or unticks, every line from the last box used to this one | `toggle` in `MessageList.tsx` |
| The box above the list selects the page; the menu beside it selects by kind: All, None, Read, Unread, Starred, Unstarred | `MessageListToolbar.tsx` |
| With nothing selected the bar refreshes, pages, and offers "Mark this page as read". With a selection it shows, in this order: Archive, Report spam (Not spam inside Spam), Delete; then Mark as read or unread (whichever applies), Move to | `MessageListToolbar.tsx` |
| A line has a **menu on a right click** (and on the menu key): open, reply, reply to all, forward, archive, delete, read or unread, star, spam, move to, label as, find messages from the sender, open in a new tab. On a line that is part of a selection it acts on the selection | `ConversationMenu.tsx`: a Kumo `DropdownMenu` opened at the pointer through its `anchor` |
| A line can be **dragged onto a place or a label in the rail**; a line of a selection takes the selection with it. It does what "Move to" does and is only a shortcut for the pointer. Sent and Drafts take no drop | `useDropTarget.ts`; the conversations are held in `useUIStore` while dragged, the drag itself carries only a mark |
| An action applies to what is selected, or to the line the keyboard is on | `targets()` in `MessageList.tsx` |

### What an action does

| Behaviour | How it is built |
|---|---|
| Every move (archive, spam, Trash, a folder) says what happened in a toast with **Undo**, which puts each conversation back where it was; `z` does the same while the toast is there | `moveTo` in `app/hooks/useConversationActions.ts`, used by the list and the open conversation alike |
| **Delete means Trash.** Only inside Trash is a message deleted for good, and then the app asks first in its own dialog | `remove` in `useConversationActions.ts` |
| Mail cannot be moved into Sent or Drafts: only sending fills Sent, only writing makes a draft | `moveTargets` in `useConversationActions.ts` |

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
| **Each message has its own header and menu**: who wrote it (the name opens what can be done with the sender: write to them, find their mail, copy the address), "to" with the full details one click away, a star, Reply, and a menu: reply, reply to all, forward, delete this message, mark as unread, report spam, find messages from this sender, print, show headers. They act on that message, not on the conversation | `email-panel/MessageHeader.tsx`; `messageActions` in `EmailPanel.tsx` |
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
| **Files** are attached with the paperclip or by dropping them on the message. Each is listed with its size and can be taken off. Together they are held to what a message can carry (`shared/sending-limits.ts`), and the Worker holds the request to the same. A draft does not keep files, and the window says so | `ComposePanel.tsx`, `useComposeForm.ts` |
| **An address that is done is a chip** that can be taken off; a comma, a semicolon, Enter or leaving the field ends the one in hand, and Backspace in the empty field takes the last chip off. Something that does not look like an address is marked. The value stays addresses separated by commas | `AddressField.tsx`; the rules of typing are pure functions in `app/lib/address-suggestions.ts` |
| **A forward carries the files** of the message it forwards, fetched as the reader could download them. One that can do harm when opened is left behind and named, as is what would not fit | `carryFiles` in `useComposeForm.ts` |
| **An address is completed while it is typed** from the addresses in the lists this browser has already loaded: arrows choose, Enter or Tab takes, and Enter never sends the message while a suggestion is offered. It asks the Worker nothing and is not an address book | `AddressField.tsx`, `app/lib/address-suggestions.ts`, `useKnownAddresses.ts` |
| The **formatting bar** follows the order people know: undo and redo; size, bold, italic, underline, text colour, highlight; alignment, numbered and bulleted lists, indent less and more; quote, strikethrough, link, rule, remove formatting. What it writes into a message is literal (a size in pixels, a colour as a number), never a token of the app's theme: mail is read in other programs. The bar reads the selection through `useEditorState`, because the editor does not draw it again by itself; a menu of the bar gives the cursor back to the text when it closes (`finalFocus`), and menus are ordered above the compose window in `app/index.css` | `app/components/editor/Toolbar.tsx`, `RichTextEditor.tsx` |
| A link is added in a dialog of the app. A dialog opened from inside the compose form stops its own submit and keys there: React passes events through a portal, and the form would send the message | `RichTextEditor.tsx` |
| A new message starts in To; a reply starts in the text, above what it answers. Ctrl or Cmd with Enter sends | `ComposePanel.tsx` |

### Settings

| Behaviour | How it is built |
|---|---|
| Settings are one screen with tabs, as a mail client has them; the open tab is in the address (`?tab=`). **General** is the reader's own choices; the other tabs are about the mailbox, and **Account** says where the person's own account is looked after (password, passkeys, sessions) | `app/routes/settings.tsx`, `app/components/settings/` |
| A person's choices take effect at once, without a Save button, and are kept **in this browser only**: conversations on a page (10, 25, 50, 100), density, reading pane, conversation view on or off, snippets, actions on a line, what the Reply button of a message does, where to go after a conversation is filed, a "Send and archive" button, notifications of new mail, keyboard shortcuts on or off, light or dark, the language of the app's own words. An unknown stored value falls back to its default | `useDisplay` (`app/hooks/useDisplay.ts`); never something the Worker decides by |
| With **conversation view off** every message is its own line and is read by itself; the list is asked for without conversations, which the API has always offered | `useEmails`, `EmailPanel.tsx` |
| **Send and archive**, when asked for, is a second button on an answer: it sends, files the answered conversation in Archive and returns to the list | `handleSend` in `useComposeForm.ts` |
| **Notifications**, when asked for and allowed by the browser, announce mail that arrives while Podbay is open in a tab: the sender and the subject, nothing of the message, and nothing for what was already there. The app looks at the top of the inbox every half minute; it is not pushed anything | `NewMailNotifier.tsx` |
| Light or dark is the `data-mode` attribute on the document, set before the first paint; "as this device" follows the device while the app is open. A message keeps the colours its sender gave it | `showAppearance` in `useDisplay.ts` |
| What belongs to the mailbox is saved to it with its own button, by an owner; others see it and are told who can change it: the name mail is sent under, the signature, the assistant's prompt. Labels are managed here as well as in the rail | `MailboxDetails.tsx`, `SignatureSettings.tsx`, `AssistantSettings.tsx`, `LabelSettings.tsx` |
| A setting is never shown for something the Worker does not do. Forwarding and an automatic reply have a stored shape and no behaviour, so they have no screen | The roadmap, section 4 |

### The keyboard

The keyboard does everything common: `c`, `/`, `j` `k`, `o`, `u`, `x`, `*` then `a` or `n`, `e`, `#`, `!`, `s`, `Shift+I` `Shift+U`, `r` `a` `f`, `k` `j`, `]` `[` (archive and go on) and `;` `:` (open or fold all) in an open conversation, `z` to take back the last move while its note is on screen, `g` then a letter, `?` (`useShortcuts`). Shortcuts never fire while typing, with a modifier held, or while a dialog or a menu is open.

### Not built yet

Snooze, importance markers, category tabs, scheduled send and undo of a send. Add one with its line above and its test.

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
- A new message gets its Turkish in `app/i18n/tr.ts` in the same change; the check fails without it, and fails for a translation the code no longer names.
- Names and code are not messages: Podbay, MCP, a header name, a search operator inside `<code>`.
- Mail is never translated, and neither is a name a person gave (a label, a mailbox). What the Worker answers is English for now.
- The language is a choice of the person (`language` in `useDisplay`: this device's, English or Türkçe). Changing it draws the app again (`RootLayout` in `app/router.tsx`).

## 5. Patterns to reuse

| Need | Use |
|---|---|
| A setting: its name and a line about it, then the control | `Row` and `Choice` in `app/components/settings/Row.tsx` |
| A page outside a mailbox | `app/routes/security.tsx`, `app/routes/members.tsx`: a centred column of bordered sections |
| A form that makes something shown once | `app/components/InvitePerson.tsx`, `app/components/AccessKeys.tsx` |
| A list with an action per row and a confirmation | `app/components/People.tsx`, the rows in `AccessKeys.tsx` |
| Copy to the clipboard | `app/components/CopyButton.tsx` |
| The steps of signing in | `app/components/SignInSteps.tsx` (the sign-in page and the confirmation use the same steps) |
| A list of conversations with selection, quick actions and paging | `app/components/MessageList.tsx` |
| A confirmation before something that cannot be undone | `useConfirm()` from `app/components/Confirm.tsx` |
| A dialog with a form | The "Create folder" dialog in `app/components/Sidebar.tsx` |
| Something done to conversations (move, archive, spam, delete, read, star) | `useConversationActions` in `app/hooks/useConversationActions.ts`; it brings the toast and Undo |
| A toolbar button that is only an icon | `app/components/IconButton.tsx` |
| A menu of things to tick | `app/components/LabelMenu.tsx` (`DropdownMenu.CheckboxItem`) |
| A keyboard shortcut | `useShortcuts` in `app/hooks/useShortcuts.ts`; add it to `SHORTCUT_HELP` so the `?` dialog lists it |

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
