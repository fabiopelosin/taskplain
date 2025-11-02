import { describe, expect, it } from "vitest";

import { executionAttemptSchema, taskExecutionSchema, taskMetaSchema } from "../src/domain/types";

const ISO = "2025-11-02T15:12:45.000Z";

describe("execution telemetry schemas", () => {
  const validAttempt = {
    started_at: "2025-11-02T15:00:00.000Z",
    ended_at: ISO,
    duration_seconds: 765,
    status: "completed" as const,
    executor: {
      tool: "claude-code",
      model: "claude-sonnet-4-20250514",
      planner: {
        tool: "orchestrator",
        model: "planner-1",
      },
    },
    reviewer: {
      name: "fabio",
      approved: true,
      reviewed_at: "2025-11-02T15:15:00.000Z",
      notes: "LGTM",
    },
    notes: "Completed successfully",
  };

  it("accepts valid execution attempts", () => {
    expect(() => executionAttemptSchema.parse(validAttempt)).not.toThrow();
  });

  it("accepts execution payloads with multiple attempts", () => {
    expect(() =>
      taskExecutionSchema.parse({
        attempts: [
          {
            ...validAttempt,
            started_at: "2025-11-02T15:03:00.000Z",
            ended_at: "2025-11-02T15:05:00.000Z",
            duration_seconds: 120,
            status: "failed",
            error_reason: "TypeError: Cannot read property 'foo' of undefined",
          },
          {
            ...validAttempt,
            started_at: "2025-11-02T15:06:25.000Z",
            ended_at: "2025-11-02T15:08:00.000Z",
            duration_seconds: 95,
            status: "failed",
            error_reason: "AssertionError: Expected 200, got 404",
          },
          validAttempt,
        ],
      }),
    ).not.toThrow();
  });

  it("accepts failed attempts with error_reason", () => {
    expect(() =>
      executionAttemptSchema.parse({
        ...validAttempt,
        status: "failed",
        error_reason: "Build failed: syntax error",
      }),
    ).not.toThrow();
  });

  it("accepts failed attempts without error_reason", () => {
    expect(() =>
      executionAttemptSchema.parse({
        ...validAttempt,
        status: "failed",
      }),
    ).not.toThrow();
  });

  it("rejects attempts with invalid status value", () => {
    expect(() =>
      executionAttemptSchema.parse({
        ...validAttempt,
        status: "running",
      }),
    ).toThrowError(/expected one of/);
  });

  it("rejects attempts with negative durations", () => {
    expect(() =>
      executionAttemptSchema.parse({
        ...validAttempt,
        duration_seconds: -1,
      }),
    ).toThrowError(/expected number to be >=0/);
  });

  it("rejects attempts where started_at is after ended_at", () => {
    expect(() =>
      executionAttemptSchema.parse({
        ...validAttempt,
        started_at: "2025-11-02T16:00:00.000Z",
        ended_at: "2025-11-02T15:00:00.000Z",
      }),
    ).toThrowError(/started_at must be less than or equal to ended_at/);
  });

  it("parses nested executor planner metadata", () => {
    const parsed = executionAttemptSchema.parse(validAttempt);
    expect(parsed.executor).toEqual({
      tool: "claude-code",
      model: "claude-sonnet-4-20250514",
      planner: {
        tool: "orchestrator",
        model: "planner-1",
      },
    });
  });

  it("allows tasks without execution metadata", () => {
    const baseMeta = {
      id: "execution-optional",
      title: "Optional execution",
      kind: "story",
      state: "idea",
      priority: "normal",
      created_at: ISO,
      updated_at: ISO,
    } as const;

    expect(() => taskMetaSchema.parse(baseMeta)).not.toThrow();
  });

  it("rejects executions missing attempts", () => {
    expect(() => taskExecutionSchema.parse({ attempts: [] })).toThrowError(
      /expected array to have >=1 items/,
    );
  });
});
