---
id: story-golden-fixture
title: Golden Fixture Story
kind: story
state: idea
priority: high
size: medium
ambiguity: low
executor: standard
isolation: module
depends_on:
  - task-upstream
blocks:
  - task-followup
assignees:
  - agent-alpha
labels:
  - quality
  - coverage
created_at: 2024-05-06T07:08:09.123Z
updated_at: 2024-05-06T07:08:09.123Z
links:
  - type: github_issue
    repo: taskplain/taskplain
    number: 42
last_activity_at: 2024-05-06T07:08:09.123Z
---

## Overview
- Provide deterministic markdown output

## Acceptance Criteria
- [ ] Preserve YAML ordering

## Technical Approach
- Exercise adapter helpers

<!--
## Post-Implementation Insights

> Uncomment this section when moving the task to `done` so completions include the knowledge we extracted.
> Capture discoveries, decisions, and architecture updates with concrete bullet points.
> - **Changelog** (required): Summarize what shipped using Keep a Changelog verbs.
> - **Decisions** (optional): Note key choices, rejected alternatives, and rationale.
> - **Architecture** (optional): Document notable patterns, refactors, or new structures.

### Changelog
- Coverage-focused fixtures
- Track via Vitest snapshots

### Decisions
- 

### Architecture
- 
-->
