---
id: metadata-ergonomics
title: Metadata Ergonomics
kind: story
children:
  - implement-metadata-cli-helpers
  - auto-check-acs-on-complete
  - document-metadata-ergonomics
  - warn-on-checked-acs
  - simplify-insights-template
  - handbook-insights-guidance
  - strip-duplicate-section-headers
state: ready
commit_message: "docs(story): finalize metadata ergonomics summary  [Task:metadata-ergonomics]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
created_at: 2025-11-03T07:40:11.727Z
updated_at: 2025-11-03T09:10:39.282Z
completed_at: null
links: []
last_activity_at: 2025-11-03T09:10:39.282Z
execution:
  attempts:
    - started_at: 2025-11-03T08:51:56.645Z
      ended_at: 2025-11-03T08:54:55.283Z
      duration_seconds: 178
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
---

## Overview

Coordinate a light-touch ergonomics initiative so agents can inspect and edit Taskplain metadata, close out acceptance criteria, and capture insights with minimal ceremony. Following the first wave of improvements, the story now tracks validation warnings, streamlined templates, and refreshed guidance discovered during implementation.

## Acceptance Criteria

- [ ] Subtasks for metadata helpers, AC auto-check, validation warning, template trim, header stripping, and handbook guidance are in ready state with clear deliverables.
- [ ] Dependencies between CLI/template changes and documentation are captured so sequencing is obvious.
- [ ] Story records any blockers uncovered while landing these subtasks.

## Technical Approach

- Sequence remaining work: validation warning → template trim → handbook update.
- Monitor impacts on existing CLI flows and adjust scope if new ergonomics gaps appear.
- Capture any additional ideas as separate tasks instead of expanding this story.

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
