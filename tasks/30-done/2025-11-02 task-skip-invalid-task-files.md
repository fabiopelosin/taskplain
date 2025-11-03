---
id: skip-invalid-task-files
title: Skip invalid task files
kind: task
state: done
commit_message: "feat(task-service): handle invalid task files [Task:skip-invalid-task-files]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - cli
  - web
  - services
created_at: 2025-11-02T20:30:00.000Z
updated_at: 2025-11-03T05:58:46.761Z
completed_at: 2025-11-02T20:45:00.000Z
links: []
last_activity_at: 2025-11-03T05:58:46.761Z
---

## Overview

Implemented graceful handling for unreadable task files so CLI and web flows keep running while surfacing structured warnings instead of aborting.

## Acceptance Criteria

- [x] CLI commands skip invalid task files and emit parse_failed warnings
- [x] Web UI loads while showing warning details for unreadable files
- [x] Regression tests cover schema and YAML failures without breaking runs

## Technical Approach

- Captured Zod and YAML parsing failures in TaskService and recorded them as structured warnings
- Surfaced accumulated warnings through CLI list/tree commands and the web server notification channel
- Added unit coverage that forces invalid metadata/frontmatter to ensure the CLI and services tolerate bad files

## Post-Implementation Insights

### Changelog

- CLI list/tree and the web dashboard now warn instead of crashing when task files fail to parse
- Centralized warning emission so downstream tooling can surface `parse_failed` and `read_failed` issues

### Decisions

- Treat malformed task files as non-blocking to keep automation workflows running
- Keep warnings in-process rather than writing separate artifacts to maintain deterministic outputs

### Architecture

- Added a unified error reporting path in `TaskService` to reuse across CLI and web services
- Extended warning transports so both human and JSON outputs include the new diagnostics
