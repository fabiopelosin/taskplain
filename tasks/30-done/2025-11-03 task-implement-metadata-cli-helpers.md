---
id: implement-metadata-cli-helpers
title: Implement metadata CLI helpers
kind: task
state: done
commit_message: "feat(cli): add metadata get/set helpers  [Task:implement-metadata-cli-helpers]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/cli.ts
  - src/domain/canonical.ts
  - tests/metadataCli.test.ts
  - tests/__snapshots__/canonical.test.ts.snap
  - docs/cli-playbook.md
  - docs/architecture.md
  - docs/changelog.md
  - README.md
created_at: 2025-11-03T07:40:19.193Z
updated_at: 2025-11-03T08:30:32.274Z
completed_at: 2025-11-03T08:30:32.274Z
links: []
last_activity_at: 2025-11-03T08:30:32.274Z
execution:
  attempts:
    - started_at: 2025-11-03T08:11:26.882Z
      ended_at: 2025-11-03T08:30:32.561Z
      duration_seconds: 1145
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Build dedicated `taskplain metadata get`/`set` subcommands so agents can inspect and edit task metadata with a single JSON round-trip instead of juggling multiple `taskplain update` calls.

## Acceptance Criteria

- [x] `taskplain metadata get <id> --output json` prints all tracked metadata keys (including empties) in stable order.
- [x] `taskplain metadata set <id>` reads JSON from stdin, updates only provided keys, and validates unknown keys with a clear error.
- [x] Unit tests cover get/set happy paths, partial updates, and invalid-key handling.
- [x] CLI help documents both verbs and includes a short example.

## Technical Approach

- Reuse existing metadata read/write helpers to avoid duplicate schema logic.
- Add a small parser wrapper for stdin JSON that merges into the metadata map.
- Extend CLI command registration and help text, then add Vitest coverage alongside existing Taskplain CLI tests.

## Post-Implementation Insights

### Changelog

- Added dedicated `taskplain metadata get`/`set` commands that expose canonical metadata snapshots and apply JSON patches (with `null` removing optional fields), plus documentation and Vitest coverage so agents can manage metadata without chaining multiple CLI calls.

### Decisions

- Null JSON values map to unsets using the existing `taskplain update` allowances to keep CLI semantics identical across commands.

### Architecture

- Added a `buildMetadataSnapshot` helper in the CLI that reuses `META_KEY_ORDER` to emit stable, default-filled metadata for both human and JSON outputs.
