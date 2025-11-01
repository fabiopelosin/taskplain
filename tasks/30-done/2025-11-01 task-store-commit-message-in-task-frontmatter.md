---
id: store-commit-message-in-task-frontmatter
title: Store commit message in task frontmatter
kind: task
state: done
commit_message: "feat(tasks): require commit metadata for done work [Task:store-commit-message-in-task-frontmatter]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/**
  - docs/**
  - dist/**
  - tasks/**
created_at: 2025-11-01T21:55:33.253Z
updated_at: 2025-11-01T22:19:29.431Z
completed_at: 2025-11-01T22:19:29.431Z
links: []
last_activity_at: 2025-11-01T22:19:29.431Z
---

## Overview

Add canonical support for recording the commit message that will close a task so automation can commit using Taskplain data instead of duplicating strings. Agents and bots should be able to read the message directly from frontmatter, and Taskplain needs to enforce the field for completed work.

## Acceptance Criteria

- [x] Task metadata schema accepts a `commit_message` string field, exposes it via `taskplain canonical`, and fails validation when a done task omits it.
- [x] Existing repository tasks are updated and `taskplain validate` succeeds after the schema change.
- [x] Handbook snippet (and injected `AGENTS.md`) directs agents to record the commit message before completing a task, and docs describe how to extract it with `yq -r '.commit_message'`.
- [x] Tests (or equivalent automated checks) cover the new metadata field.

## Technical Approach

- **Changes**: Extend `TaskMeta` typing, normalization, and JSON schema in `src/domain` plus services consuming metadata; add tests covering validation for done tasks.
- **Contracts**: Introduce optional `commit_message` field (non-empty string) required when `state: done`, exposed through canonical JSON, and persisted during pickup/update flows.
- **Integration**: Update documentation sources (`docs/tech.md`, `docs/product.md`, handbook snippet) and reinject `AGENTS.md` to mention the new field and extraction flow.
- **Considerations**: Ensure backward compatibility for in-progress tasks by making the field optional until completion; keep automation instructions shell-friendly.

## Post-Implementation Insights

### Changelog

- Added a `commit_message` field to task metadata, normalization, and canonical schemas so validation fails when done work lacks a commit subject.
- Updated CLI/web surfaces, docs, and AGENTS guidance to capture commit messages and documented `yq -r '.commit_message'` extraction for automations.
- Seeded existing done tasks with their shipped commit subjects and extended the test suite/CLI fixtures to require the new field.

### Decisions

- Enforced `commit_message` only when transitioning to `done`, while keeping it optional earlier so agents can draft work incrementally.
- Added `--commit-message` to `taskplain new` rather than auto-generating commits, keeping humans in control of final messaging.

### Architecture

- Extended `TaskMeta`/JSON schema definitions with `commit_message` and propagated parsing through TaskService, TaskFile adapters, and canonical exports.
- Updated web server and CLI flows to validate commit messages before completion, ensuring downstream automation can rely on the frontmatter source of truth.
