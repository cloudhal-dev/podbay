# ADR-0004: MCP clients use keys first; OAuth follows

- Status: **Accepted**
- Date: 2026-11-17
- Decided by: Halil (@madraka), project lead
- Amends: [ADR-0001](0001-founding-decisions.md), where OAuth for MCP clients was part of phase A

## Context

The seed's MCP server was reachable by anyone who could reach the app, took any mailbox id and could send mail. The first rounds closed it to everyone but the instance owner and left it off by default. To make it usable, every MCP request needs an identity of its own, limited to mailboxes, and no way to send (rules S1 and S9).

The plan named OAuth 2.1 with a consent screen for this. That is the right end state: the client never sees a long-lived secret, and the person sees what they grant. It is also the larger piece of work: an authorisation server, client registration, a consent screen, token storage and rotation, and each of those is a trust boundary with its own tests. None of it changes what a tool may do once the caller is known.

## Decision

1. **The authorisation model is built first and does not depend on how the caller signed in.** Every tool call is checked against the mailboxes the credential was made for and against its owner's membership at that moment. A mailbox outside that set looks exactly like one that does not exist.
2. **The first credential is a key.** A person makes it in Podbay for mailboxes they are a member of, to read or to read, organise and draft. It is stored as a digest, shown once, can have an end date, and its owner can revoke it. A browser session is never accepted on the MCP endpoint.
3. **No MCP tool sends, forwards or deletes for good.** A client leaves a draft; a person sends it in Podbay. This is stricter than "a send needs a confirmation" and needs no confirmation flow.
4. **The endpoint is stateless.** A server is built for one request and holds nothing afterwards, so a revoked key or a lost membership takes effect on the next call.
5. **OAuth 2.1 with PKCE and a consent screen comes next, as a second way to obtain the same narrow grant.** It replaces nothing in points 1, 3 and 4.

## Consequences

- MCP is usable now by clients that can send a bearer header, and stays off unless `MCP_ENABLED` is `"true"`.
- A key is a bearer secret that lives in a client's configuration. A leaked key works until it is revoked or reaches its end date; the default end date in the app is 90 days.
- There is no per-tool grant: a key is read-only or read-and-draft. Finer grants come with the consent screen.
- Clients that only support OAuth cannot connect yet.
- Still open after this ADR: a rate limit per key, an audit record per call, and scanning of mail read through MCP.
