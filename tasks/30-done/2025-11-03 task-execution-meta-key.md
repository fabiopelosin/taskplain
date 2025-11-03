---
id: execution-meta-key
title: Execution meta key
kind: task
state: done
commit_message: "fix(normalization): accept execution telemetry  [Task:execution-meta-key]"
priority: normal
size: small
ambiguity: low
executor: standard
isolation: module
touches:
  - src/domain/normalization.ts
  - tests/taskFileAdapter.test.ts
created_at: 2025-11-03T06:19:14.545Z
updated_at: 2025-11-03T07:57:23.702Z
completed_at: 2025-11-03T07:57:23.702Z
links: []
last_activity_at: 2025-11-03T07:57:23.702Z
execution:
  attempts:
    - started_at: 2025-11-03T07:52:55.803Z
      ended_at: 2025-11-03T07:57:24.009Z
      duration_seconds: 268
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Taskplain currently raises `unknown_meta_key` warnings whenever a task frontmatter includes the new `execution` telemetry block. The normalization logic in `src/domain/normalization.ts` never learned about this field, so downstream consumers (including `taskplain inject`) log noisy warnings even though the metadata is valid per the schema and documentation. We need to align normalization with the schema so repositories that store execution telemetry do not see spurious warnings.

## Acceptance Criteria

- [x] Update normalization to recognize `execution` metadata with no warnings when the field is present
- [x] Add regression tests covering tasks with and without `execution` data to ensure no warnings are emitted
- [x] Confirm `taskplain validate` and `taskplain inject` run without `unknown_meta_key` warnings on sample tasks that include execution telemetry

## Technical Approach

- Update `KNOWN_KEYS` (and any related allowlists) in `src/domain/normalization.ts` to include `execution`
- Extend `tests/taskFileAdapter.test.ts` (or add a new spec) to cover reading metadata containing `execution` without producing warnings
- Re-run `pnpm test` / `pnpm verify` locally before shipping since this change intersects validation logic

## Post-Implementation Insights

### Changelog

- Fixed normalization to treat `execution` telemetry as a known metadata key so execution attempts no longer trigger warnings.

### Decisions

- No additional decisions were required; the change aligns normalization with the existing schema.

### Architecture

- No architectural adjustments were necessary beyond extending the metadata allowlist.
