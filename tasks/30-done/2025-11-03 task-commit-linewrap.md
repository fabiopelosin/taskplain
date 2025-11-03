---
id: commit-linewrap
title: Prevent commit_message YAML wrapping
kind: task
state: done
commit_message: "fix(taskfile): keep commit_message scalars single-line  [Task:commit-linewrap]"
priority: normal
size: small
ambiguity: low
executor: standard
isolation: module
touches:
  - src/adapters/taskFile.ts
  - tests/taskFileAdapter.test.ts
created_at: 2025-11-03T20:35:23.646Z
updated_at: 2025-11-03T20:52:56.031Z
completed_at: 2025-11-03T20:52:56.031Z
links: []
last_activity_at: 2025-11-03T20:52:56.031Z
execution:
  attempts:
    - started_at: 2025-11-03T20:48:20.945Z
      ended_at: 2025-11-03T20:52:56.340Z
      duration_seconds: 275
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Taskplain currently writes long `commit_message` values with YAML's default wrapping, inserting literal newlines that break Conventional Commit subjects when read back. Keeping the field on one line ensures automation that reads `commit_message` via `yq` receives the intact subject and agents avoid hand-fixing front matter.

## Acceptance Criteria

- [x] Serializing a task with a >=80-character `commit_message` keeps the entire string on one YAML line.
- [x] `tests/taskFileAdapter.test.ts` includes coverage asserting the serializer output for long `commit_message` values.
- [x] Running `taskplain update <id> --meta commit_message="<long subject>"` preserves single-line formatting in the written task file.

## Technical Approach

- **Changes**: Update `src/adapters/taskFile.ts` to disable YAML scalar wrapping (for example, `yamlDoc.toString({ lineWidth: 0 })`) and ensure related normalization keeps the value untouched.
- **Contracts**: Confirm no schema adjustments are required; the field remains a plain string in task front matter.
- **Integration**: Cover CLI flows that write `commit_message` and add or update tests around `serializeTaskDoc` to assert the one-line behavior.
- **Unknowns**: Validate that the YAML configuration does not unintentionally alter other serialized fields; scope the option locally if needed.

## Post-Implementation Insights

### Changelog
- Kept commit_message serialization on a single YAML line for long subjects.

### Decisions
- Limited the YAML line-width override to the task file serializer to avoid global side effects.

### Technical Changes
- `src/adapters/taskFile.ts`: Disable YAML wrapping by passing `lineWidth: 0` to `toString`.
- `tests/taskFileAdapter.test.ts`: Add regression test asserting long commit_message output stays single-line.

<!-- Keep this summary to ≤10 lines with engineer-facing bullets that call out files/modules and integrations. Example:
- `src/services/validationService.ts`: Accepts Technical Changes heading when validating tasks.
- `docs/cli-playbook.md`: Documented the new Technical Changes subsection in Post-Implementation Insights guidance.
- `tasks/`: No migrations required; reused existing scaffold helpers.
-->
