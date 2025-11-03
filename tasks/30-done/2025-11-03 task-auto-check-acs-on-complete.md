---
id: auto-check-acs-on-complete
title: Auto-check ACs on complete
kind: task
state: done
commit_message: "feat(complete): auto-check acceptance criteria  [Task:auto-check-acs-on-complete]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/cli.ts
  - src/services/taskService.ts
  - docs/cli-playbook.md
  - docs/product.md
  - docs/changelog.md
  - README.md
  - tests/taskService.test.ts
  - tests/completeCli.test.ts
  - tests/__snapshots__/canonical.test.ts.snap
created_at: 2025-11-03T07:40:22.300Z
updated_at: 2025-11-03T08:45:59.673Z
completed_at: 2025-11-03T08:45:59.673Z
links: []
last_activity_at: 2025-11-03T08:45:59.673Z
execution:
  attempts:
    - started_at: 2025-11-03T08:30:32.795Z
      ended_at: 2025-11-03T08:43:22.311Z
      duration_seconds: 769
      status: failed
      error_reason: Agent output did not include the __DONE__ finish token.
      executor:
        tool: agent-driver
        model: gpt-5-codex
    - started_at: 2025-11-03T08:43:22.313Z
      ended_at: 2025-11-03T08:45:59.969Z
      duration_seconds: 157
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Add an opt-in `--check-acs` flag to `taskplain complete` that automatically marks any remaining acceptance criteria as done so agents can finalize tasks without manual markdown edits.

## Acceptance Criteria

- [x] Running `taskplain complete <id> --check-acs` updates all unchecked acceptance criteria to checked before completion.
- [x] Existing behaviour without the flag is unchanged; regression tests cover both paths.
- [x] CLI help/usage text explains the flag and its caveats (e.g., only affects markdown checkboxes).
- [x] Unit/integration tests demonstrate the flag working on tasks with mixed checked/unchecked criteria.

## Technical Approach

- Extend the completion flow to reuse the acceptance-criteria writer before invoking existing completion logic.
- Cover the new flag with Vitest integration tests that simulate tasks in in-progress and done states.
- Update CLI help output and ensure `taskplain validate` still passes after markdown mutations.

## Post-Implementation Insights

### Changelog
- Added `--check-acs` flag to `taskplain complete`, letting agents finish tasks while the CLI auto-checks remaining acceptance criteria checkboxes.

### Decisions
- Reused the existing section writer inside `TaskService.complete` so acceptance criteria updates stay consistent with other Markdown mutations.

### Architecture
- Added focused service and CLI integration tests covering completion with and without the new flag to protect the workflow contract.
