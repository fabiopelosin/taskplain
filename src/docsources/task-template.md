## Overview

<!-- What is being built and why. Name the user/system affected and the success signal. Link relevant docs. State what is out of scope if needed. Explain how this fits into parent work. -->

## Acceptance Criteria

<!-- Objective pass/fail checks only. Use checkbox list syntax (`- [ ] `). When all are checked, the task is complete. Be specific. Examples: API returns 201, UI shows message, migrations run, acceptance criteria complete before starting, lint/build/tests pass. -->

## Technical Approach

<!-- Document the approach known at task creation:
- **Changes**: List modules, files, classes, functions to modify (with paths)
- **Contracts**: Define new/changed types, schemas, example payloads
- **Integration**: Note call sites, events, APIs, feature flags, migrations, backward compatibility
- **Unknowns**: List what to investigate and how to resolve (link spikes/notes)
- **Considerations**: Capture performance, security, privacy, or cost concerns if relevant
-->

<!--
## Post-Implementation Insights

Uncomment this section when completing the task. Fill before running `taskplain complete <id>`.

### Changelog

Required. Summarize what shipped using Keep a Changelog verbs (Added, Changed, Fixed, etc.):
- Added POST /api/users endpoint with JWT validation
- Changed login flow to use refresh tokens
- Fixed memory leak in WebSocket connections

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
