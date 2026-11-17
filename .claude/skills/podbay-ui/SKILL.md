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
6. **Every control has a name.** Kumo's `Input` takes `label`; a native control gets a `<label htmlFor>` or `aria-label`; an icon button gets `aria-label`. Errors are `role="alert"`. Dialogs are Kumo's `Dialog`. Move focus by a ref to the form, not by element id (the field library sets ids after the first paint).
7. **Attachments are downloads.** Link to a plain one; a risky one goes through the warning in `EmailAttachmentList`. Only plain image kinds are previewed or embedded (`isShowableImage`).
8. **No new lint warning.** The count in `ratchets.json` only goes down.

## 3. How a mailbox behaves

The mail screens follow what a person expects from a first-class web mail client. These are decisions; `test/e2e/mailbox.spec.ts` holds each one.

| Behaviour | How it is built |
|---|---|
| The frame: a top bar across the width with one wide search box, a rail on the left, the mail in one surface | `app/routes/mailbox.tsx`, `Header.tsx`, `Sidebar.tsx` |
| The rail collapses to icons and stays that way; on a phone it slides over the list. Folder names stay as tooltips and accessible names | `isRailCollapsed` in `useUIStore`, remembered in this browser only |
| One list **or** one conversation, never both. Opening a conversation is a navigation (`?open=<id>`), so Back returns to the list and a reload shows the conversation again | `MailView.tsx`: the address is the truth |
| A conversation is one dense line: sender, subject and the start of the text, date. Unread is bold. The line under the pointer or the keyboard shows quick actions in place of the date | `MessageList.tsx`, shared by folders and search results |
| Each line is one real button, with a checkbox and a star beside it. No clickable `div` | `MessageList.tsx` |
| The toolbar acts on what is selected, or on the line the keyboard is on | `targets()` in `MessageList.tsx` |
| **Delete means Trash.** Only inside Trash is a message deleted for good, and then it asks first | `remove` in `MessageList.tsx`, `handleDelete` in `EmailPanel.tsx` |
| Writing floats: the compose window sits over whatever is being read, never closes it, minimises to its title and keeps what was written | `ComposeWindow.tsx` |
| The keyboard does everything common: `c`, `/`, `j` `k`, `o`, `u`, `x`, `e`, `#`, `s`, `g` then a letter, `?` | `useShortcuts`. Shortcuts never fire while typing, with a modifier held, or while a dialog is open |
| Starred is a search (`is:starred`), not a folder | The rail links to the search screen |
| Every screen has a heading, shown or not | `<h1 className="sr-only">` in `MessageList.tsx` |

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
