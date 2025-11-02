import { describe, expect, it } from "vitest";

type TaskDetail = {
  id: string;
  title?: string;
  kind?: string;
  state?: string;
  priority?: string;
  size?: string;
  ambiguity?: string;
  executor?: string;
  blocked?: string | null;
  body?: string;
  acceptance?: { completed: number; total: number } | null;
  descendant_count?: number;
  family?: {
    parent?: { id: string; title: string };
    child_count: number;
    breakdown: Record<string, number>;
  } | null;
};

async function loadDiff() {
  const mod = await import("../src/resources/web/taskDiff.js");
  const api = (mod as any).diffTaskDetails ? mod : (mod as any).default ? (mod as any).default : {};
  return (api as any).diffTaskDetails as (
    previous: TaskDetail,
    next: TaskDetail,
  ) => { changedFields: string[]; messages: string[] };
}

describe("diffTaskDetails", () => {
  it("returns empty diff when ids differ", async () => {
    const diffTaskDetails = await loadDiff();
    const result = diffTaskDetails({ id: "a" }, { id: "b" });
    expect(result).toEqual({ changedFields: [], messages: [] });
  });

  it("detects basic field changes", async () => {
    const diffTaskDetails = await loadDiff();
    const result = diffTaskDetails(
      {
        id: "task-1",
        title: "Original",
        priority: "normal",
        blocked: null,
        body: "Hello",
        acceptance: { completed: 1, total: 2 },
        family: {
          parent: { id: "parent-a", title: "Parent A" },
          child_count: 1,
          breakdown: { idea: 1, ready: 0, "in-progress": 0, done: 0, canceled: 0 },
        },
      },
      {
        id: "task-1",
        title: "Updated",
        priority: "high",
        blocked: "Waiting on review",
        body: "Hello world",
        acceptance: { completed: 2, total: 2 },
        family: {
          child_count: 2,
          breakdown: { idea: 1, ready: 1, "in-progress": 0, done: 0, canceled: 0 },
        },
      },
    );

    expect(result.changedFields).toEqual(
      expect.arrayContaining(["title", "priority", "blocked", "body", "acceptance", "children"]),
    );
    expect(result.messages.some((msg) => msg.includes("Title changed"))).toBe(true);
    expect(result.messages.some((msg) => msg.includes("Children summary"))).toBe(true);
  });

  it("captures state and parent changes", async () => {
    const diffTaskDetails = await loadDiff();
    const result = diffTaskDetails(
      {
        id: "task-2",
        state: "ready",
        kind: "task",
        family: null,
      },
      {
        id: "task-2",
        state: "in-progress",
        kind: "story",
        family: {
          parent: { id: "parent-b", title: "Parent B" },
          child_count: 0,
          breakdown: { idea: 0, ready: 0, "in-progress": 0, done: 0, canceled: 0 },
        },
      },
    );

    expect(result.changedFields).toEqual(expect.arrayContaining(["state", "kind", "parent"]));
    expect(result.messages.some((msg) => msg.includes("In Progress"))).toBe(true);
    expect(result.messages.some((msg) => msg.includes("Parent set"))).toBe(true);
  });

  it("ignores unchanged fields", async () => {
    const diffTaskDetails = await loadDiff();
    const base = {
      id: "task-3",
      title: "Same",
      priority: "normal",
      family: {
        child_count: 0,
        breakdown: { idea: 0, ready: 0, "in-progress": 0, done: 0, canceled: 0 },
      },
    };
    expect(diffTaskDetails(base, { ...base })).toEqual({ changedFields: [], messages: [] });
  });
});
