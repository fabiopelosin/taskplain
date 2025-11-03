---
id: taskplain-stats-command
title: Taskplain stats command
kind: task
state: done
commit_message: "feat(cli): add stats command  [Task:taskplain-stats-command]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/cli.ts
  - src/services
  - src/services/statsService.ts
  - tests/cli
  - src/utils/relativeTime.ts
  - README.md
  - docs/tech.md
created_at: 2025-11-03T18:28:23.119Z
updated_at: 2025-11-03T18:48:24.900Z
completed_at: 2025-11-03T18:48:24.900Z
links: []
last_activity_at: 2025-11-03T18:48:24.900Z
execution:
  attempts:
    - started_at: 2025-11-03T18:33:01.033Z
      ended_at: 2025-11-03T18:48:25.276Z
      duration_seconds: 924
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Introduce a `taskplain stats` CLI command that summarizes execution telemetry so operators and agents can understand retry rates, wall clock time, and model usage without hand-rolled jq scripts. The command should help triage recent automation runs ("did we burn cycles on retries today?") and support exportable JSON for dashboards. Out of scope: automatic routing or schedule optimization—the focus is reporting.

## Acceptance Criteria

- [x] `taskplain stats` aggregates attempts and total execution seconds for tasks that recorded `execution` metadata.
- [x] `--limit <n>` option restricts analysis to the most recently updated `n` tasks (default includes all).
- [x] `--since <age>` accepts durations like `3h`, `2d`, `1w` (matching `cleanup --older-than` parsing) and limits analysis to tasks updated within that window.
- [x] Human output renders a per-task table with key stats (attempts, human-readable duration, latest status/executor) and uses consistent color accents for readability.
- [x] Summary section shows average/total work time and average attempts using humanized durations, and lists the unique tool/model combinations that ran.
- [x] `--task <id>` analyzes a specific task and all of its descendants recursively (ideal for stories and epics).
- [x] `--output json` emits a stable schema with per-task rows, overall aggregates, and executor combination metrics.
- [x] Gracefully handles tasks without execution data (skipped, no crashes) and includes them in an "insufficient telemetry" count.
- [x] Usage is documented in `docs/tech.md`, `README.md`, and the CLI help (`taskplain help stats`).

## Technical Approach

- **Changes**: Add a `stats` subcommand in `src/cli.ts` with supporting aggregation logic (via `statsService`). Extend task querying helpers to filter by recency/limit and to walk descendant trees when `--task` targets a parent. Add CLI snapshot/unit tests under `tests/cli/stats.test.ts` for both human and JSON modes.
- **Contracts**: Define JSON output containing overall totals/averages (`average_attempts`, `average_work_seconds`), executor combination summaries, and per-task breakdown objects (id, attempts, total_seconds, latest_status, latest executor, updated_at). Human output mirrors these fields with color-coded tables and humanized durations.
- **Integration**: Reuse execution metadata types from `src/domain/types.ts`. Share duration parsing utilities with `cleanup` so `--since` understands `3h`, `2d`, etc. Leverage existing table/ANSI helpers for colored status badges, summary highlights, and ensure a no-color fallback (`--no-color`).
- **Unknowns**: Decide whether to use `updated_at` or `last_activity_at` for recency filters; prototype with existing tasks. Validate descendant traversal ordering (story first, then children) and confirm performance on large repos; add streaming if needed.
- **Considerations**: Command remains read-only and should exit cleanly when no telemetry exists (report zeros plus a note). Keep color usage accessible (high contrast, disabled automatically when `process.stdout.isTTY === false`). Ensure deterministic output for tests.

## Post-Implementation Insights

### Changelog

- Added `taskplain stats` CLI command with limit, since, task, and JSON support plus humanized summary tables and executor/tool rollups.
- Introduced execution telemetry aggregation utilities (`computeExecutionStats`) and shared relative time parsing for stats and cleanup flows.
- Documented stats usage in `docs/tech.md`, `README.md`, and expanded CLI help with concrete examples.

### Decisions

- Use `last_activity_at` when available (fallback to `updated_at`) for recency filters so retries surface promptly.
- Represent unknown executor metadata as `null`/`(unknown)` to keep summary math intact while signaling missing data.
- Surface executor/tool combinations in summaries instead of per-model tables to highlight the actual routing mix without noise.

### Architecture

- Added `src/services/statsService.ts` to encapsulate telemetry aggregation + executor/tool metrics.
- Introduced `src/utils/relativeTime.ts` for reusable duration parsing reused by cleanup and stats commands.
