---
id: simplify-insights-template
title: Simplify insights template
kind: task
state: done
commit_message: "feat(insights): streamline insights stub  [Task:simplify-insights-template]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - docs/architecture.md
  - docs/cli-playbook.md
  - docs/product.md
  - src/docsources/task-template.md
  - src/domain/types.ts
  - src/services/fixService.ts
  - src/services/taskService.ts
  - tests/__snapshots__/canonical.test.ts.snap
  - tests/fixService.test.ts
  - tests/taskFileAdapter.serialize.story.md
  - tests/taskFileAdapter.test.ts
  - tests/taskService.newTask.story.md
  - tests/validationService.test.ts
created_at: 2025-11-03T09:04:52.800Z
updated_at: 2025-11-03T09:57:45.712Z
completed_at: 2025-11-03T09:57:45.712Z
links: []
last_activity_at: 2025-11-03T09:57:45.712Z
execution:
  attempts:
    - started_at: 2025-11-03T09:28:04.023Z
      ended_at: 2025-11-03T09:53:48.581Z
      duration_seconds: 1544
      status: failed
      error_reason: "src/services/taskService.ts(1288,69): error TS2345: Argument of
        type 'string' is not assignable to parameter of type '\"### Changelog\"
        | \"### Decisions\" | \"### Architecture\"'."
      executor:
        tool: agent-driver
        model: gpt-5-codex
---

## Overview

Replace the lengthy Post-Implementation Insights comment block with a minimal heading scaffold, moving detailed guidance into documentation so agents see only the sections they must fill.

## Acceptance Criteria

- [x] Newly generated task files render the Post-Implementation Insights section as plain headings without the long instructional comment.
- [x] Existing tasks can be migrated (via CLI command or script) without duplicating instructions in-file.
- [x] Documentation explains the expectations for each subsection and how to edit them using `taskplain update --field post_implementation_insights`.
- [x] Unit or integration tests updated to cover the new template output.

## Technical Approach

- Update the template generator used by `taskplain new` (and related scaffolding) to emit a short stub.
- Provide an idempotent migration helper or instructions so current tasks can adopt the streamlined format.
- Coordinate with the documentation task to ensure instructions live in the handbook rather than inlined comments.

## Post-Implementation Insights

### Changelog
- Changed the task template and generator to emit plain Post-Implementation Insights headings and updated docs/tests to match the streamlined flow.

### Decisions
- Centralized guidance in the CLI playbook and direct agents to `taskplain update --field post_implementation_insights` plus `taskplain validate --fix` for migrating legacy tasks.

### Architecture
- Added a scaffold constant and FixService migration to normalize existing files while keeping warning heuristics accurate.
