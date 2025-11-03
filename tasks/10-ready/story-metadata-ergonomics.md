---
id: metadata-ergonomics
title: Metadata Ergonomics
kind: story
children:
  - implement-metadata-cli-helpers
  - auto-check-acs-on-complete
  - document-metadata-ergonomics
state: ready
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
created_at: 2025-11-03T07:40:11.727Z
updated_at: 2025-11-03T08:11:26.794Z
completed_at: null
links: []
last_activity_at: 2025-11-03T08:11:26.794Z
---

## Overview

Coordinate a light-touch ergonomics initiative so agents can inspect and edit Taskplain metadata, and close out acceptance criteria, with minimal ceremony. This story gathers the CLI enhancements and handbook update needed to land the improvements together.

## Acceptance Criteria

- [ ] JSON metadata helper and AC auto-check subtasks are defined, sized, and in ready state.
- [ ] Documentation subtask references the new commands and sits in ready state.
- [ ] Story captures integration risks and handoffs so successors can schedule implementation confidently.

## Technical Approach

- Track dependencies between CLI work and documentation so the handbook update lands after the commands ship.
- Revisit story size/priority once subtasks provide concrete estimates.
- Capture any follow-up work (e.g., additional flags) as new idea tasks rather than expanding this story.

<!--
## Post-Implementation Insights

Uncomment this section when completing the task. Fill before running `taskplain complete <id>`.

### Changelog

Required. Write a single user-facing entry explaining what changed and why it matters. Use Keep a Changelog verbs (Added, Changed, Fixed, etc.). Focus on features and user impact, not file paths or documentation updates.

Good example:
- Added execution telemetry schema for tracking agent performance and runtime metrics. Orchestration systems can now record execution attempts in task frontmatter, enabling data-driven analysis and optimized routing strategies.

Avoid:
- Added types to src/domain/types.ts
- Updated README.md and docs/product.md
- Changed field ordering in taskFile.ts

### Decisions

Optional. Document key choices, rejected alternatives, and rationale:
- Chose PostgreSQL over MongoDB for relational integrity requirements
- Rejected client-side caching due to stale data concerns
- Used feature flag for gradual rollout (flag: `new_auth_flow`)

### Architecture

Optional. Document notable patterns, refactors, or new structures:
- Introduced AuthService abstraction layer (src/services/auth.ts)
- Refactored middleware chain to use dependency injection
- Added new TokenRefreshQueue for background token rotation
-->
