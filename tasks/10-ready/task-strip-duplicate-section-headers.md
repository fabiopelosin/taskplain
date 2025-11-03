---
id: strip-duplicate-section-headers
title: Strip duplicate section headers
kind: task
state: ready
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - packages/taskplain/src/cli
  - packages/taskplain/src/sections
created_at: 2025-11-03T09:10:39.282Z
updated_at: 2025-11-03T09:10:55.787Z
completed_at: null
links: []
last_activity_at: 2025-11-03T09:10:55.787Z
---

## Overview

Ensure `taskplain update --field` gracefully handles inputs that accidentally repeat the section heading, preventing duplicated headers and downstream validation failures.

## Acceptance Criteria

- [ ] When a section update includes its own heading on the first line, the CLI strips it before writing the Markdown.
- [ ] The tool emits a warning (or helpful notice) informing the user that the heading was removed.
- [ ] Existing behaviour is unchanged when the snippet omits the heading.
- [ ] Unit tests cover both the stripping and non-stripping paths.

## Technical Approach

- Update the CLI section writer to detect leading Markdown headings matching the target section name and remove them.
- Add warning/log output to guide agents toward best practices.
- Extend existing tests for `taskplain update` to exercise the new sanitization path.

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
