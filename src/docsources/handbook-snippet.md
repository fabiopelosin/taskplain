This repo uses Taskplain.

All work must flow through the Taskplain CLI to keep task history in-repo and deterministic. Verify installation: `taskplain --help`

**Core Workflow**

1. **Find work**: Search with `taskplain list --search "keyword" --output json` or check ready tasks with `taskplain list --state ready --output json`
2. **Start task**: Always run `taskplain pickup <id>` first—this verifies readiness, promotes parent tasks if needed, advances the task to in-progress, and bundles all ancestor context
3. **During work**:
   - Update acceptance criteria checkboxes (`- [ ] ...`) every few minutes to show progress
   - Keep task metadata current after each logical change
   - Ensure acceptance criteria are complete before starting—fix gaps immediately
4. **Finish task**: When all checkboxes are done, fill "Post-Implementation Insights" (Changelog, Decisions, Architecture), run `taskplain complete <id>`, then commit with `[Task:<id>]` trailer
5. **Validate**: Run `taskplain validate` after manual edits to prevent schema violations

**Critical Rules**

- Work on one task at a time. Handle multiple requests sequentially.
- When asked for a change, search for existing tasks first (`taskplain list --search`). Update if exists, create new if not.
- Task IDs must be short slugs: 1-3 lowercase words, hyphen-separated, ≤24 chars, concrete nouns (e.g., `hero-cta`, `billing-a11y`, `nav-refactor`)
- **Never return with in-progress tasks when all acceptance criteria are checked.** Complete the task fully before responding.
- If you discover new work during implementation, finish the current task first, then propose new tasks.
- Set dispatch metadata when updating: `size`, `ambiguity`, `executor`, `isolation`, `touches`; keep `depends_on`/`blocks` accurate.

**Overview**

Tasks live under `tasks/`. One file per task. Deterministic commands with JSON everywhere.

**Command Reference**

Querying:
- `taskplain list --output json` — all tasks
- `taskplain list --state ready --output json` — ready tasks
- `taskplain list --priority high|urgent --output json` — by priority
- `taskplain list --search "auth|login" --output json` — keyword search
- `taskplain tree <id> --output json` — task hierarchy
- `taskplain tree --open --output json` — open work by state

Lifecycle:
- `taskplain new --title "<title>" [--kind <epic|story|task>]` — create task
- `taskplain pickup <id>` — start work (promotes parents, advances to in-progress, bundles context)
- `taskplain update <id> --meta size=small --field overview "text"` — update metadata/sections
- `taskplain move <id> <state> [--cascade ready|cancel]` — change state (default: no cascade)
- `taskplain complete <id>` — finish task and timestamp completion
- `taskplain delete <id> [--dry-run]` — remove task

Maintenance:
- `taskplain validate [--fix] [--rename-files] [--strict]` — check/repair schema
- `taskplain adopt <parent> <child> [--before <sibling>]` — reparent task
- `taskplain cleanup --older-than <Nd|Nm> [--dry-run]` — archive old done tasks
- `taskplain inject AGENTS.md` — refresh managed snippet
- `taskplain help --all` — full CLI reference

All commands accept `--output human|json`. Use `--dry-run` for previews before destructive operations.

**Git Commits**

Use conventional commits with task trailer: `git commit -m "feat(scope): description  [Task:<id>]"`

**Further Reading**

- Refresh snippet: `taskplain inject AGENTS.md`
- Full handbook: `taskplain help handbook --section all --format md`
- Machine contract: `taskplain help --json`
- All CLI help: `taskplain help --all`
