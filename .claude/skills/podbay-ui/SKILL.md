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

The mail screens follow what a person expects from a first-class web mail client (the bar is the mail people know from Gmail and Google Workspace). The behaviour was studied on the live product and written down here in our own words; nothing of it is copied: no code, no text, no asset. These are decisions; `test/e2e/mailbox.spec.ts` holds each one.

### The frame

| Behaviour | How it is built |
|---|---|
| A top bar across the width (64px) with one wide, rounded search box (48px); a rail on the left; the mail in one surface | `app/routes/mailbox.tsx`, `Header.tsx`, `Sidebar.tsx` |
| The rail collapses to icons and stays that way; on a phone it slides over the list. Folder names stay as tooltips and accessible names | `isRailCollapsed` in `useUIStore`, remembered in this browser only |
| One list **or** one conversation, never both. Opening a conversation is a navigation (`?open=<id>`), so Back returns to the list and a reload shows the conversation again | `MailView.tsx`: the address is the truth |
| Starred is a search (`is:starred`), not a folder | The rail links to the search screen |
| Every screen has a heading, shown or not | `<h1 className="sr-only">` in `MessageList.tsx` |

### The list

| Behaviour | How it is built |
|---|---|
| A conversation is one dense line (40px): checkbox, star, sender, subject and the start of the text, date. Unread is bold. The line under the pointer lifts, and it or the line the keyboard is on shows quick actions in place of the date | `MessageList.tsx`, shared by folders and search results |
| Each line is one real button, with a checkbox and a star beside it. No clickable `div` | `MessageList.tsx` |
| The box above the list selects the page; the menu beside it selects by kind: All, None, Read, Unread, Starred, Unstarred | `MessageListToolbar.tsx` |
| With nothing selected the bar refreshes, pages, and offers "Mark this page as read". With a selection it shows, in this order: Archive, Report spam (Not spam inside Spam), Delete; then Mark as read or unread (whichever applies), Move to | `MessageListToolbar.tsx` |
| An action applies to what is selected, or to the line the keyboard is on | `targets()` in `MessageList.tsx` |

### What an action does

| Behaviour | How it is built |
|---|---|
| Every move (archive, spam, Trash, a folder) says what happened in a toast with **Undo**, which puts each conversation back where it was | `moveTo` in `app/hooks/useConversationActions.ts`, used by the list and the open conversation alike |
| **Delete means Trash.** Only inside Trash is a message deleted for good, and then the app asks first in its own dialog | `remove` in `useConversationActions.ts` |
| Mail cannot be moved into Sent or Drafts: only sending fills Sent, only writing makes a draft | `moveTargets` in `useConversationActions.ts` |

### An open conversation

| Behaviour | How it is built |
|---|---|
| The bar keeps the same order as the list's: Back; Archive, Report spam, Delete; Mark as unread, Move to, Star; a More menu at the right | `email-panel/EmailPanelToolbar.tsx` |
| Filing a conversation away (archive, spam, delete, move, mark as unread) returns to the list | `away` in `EmailPanel.tsx` |
| The subject is a large, plain heading; Reply, Reply all and Forward are buttons under the last message | `EmailPanelHeader.tsx`, `EmailPanel.tsx` |

### Writing

| Behaviour | How it is built |
|---|---|
| Writing floats: the compose window sits at the bottom right over whatever is being read and never closes it. Its title bar shows the subject once there is one, and minimises, enlarges or closes the window | `ComposeWindow.tsx` |
| **Closing keeps what was written** as a draft; only Discard (the bin at the right of the bottom row) throws it away. One window keeps one draft however often it is saved | `saveAndClose`, `discard` in `useComposeForm.ts` |
| Fields have no boxes: To (with Cc and Bcc on demand), Subject, the message. Send is first in the bottom row | `ComposePanel.tsx` |
| A new message starts in To; a reply starts in the text, above what it answers. Ctrl or Cmd with Enter sends | `ComposePanel.tsx` |

### The keyboard

The keyboard does everything common: `c`, `/`, `j` `k`, `o`, `u`, `x`, `*` then `a` or `n`, `e`, `#`, `!`, `s`, `Shift+I` `Shift+U`, `r` `a` `f` in an open conversation, `g` then a letter, `?` (`useShortcuts`). Shortcuts never fire while typing, with a modifier held, or while a dialog or a menu is open.

### Not built yet

Labels, snooze, a reading pane beside the list, list density, importance markers, category tabs, a search-options panel, scheduled send, and a context menu on a line. Add one with its line above and its test.

A new behaviour of this kind gets a line here and a test there, in the same change.

## 4. Wording

- Plain words, short sentences, the reader's point of view: say what happens, not how it works.
- One sentence for a failed sign-in or a bad code, the same for every reason, so the answer does not say which part was wrong.
- Say what a button will do before it does something that cannot be undone.
- A term is used one way everywhere: owner, administrator, member (of the instance); owner, sender, reader (of a mailbox); key; recovery link; authenticator app; passkey.
- English only for now. The experience to match is a first-class web mail client: fast, quiet, predictable. No other product is named in the app or the repository.

## 5. Patterns to reuse

| Need | Use |
|---|---|
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
