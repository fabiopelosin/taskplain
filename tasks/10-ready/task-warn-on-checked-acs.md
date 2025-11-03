---
id: warn-on-checked-acs
title: Warn on checked ACs
kind: task
state: ready
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - packages/taskplain/src/validate
  - packages/taskplain/src/cli
created_at: 2025-11-03T09:04:12.900Z
updated_at: 2025-11-03T09:05:48.533Z
completed_at: null
links: []
last_activity_at: 2025-11-03T09:05:48.533Z
---

## Overview

Adjust validation so tasks in progress with fully checked acceptance criteria trigger a warning instead of a hard failure, preventing agents from getting blocked before orchestration completes the task.

## Acceptance Criteria

- [ ] In-progress tasks with all acceptance criteria checked no longer cause `taskplain validate` to exit non-zero; a warning is emitted instead.
- [ ] Validation still fails for other schema violations (e.g., missing sections, unchecked ACs in done tasks).
- [ ] New behaviour covered by unit tests for the validator module.
- [ ] CLI output clearly communicates why the warning appears and how to resolve it (complete the task or uncheck criteria).

## Technical Approach

- Update the validator rule that enforces checked acceptance criteria to degrade severity when `state != "done"`.
- Add targeted tests capturing the warning path and ensuring done-state validation remains strict.
- Review CLI/CI implications to confirm downstream tooling treats the warning appropriately.

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
