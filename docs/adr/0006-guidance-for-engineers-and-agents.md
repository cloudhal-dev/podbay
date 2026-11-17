# ADR-0006: How engineers and coding agents are guided

- Status: **Proposed** (awaits the project lead; the files it describes exist and are checked)
- Date: 2026-11-17

## Context

Most of Podbay is written by coding agents working with a person. The rules of the project were in one page, `AGENTS.md`, and in one skill for security. Everything else about how the work is done (the order of a change, what "done" means, how a test is written, how the app is built, where a fact about the platform comes from, how the developer's machine is treated) was known only to whoever did the last round. `AGENTS.md` had grown to hold the state of every rule as well, and is read in full at the start of every session.

Guidance that is not found is not followed, and guidance that has drifted is followed wrongly. Both fail quietly.

## Decision

1. **`AGENTS.md` is the one page** for people and for every coding agent, whatever tool they use: what the project is, the commands, the layout, the hard rules, and where the method for each kind of work is. It stays under 200 lines. `CLAUDE.md` imports it and adds nothing a different tool would need.
2. **State is not in `AGENTS.md`.** Which check holds which rule today, what is not enforced and what is knowingly open is [`docs/status.md`](../status.md). Where the project is going and what comes next is [`docs/roadmap.md`](../roadmap.md).
3. **The method for a kind of work is a skill** in `.claude/skills/`, loaded before editing:

   | Skill | Holds |
   |---|---|
   | `podbay-change` | How any change is made, from the first read to the commit; what "done" means; the developer's machine; the report |
   | `podbay-security` | The trust boundaries, their invariants and their proof (on the vendored `security-audit` skill) |
   | `podbay-ui` | How the app is built and what it must never do |
   | `podbay-cloudflare` | Facts about the platform: current sources, recorded |
   | `podbay-testing` | The tiers, the helpers, and the rules a test keeps |

   A skill is short, says when to use it in its description, and links to the documents instead of repeating them.
4. **A rule scoped to paths** (`.claude/rules/`) is a few lines that load when a file under those paths is opened and name the skill that file needs. Nothing that holds everywhere goes there; that is `AGENTS.md`.
5. **Subagents review and verify; they never edit** (`.claude/agents/`): `security-reviewer`, `cloudflare-fact-checker`, `verifier`, `decision-researcher`. Each is given the skills it needs and only the tools to read, search, look up or run. Their reports are checked before they are passed on.
6. **The committed settings** (`.claude/settings.json`) refuse to read local secrets and ask before a push, a deploy, a publish or deleting local state. They allow only the project's own checks without asking.
7. **A decision is an ADR**: proposed by whoever needs it, with the facts and their sources; accepted only by the project lead; never edited afterwards.
8. **All of this is checked** (rule D15, `pnpm static guidance`): the page's length, that every skill and subagent is named on it, that names match folders, that a rule's paths still match files, that a subagent names only skills that exist and cannot edit, and that the settings keep their refusals.

## Consequences

- A session starts with one short page instead of a long one, and loads detail when the work needs it.
- A new kind of recurring work gets a skill, in the change that first needs it, and a row in `AGENTS.md`.
- The files under `.claude/` are written for one tool. The rules themselves are in `AGENTS.md` and `docs/`, which every tool and every person can read; an agent that cannot load a skill reads the file.
- Settings and subagent definitions run on contributors' machines, so a change to them is reviewed like a change to CI (boundary B10 of the security skill).
