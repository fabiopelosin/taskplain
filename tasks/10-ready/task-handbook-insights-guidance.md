---
id: handbook-insights-guidance
title: Handbook insights guidance
kind: task
state: ready
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - docs/agents-handbook.md
depends_on:
  - simplify-insights-template
created_at: 2025-11-03T09:06:54.034Z
updated_at: 2025-11-03T09:07:24.800Z
completed_at: null
links: []
last_activity_at: 2025-11-03T09:07:24.800Z
---
## Overview

Update the agents handbook snippet to highlight the streamlined Post-Implementation Insights process, including an explicit `taskplain update --field post_implementation_insights` example agents can copy before completing tasks.

## Acceptance Criteria

- [ ] Handbook template calls out that agents must populate Post-Implementation Insights before completion.
- [ ] Handbook provides a minimal Markdown snippet and demonstrates using `taskplain update <id> --field post_implementation_insights @/tmp/insights.md` without repeating the section heading.
- [ ] Documentation references the simplified on-disk template so instructions stay in sync.
- [ ] Changes scoped to the handbook snippet; other docs remain untouched unless updates are required for accuracy.

## Technical Approach

- Edit `docs/agents-handbook.md` (or the injected snippet source) to include the new guidance about omitting headers when using `taskplain update --field`.
- Coordinate with the template trim task to ensure examples match the new default layout.
- Run `taskplain validate` after edits to confirm schema compliance.

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
