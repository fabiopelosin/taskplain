---
id: no-tasks-for-questions
title: No tasks for questions
kind: task
state: done
commit_message: "docs(handbook): remind agents not to open tasks for Q&A [Task:no-tasks-for-questions]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
created_at: 2025-11-01T17:55:12.710Z
updated_at: 2025-11-01T18:23:01.815Z
completed_at: 2025-11-01T18:23:01.815Z
links: []
last_activity_at: 2025-11-01T18:23:01.815Z
---

## Overview

Agents were spinning up Taskplain work items for question-only conversations because the shared handbook never told them to stay in chat. This task adds a concise instruction to the injected snippet so every consuming repository keeps AGENTS.md lightweight while reminding agents to answer informational requests without opening tasks.

## Acceptance Criteria

- [x] Handbook snippet directs agents to answer question-only requests without creating or updating tasks unless the user asks for follow-up work.
- [x] `AGENTS.md` reflects the lean injected snippet with no extra locally-authored guidance on question-only requests.
- [x] Repository validation succeeds after the update.

## Technical Approach

- **Changes**: Added a single bullet to `handbook-snippet.md` (source and dist) covering question-only handling, then reinjected `AGENTS.md`.
- **Unknowns**: None—the snippet is the canonical surface for this guidance.
- **Considerations**: Kept wording to one sentence so downstream AGENTS.md files stay compact.

## Post-Implementation Insights

### Changelog

- Updated the handbook snippet and reinjected `AGENTS.md` to deliver concise question-only guidance.

### Decisions

- Prioritised a single-sentence reminder over example lists to avoid snippet bloat.

### Architecture

- Not applicable.
