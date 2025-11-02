---
id: task-modal-update
title: Task modal update
kind: task
state: done
commit_message: "feat(web): sync modal with remote updates  [Task:task-modal-update]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
created_at: 2025-11-01T18:39:29.093Z
updated_at: 2025-11-02T01:18:23.998Z
completed_at: 2025-11-02T01:18:23.998Z
links: []
last_activity_at: 2025-11-02T01:18:23.998Z
---

## Overview

Purpose

Ensure the task modal reflects live task changes while it is open. When the user is not editing, the modal should update automatically from the latest board snapshot. When the user is editing, changes from the board should not overwrite in-progress edits; instead, show a non-intrusive banner to review/apply remote updates.

User Story
As a user viewing a task in the modal, I want to see up-to-date details without closing the modal or losing in-progress edits so I can trust what I’m looking at and finish my work faster.

Goals
- Auto-refresh modal fields (title, priority, size, ambiguity, executor, blocked, body preview, acceptance counts, parent/child summary) when not editing.
- Prevent data loss while editing; surface a clear notification in thsi case.

Non-Goals
- No collaborative merge editor; v1 provides refresh/replace behavior, not field-by-field diff/merge.
- No review of changes in editing.

## Acceptance Criteria

- [x] When the modal is open and not editing, remote changes are reflected within 1s of a new snapshot (WebSocket) or 5s with polling fallback.
- [x] When the modal is open and editing, a persistent notification informs the user the task changed on disk.


## Technical Approach

Plan

- Subscribe modal to board snapshots and detect changes for the active `modalTaskId`.
- Maintain a `modalDirty` flag when inputs change; if dirty, do not auto-apply remote values.
- When remote updates arrive while dirty, render an inline banner with actions (Review, Discard & refresh).
- Implement a pure function to diff task details -> {changedFields, messages} to drive the banner preview.
- On apply/refresh, update UI state, clear dirty flag, and re-render from the latest cache.
- Handle deletion: check if task id is absent in snapshot; close modal + toast.
- Add a11y: banner announced via aria-live; buttons have labels and focus management.
- Add lightweight tests for the diff function and manual test notes for websocket vs. polling.

## Post-Implementation Insights

### Changelog

- Added live modal auto-refresh that applies WebSocket snapshots immediately and falls back to 5-second polling when the socket is unavailable.
- Added an inline editing banner with review and discard actions to protect in-progress edits from remote changes.
- Added a reusable task-detail diff helper and accessibility-focused banner styling updates.

### Decisions

- Chose a banner-based summary of changed fields over a merge UI to keep the workflow simple while still surfacing remote updates.
- Shared the diff helper between the browser bundle and Vitest to keep change detection consistent without adding a bundler.

### Architecture

- Added `taskDiff.js` to the static web assets and wired it into `board.js` via a global namespace for compatibility with the existing copy pipeline.
- Extended `board.js` with modal-sync state management, including WebSocket fallback polling and safe application of remote updates.
- Introduced modal update banner components and associated CSS to keep the notification accessible (aria-live, focusable controls).
