@AGENTS.md

## For Claude Code

`AGENTS.md` above is the one page every coding agent reads. The rest of what Claude Code uses is in `.claude/`:

- **Skills** (`.claude/skills/`) hold the method for each kind of work; `AGENTS.md` lists them under "How to work here". Load the one that matches before editing.
- **Rules** (`.claude/rules/`) are short reminders scoped to paths. They load when you open a file there and name the skill to load.
- **Subagents** (`.claude/agents/`) review and verify without editing. Use them for a second, independent read; they report, and you check what they report.
- **Settings** (`.claude/settings.json`) keep local secrets unread and ask before anything leaves the machine.
