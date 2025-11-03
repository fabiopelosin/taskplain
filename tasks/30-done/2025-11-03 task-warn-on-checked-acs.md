---
id: warn-on-checked-acs
title: Warn on checked ACs
kind: task
state: done
commit_message: "feat(validation): warn on in-progress acceptance
  criteria  [Task:warn-on-checked-acs]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - packages/taskplain/src/validate
  - packages/taskplain/src/cli
created_at: 2025-11-03T09:04:12.900Z
updated_at: 2025-11-03T09:28:03.445Z
completed_at: 2025-11-03T09:28:03.445Z
links: []
last_activity_at: 2025-11-03T09:28:03.445Z
---

## Overview

Adjust validation so tasks in progress with fully checked acceptance criteria trigger a warning instead of a hard failure, preventing agents from getting blocked before orchestration completes the task.

## Acceptance Criteria

- [x] In-progress tasks with all acceptance criteria checked no longer cause `taskplain validate` to exit non-zero; a warning is emitted instead.
- [x] Validation still fails for other schema violations (e.g., missing sections, unchecked ACs in done tasks).
- [x] New behaviour covered by unit tests for the validator module.
- [x] CLI output clearly communicates why the warning appears and how to resolve it (complete the task or uncheck criteria).

## Technical Approach

- Update the validator rule that enforces checked acceptance criteria to degrade severity when `state != "done"`.
- Add targeted tests capturing the warning path and ensuring done-state validation remains strict.
- Review CLI/CI implications to confirm downstream tooling treats the warning appropriately.

## Post-Implementation Insights

### Changelog

- Changed validation to emit a warning when in-progress tasks have every acceptance criteria checkbox checked, so agents can finish the task or reopen work without blocking validation.

### Decisions

- Downgraded the acceptance-criteria rule severity for non-done tasks to avoid introducing a separate warning code or new validation configuration.

### Architecture

- No architectural changes; the validator now feeds warnings through the existing reporter pipeline.
