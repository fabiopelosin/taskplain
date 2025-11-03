---
id: commit-linewrap
title: Prevent commit_message YAML wrapping
kind: task
state: ready
priority: normal
size: small
ambiguity: low
executor: standard
isolation: module
touches:
  - src/adapters/taskFile.ts
  - src/domain/normalization.ts
  - tests/taskFileAdapter.test.ts
created_at: 2025-11-03T20:35:23.646Z
updated_at: 2025-11-03T20:36:19.226Z
completed_at: null
links: []
last_activity_at: 2025-11-03T20:36:19.226Z
---

## Overview

Taskplain currently writes long `commit_message` values with YAML's default wrapping, inserting literal newlines that break Conventional Commit subjects when read back. Keeping the field on one line ensures automation that reads `commit_message` via `yq` receives the intact subject and agents avoid hand-fixing front matter.

## Acceptance Criteria

- [ ] Serializing a task with a >=80-character `commit_message` keeps the entire string on one YAML line.
- [ ] `tests/taskFileAdapter.test.ts` includes coverage asserting the serializer output for long `commit_message` values.
- [ ] Running `taskplain update <id> --meta commit_message="<long subject>"` preserves single-line formatting in the written task file.

## Technical Approach

- **Changes**: Update `src/adapters/taskFile.ts` to disable YAML scalar wrapping (for example, `yamlDoc.toString({ lineWidth: 0 })`) and ensure related normalization keeps the value untouched.
- **Contracts**: Confirm no schema adjustments are required; the field remains a plain string in task front matter.
- **Integration**: Cover CLI flows that write `commit_message` and add or update tests around `serializeTaskDoc` to assert the one-line behavior.
- **Unknowns**: Validate that the YAML configuration does not unintentionally alter other serialized fields; scope the option locally if needed.

## Post-Implementation Insights

### Changelog

### Decisions

### Technical Changes

<!-- Keep this summary to ≤10 lines with engineer-facing bullets that call out files/modules and integrations. Example:
- `src/services/validationService.ts`: Accepts Technical Changes heading when validating tasks.
- `docs/cli-playbook.md`: Documented the new Technical Changes subsection in Post-Implementation Insights guidance.
- `tasks/`: No migrations required; reused existing scaffold helpers.
-->
