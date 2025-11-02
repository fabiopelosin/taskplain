---
id: execution-telemetry
title: Execution telemetry
kind: story
state: done
commit_message: "feat(schema): add execution telemetry metadata  [Task:execution-telemetry]"
priority: high
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/domain/types.ts
  - src/adapters/taskFile.ts
  - src/resources/web/board.js
  - tests/**
created_at: 2025-11-02T18:25:21.517Z
updated_at: 2025-11-02T18:44:25.767Z
completed_at: 2025-11-02T18:44:25.767Z
links: []
last_activity_at: 2025-11-02T18:44:25.767Z
---

## Overview

### Problem

Orchestration systems dispatch tasks to agents without learning from historical performance. The same expensive, capable model handles trivial tasks while faster models sit idle. Success rates, attempt patterns, and execution times remain invisible, forcing operators to guess at optimal routing strategies.

### Proposed Solution

Add optional `execution` metadata to task frontmatter that records runtime telemetry for each task attempt. This creates a performance dataset enabling consumers to analyze which models work best for different task types, measure actual versus estimated effort, and optimize agent routing based on learned patterns.

### Success Signals

- Orchestration systems can record execution attempts (duration, model, status) in task YAML
- Consumers can query completed tasks to analyze performance patterns: model × ambiguity → success rate
- Schema validation enforces structure while keeping execution metadata optional
- Documentation shows clear separation: Taskplain stores data, consumers analyze and optimize

### Scope

- Add TypeScript types and Zod schemas for execution metadata
- Update task file serialization to include `execution` field in key order
- Provide comprehensive test coverage for schema validation
- Update relevant documentation to explain the feature

### Out of Scope

- Building analysis tooling or dashboards (consumer responsibility)
- Automatic task routing or estimation (consumer responsibility)
- CLI commands for recording attempts (orchestration systems write YAML directly or use `taskplain update`)

## Acceptance Criteria

- [x] TypeScript types defined for `ExecutionAttempt`, `ExecutionExecutor`, `ExecutionReviewer`, `TaskExecution` in [src/domain/types.ts](src/domain/types.ts)
- [x] Zod schemas validate execution metadata structure
- [x] `execution` field added to `META_KEY_ORDER` in [src/adapters/taskFile.ts](src/adapters/taskFile.ts) after `last_activity_at`
- [x] Tests verify schema validation: valid execution data passes, invalid data fails with clear errors
- [x] Tests verify optional execution metadata: tasks without `execution` field validate successfully
- [x] Tests verify nested executor structure: `executor.tool` and `executor.model` are parsed correctly
- [x] Tests verify failed attempts can include optional `error_reason` field
- [x] All existing tests continue to pass
- [x] `pnpm verify` gate passes (build, typecheck, lint, test, format)

## Technical Approach

### Changes

**Types and Schemas** ([src/domain/types.ts](src/domain/types.ts)):
- Add enums: `ExecutionStatus`
- Add interfaces: `ExecutionExecutor`, `ExecutionReviewer`, `ExecutionAttempt`, `TaskExecution`
- Add Zod schemas for validation
- Update `taskMetaSchema` to include optional `execution: taskExecutionSchema`
- Export new types via `z.infer<typeof ...>`

**Field Ordering** ([src/adapters/taskFile.ts](src/adapters/taskFile.ts)):
- Add `"execution"` to `META_KEY_ORDER` array after `"last_activity_at"`
- Ensures consistent YAML serialization order

**Tests** (create new test file `tests/executionTelemetry.test.ts`):
- Valid execution data: single attempt, multiple attempts, with/without reviewer
- Invalid data: missing required fields, wrong types, invalid enums
- Optional field: tasks without `execution` validate successfully
- Failed attempts can include optional `error_reason` field
- Nested executor validation: tool/model structure is correct

### Contracts

**Execution Metadata Schema:**

```yaml
execution:
  attempts:
    - started_at: "2025-11-02T15:03:00.000Z"  # ISO 8601 UTC
      ended_at: "2025-11-02T15:05:00.000Z"    # ISO 8601 UTC
      duration_seconds: 120                   # Integer, >= 0
      status: failed                          # "completed" | "failed" | "abandoned"
      error_reason: "TypeError: Cannot read property 'foo' of undefined"  # String, optional
      executor:
        tool: claude-code                     # String, required
        model: claude-sonnet-4-20250514       # String, optional
        planner:                              # Object, optional (future multi-step)
          tool: string
          model: string
      notes: "First attempt failed"           # String, optional
    - started_at: "2025-11-02T15:06:25.000Z"
      ended_at: "2025-11-02T15:08:00.000Z"
      duration_seconds: 95
      status: failed
      error_reason: "AssertionError: Expected 200, got 404"
      executor:
        tool: claude-code
        model: claude-sonnet-4-20250514
    - started_at: "2025-11-02T15:10:00.000Z"
      ended_at: "2025-11-02T15:12:45.000Z"
      duration_seconds: 165
      status: completed
      executor:
        tool: claude-code
        model: claude-sonnet-4-20250514
      reviewer:                               # Object, optional
        name: fabio
        approved: true
        reviewed_at: "2025-11-02T15:15:00.000Z"
        notes: "LGTM"
```

**TypeScript Types:**

```typescript
export type ExecutionStatus = "completed" | "failed" | "abandoned";

export interface ExecutionExecutor {
  tool: string;
  model?: string;
  planner?: { tool: string; model?: string };
}

export interface ExecutionReviewer {
  name: string;
  approved: boolean;
  reviewed_at: string;
  notes?: string;
}

export interface ExecutionAttempt {
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  status: ExecutionStatus;
  error_reason?: string;
  executor: ExecutionExecutor;
  reviewer?: ExecutionReviewer;
  notes?: string;
}

export interface TaskExecution {
  attempts: ExecutionAttempt[];
}

// Updated TaskMeta
export interface TaskMeta {
  // ... existing fields ...
  execution?: TaskExecution;
}
```

**Telemetry Semantics:**

```yaml
# Conceptual Model:
# - attempt: One complete agent execution session (start → end)
# - Retry counting: attempts.length - 1 (first attempt is not a retry)
# - Total execution time: sum(attempts[].duration_seconds)
# - Wall-clock time: last ended_at - first started_at
# - Idle time between attempts: wall_clock_time - total_execution_time

# Example: 3 attempts over 15 minutes
# - Total execution: 120s + 95s + 165s = 380s = 6.3 minutes
# - Wall clock: 15:12:45 - 15:03:00 = 585s = 9.8 minutes
# - Idle time: 585s - 380s = 205s = 3.4 minutes (between attempts)
# - Retry count: 3 - 1 = 2 retries
```

### Integration

**Backward Compatibility:**
- `execution` field is optional in `TaskMeta`
- Existing tasks without `execution` continue to validate
- No migration needed for existing task files

**Validation Rules:**
- `attempts` array must have at least 1 element
- All timestamps must be valid ISO 8601 strings
- `started_at` must be <= `ended_at`
- `duration_seconds` must be >= 0 integer
- `error_reason` is optional for all status values

**Consumer Integration:**
- Orchestration systems query via: `taskplain list --state done --output json`
- Consumers parse `execution.attempts[]` to analyze performance
- Example: `jq -r '.[] | select(.execution) | .execution.attempts[-1] | [.executor.model, .duration_seconds] | @tsv'`

### Unknowns

None. The schema design has been thoroughly reviewed and aligns with existing dispatch metadata patterns.

### Considerations

**Performance:**
- Additional YAML fields increase task file size (minimal impact: ~100-500 bytes per attempt)
- Array of attempts could grow large over time, but this is consumer responsibility to manage
- No impact on CLI performance: execution data is only parsed when tasks are loaded

**Testing:**
- Focus on schema validation edge cases
- Verify optional `error_reason` field is accepted
- Verify YAML round-trip: write execution data, read back, validate structure

**Documentation:**
- Clear examples in docs/product.md already added
- README.md already updated with integration examples
- No additional documentation changes needed for implementation

## Post-Implementation Insights

### Changelog
- Added execution telemetry schema for tracking agent performance and runtime metrics. Orchestration systems can now record execution attempts (duration, model used, status) in task frontmatter, enabling data-driven analysis of which models work best for different task types.

### Decisions
- Used simple `error_reason` string field instead of categorized enums to allow flexible error descriptions from different orchestration systems.
- Each attempt represents one agent session trying to complete the task, enabling analysis of how often tasks complete in one shot vs multiple tries.
- Kept execution metadata optional to allow incremental adoption without rewriting existing task files.

### Architecture
- Schema aligns with dispatch metadata (`size`, `ambiguity`, `executor`) for coherent planning → execution → analysis flow.
- Preserved nested executor planner support for future multi-step workflows without restructuring downstream code.
- Array of attempts creates natural timeline of fix iterations per task.
