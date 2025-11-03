---
id: handbook-insights-guidance
title: Handbook insights guidance
kind: task
state: done
commit_message: "docs(handbook): clarify insights workflow  [Task:handbook-insights-guidance]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/docsources/handbook-snippet.md
depends_on:
  - simplify-insights-template
created_at: 2025-11-03T09:06:54.034Z
updated_at: 2025-11-03T10:00:16.110Z
completed_at: 2025-11-03T10:00:16.110Z
links: []
last_activity_at: 2025-11-03T10:00:16.110Z
execution:
  attempts:
    - started_at: 2025-11-03T09:57:46.284Z
      ended_at: 2025-11-03T10:00:16.439Z
      duration_seconds: 150
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Update the agents handbook snippet to highlight the streamlined Post-Implementation Insights process, including an explicit `taskplain update --field post_implementation_insights` example agents can copy before completing tasks.

## Acceptance Criteria

- [x] Handbook template calls out that agents must populate Post-Implementation Insights before completion.
- [x] Handbook provides a minimal Markdown snippet and demonstrates using `taskplain update <id> --field post_implementation_insights @/tmp/insights.md` without repeating the section heading.
- [x] Documentation references the simplified on-disk template so instructions stay in sync.
- [x] Changes scoped to the handbook snippet; other docs remain untouched unless updates are required for accuracy.

## Technical Approach

- Edit `docs/agents-handbook.md` (or the injected snippet source) to include the new guidance about omitting headers when using `taskplain update --field`.
- Coordinate with the template trim task to ensure examples match the new default layout.
- Run `taskplain validate` after edits to confirm schema compliance.

## Post-Implementation Insights

### Changelog

- Added explicit Post-Implementation Insights workflow guidance and CLI example to the agent handbook snippet.

### Decisions

- Pointed the handbook at the canonical task template path to keep instructions synchronized.

### Architecture

- No structural changes required.
