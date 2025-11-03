---
id: simplify-insights-template
title: Simplify insights template
kind: task
state: ready
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - packages/taskplain/src/templates
  - packages/taskplain/src/cli
created_at: 2025-11-03T09:04:52.800Z
updated_at: 2025-11-03T09:05:55.605Z
completed_at: null
links: []
last_activity_at: 2025-11-03T09:05:55.605Z
---

## Overview

Replace the lengthy Post-Implementation Insights comment block with a minimal heading scaffold, moving detailed guidance into documentation so agents see only the sections they must fill.

## Acceptance Criteria

- [ ] Newly generated task files render the Post-Implementation Insights section as plain headings without the long instructional comment.
- [ ] Existing tasks can be migrated (via CLI command or script) without duplicating instructions in-file.
- [ ] Documentation explains the expectations for each subsection and how to edit them using `taskplain update --field post_implementation_insights`.
- [ ] Unit or integration tests updated to cover the new template output.

## Technical Approach

- Update the template generator used by `taskplain new` (and related scaffolding) to emit a short stub.
- Provide an idempotent migration helper or instructions so current tasks can adopt the streamlined format.
- Coordinate with the documentation task to ensure instructions live in the handbook rather than inlined comments.

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
