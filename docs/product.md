# Product Requirements Document — Taskplain

## Purpose

Taskplain provides a deterministic, repository-native workflow for planning, executing, and auditing work. It keeps the entire task lifecycle inside Git, enabling humans and AI agents to reason about intent, history, and status without external dependencies.

## Problems Solved

**Lost Intent and Context**
Traditional ticketing systems separate task rationale from code, forcing developers and agents to infer motivations from commit messages alone. Context degrades over time as discussions occur in external tools.

**State Drift**
Ad-hoc task notes, spreadsheets, or conversational updates quickly diverge from reality. No single source of truth exists for current work status.

**Expensive Coordination**
Conversational loops with AI agents burn tokens and time because every participant must rebuild context from scratch, repeatedly asking "what was I working on?" or "why did we make this decision?"

**Solution**
Taskplain keeps tasks as Markdown files in your repository, making context accurate, reviewable in PRs, and efficiently accessible through deterministic CLI commands and JSON output.

## Core Principles

**Repository as Database**
Tasks are Markdown files in `tasks/` with YAML frontmatter. Git provides versioning, branching, and history.

**Deterministic Operations**
All CLI commands are idempotent with stable JSON output. Same inputs always produce same outputs.

**Convention Over Configuration**
Fixed directory structure (`tasks/{00-idea,10-ready,20-in-progress,30-done,40-canceled}/`), standardized filenames, no per-repo config files.

**Agent-First Design**
Every command supports `--output json` and `--dry-run`. Exit codes distinguish success/validation-error/IO-error.

**Performance**
Fast local operations. `validate` runs in milliseconds, `list` and `tree` are instant, `next` ranks hundreds of tasks quickly.

---

## Goals and Non-Goals

### Version 0.1 Goals

- **Complete CLI** with all core task lifecycle commands
- **Deterministic automation** via stable JSON output and idempotent operations
- **Parallel agent execution** with conflict-aware task dispatch (`touches` checking)
- **Local Kanban board** (`taskplain web`) for visual task management
- **Git integration** for moves, staging, and commit trailer generation
- **Fast validation** with auto-fix capabilities
- **CI enforcement** via GitHub Actions running `pnpm verify` + `taskplain validate`

### Non-Goals (v0.1)

- Hosted services or persistent daemons (web server is ephemeral, local-only)
- Bidirectional sync with external issue trackers (GitHub, Linear, Jira)
- Monorepo support (single `tasks/` directory per repo)
- Automated task size estimation or time tracking
- Custom workflows or state machines (fixed states only)

---

## Directory Structure and Naming

### State Directories

```
tasks/
  00-idea/          # Inbox for proposals and rough ideas
  10-ready/         # Triaged, specified, ready for execution
  20-in-progress/   # Active work
  30-done/          # Completed tasks
  40-canceled/      # Abandoned work
```

**Rules:**

- Numeric prefixes ensure stable ordering with gaps for future states
- State slug is the word after the number (e.g., "ready" from "10-ready")

### Filename Convention

**Active tasks:**

```
[kind]-[id].md
# Examples:
epic-landing-page.md
story-hero-refresh.md
task-fix-navbar.md
```

**Completed tasks:**

```
[YYYY-MM-DD] [kind]-[id].md
# Example:
2025-10-09 story-hero-refresh.md
```

### ID Requirements

- Short slugs: 1-3 lowercase words, hyphen-separated
- Maximum 24 characters total
- Prefer concrete nouns (`hero-cta`, `billing-fix`, `nav-refactor`)
- Avoid sentence-length descriptions

---

## Task Schema

### YAML Frontmatter

```yaml
# Identity
id: hero-refresh # Unique slug (required)
title: Refresh hero section design # Human-readable title
kind: epic | story | task # Hierarchy level

# State and Priority
state: idea | ready | in-progress | done | canceled
priority: none | low | normal | high | urgent
blocked: waiting on design # Optional blocker description

# Sizing and Dispatch
size: tiny | small | medium | large | xl
ambiguity: low | medium | high
executor: simple | standard | expert | human_review
isolation: isolated | module | shared | global

# Relationships
children: [story-copy, story-assets] # Ordered child IDs
depends_on: [nav-refactor] # Prerequisite task IDs
blocks: [checkout-flow] # Tasks this blocks

# Metadata
assignees: [fabio, agent-1]
labels: [frontend, accessibility]
touches: [src/components/Hero.tsx] # File globs affected
links: [] # External references

# Timestamps
created_at: 2025-10-01T10:00:00Z
updated_at: 2025-10-01T10:00:00Z
completed_at: null
last_activity_at: 2025-10-01T10:00:00Z
```

### Required Body Sections

```markdown
## Overview

Brief description of what needs to be done and why.

## Acceptance Criteria

- [ ] Specific, measurable outcomes
- [ ] Must be checkboxes for validation
- [ ] Clear definition of "done"

## Technical Approach

Implementation strategy, key decisions, architectural considerations.

<!-- ## Post-Implementation Insights -->
<!-- Uncomment and fill before marking complete:
- What actually changed
- Decisions made during implementation
- Architectural impacts
-->

`taskplain validate` only requires the insights heading once the task is in the `done` state; the commented scaffold lets idea/ready/in-progress work pass without manual edits.
```

### Hierarchy Rules

- **Depth limit:** Epic → Story → Task (max 3 levels)
- **No cycles:** Tasks cannot be their own ancestor
- **Ordered execution:** `children` array defines execution order
- **Validation:** Parent cannot complete while children are active

---

## Maintenance Workflow

### Cleanup completed tasks

- Operators run `taskplain cleanup --older-than <Nd|Nm>` to prune done work; start with `--dry-run` to review candidates.
- Cleanup deletes the task Markdown files after extracting Post-Implementation Insights. Capture changelog, decision, and architecture bullets in the dedicated docs before running it.
- Deleted files remain in Git history for audit and recovery; rely on `git checkout` or `git show` if a past task needs to be resurrected.

### Dispatch Heuristics

The `taskplain next` command ranks tasks by:

1. Priority (urgent → high → normal → low)
2. Epic in-flight bonus (prefer tasks in active epics)
3. Size (smallest first)
4. Executor fit (match agent capabilities)
5. Ambiguity (clearest first)
6. Isolation (most isolated first)
7. Staleness (older updated_at first)

Only `ready`-state tasks enter the ranking pool; use `taskplain list --state in-progress` when you need to recover active work.

**Conflict detection:** Tasks with overlapping `touches` globs cannot run in parallel unless forced.

### Continuous Integration

- GitHub Actions workflow `.github/workflows/ci.yml` runs on every push and pull request targeting `main`.
- Steps: install dependencies with `pnpm install --frozen-lockfile`, execute `pnpm verify`, then run `node dist/cli.js validate` to enforce task hygiene.
- Dependency installs reuse the pnpm store via `pnpm/action-setup` and `actions/setup-node` caching which keeps job time under control.
- Merges require a green CI run so regressions are blocked before they reach `main`.

---

## Command Interface

### Global Options

- `--output human|json` – Available on all commands
- `--dry-run` – Preview mutations without applying
- `--color auto|always|never` – Control ANSI output

### Core Commands

**Initialization**

```bash
taskplain init                    # Create tasks/ structure
taskplain inject <file>           # Add agent instructions
```

**Task Creation**

```bash
taskplain new --title "..." [--kind epic|story|task] [--parent <id>]
# Creates task file, assigns ID, prints path
```

**Task Management**

```bash
taskplain list [--state ready] [--priority high,urgent]
taskplain pickup <id>             # Move to in-progress with context
taskplain complete <id>           # Validate and mark done
taskplain update <id> --meta key=value
taskplain move <id> <state> [--cascade ready|cancel]
```

**Validation**

```bash
taskplain validate [--strict] [--fix] [--rename-files]
# Check schema, structure, dependencies
# --fix applies automatic repairs
# --strict treats warnings as errors
```

**Workflow**

```bash
taskplain next [--parallelize N]  # Get ranked ready tasks
taskplain tree [--open]           # Show hierarchy
taskplain web [--port 3000]       # Launch Kanban board
```

**Reference Dumps**

```bash
taskplain help --all              # Combined --help output for root + subcommands
taskplain help --json             # Machine-readable command contract
```

---

## Agent Integration

### Design for Automation

- All commands are idempotent
- JSON output schemas are stable across versions
- Dry-run mode available for all mutations
- File locks prevent concurrent modifications
- Exit codes distinguish success/no-op/error

### Example Agent Workflow

```bash
# Agent picks up highest priority task
TASK=$(taskplain next --output json | jq -r '.id')

# Get full context including parent and children
taskplain pickup $TASK --output json

# Execute work...

# Validate and complete
taskplain validate $TASK --strict
taskplain complete $TASK
```

---

## Web Interface

`taskplain web` launches a local Kanban board with:

- Drag-and-drop state transitions
- Inline task creation and editing
- Real-time updates via WebSocket
- Acceptance criteria progress tracking
- Parent-child relationship visualization
- Responsive two-column layout for task details

**Architecture:**

- Fastify server on 127.0.0.1
- `/api/tasks` REST endpoints
- `/ws` WebSocket for live updates
- CDN-first dependencies (marked, canvas-confetti)
- Deterministic port allocation per project without writing repo-side cache files

---

## Quality Assurance

### Validation Rules

- **Schema:** Required fields, valid enums, timestamp formats
- **Structure:** Required body sections with proper headings
- **Hierarchy:** No cycles, depth limits, parent-child consistency
- **Dependencies:** All referenced IDs must exist
- **Filenames:** Match state directory and naming convention

### Testing Requirements

- Unit test coverage: 80% lines/statements, 70% branches
- Integration tests for Git operations
- CLI command tests with JSON schema validation
- Concurrency tests for parallel operations

---

## Success Metrics

- **Adoption:** Time to first `validate` < 10 minutes
- **Usage:** 90%+ of state transitions via CLI (not manual edits)
- **Quality:** 80%+ of commits include `[Task:<id>]` prefix
- **Stability:** Validation error rate decreasing week-over-week

---

## Recent UI Enhancements

- Animated live indicator badge now conveys connection status with accessible tooltip and reduced-motion fallback.
- Delete confirmations use consistent button sizing to reduce destructive-action confusion.
- Task detail modal includes a `Complete task` control so agents can finish work without closing the view.

---

## Roadmap

### v0.1 (Current)

- Complete CLI with all core commands
- JSON output for automation
- Web-based Kanban board
- Git integration helpers
- Validation with auto-fix

### v0.2+ (Future)

- MCP server adapter
- External system sync (GitHub, Linear)
- Monorepo support
- Advanced analytics and reporting
- AI-assisted task enrichment

---

## Open Questions

- Finalize required body sections
- License selection (leaning MIT)
- Enforcement level for commit message format

---

## Implementation Notes

### Development Workflow

```bash
pnpm verify      # Complete check: build, lint, test, format
pnpm test       # Run test suite with coverage
pnpm dev        # Development mode with watch
```

Recent regressions in the verify gate were resolved by normalizing the board CSS utilities and CLI test helpers so Biome's lint and format steps stay green on a clean checkout.

### Key Implementation Decisions

- TypeScript with strict mode
- Vitest for testing with coverage thresholds
- Biome for linting/formatting (graceful fallback)
- Fastify for web server
- Commander.js for CLI framework
- Git operations via simple-git

---

## Additional Documentation

For detailed usage examples, workflows, and command reference, see:

- **[CLI Playbook](./cli-playbook.md)** - Complete reference with example workflows
- **[Architecture](./architecture.md)** - Technical design and implementation details
- **[Decisions](./decisions.md)** - Architectural decision records (ADRs)
- **[Changelog](./changelog.md)** - Version history and release notes
