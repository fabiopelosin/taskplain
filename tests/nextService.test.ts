import { describe, expect, it } from "vitest";

import type { TaskDoc } from "../src/domain/types";
import { NextService } from "../src/services/nextService";

const BASE_TIME = "2025-01-01T00:00:00.000Z";

function makeTask(
  meta: Partial<TaskDoc["meta"]> & {
    id: string;
    title: string;
    kind: TaskDoc["meta"]["kind"];
  },
): TaskDoc {
  const fullMeta: TaskDoc["meta"] = {
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    state: meta.state ?? "idea",
    priority: meta.priority ?? "normal",
    size: meta.size ?? "medium",
    ambiguity: meta.ambiguity ?? "low",
    executor: meta.executor ?? "standard",
    isolation: meta.isolation ?? "module",
    touches: meta.touches ?? [],
    depends_on: meta.depends_on ?? [],
    blocks: meta.blocks ?? [],
    blocked: meta.blocked,
    parent: meta.parent,
    children: meta.children,
    assignees: meta.assignees,
    labels: meta.labels,
    created_at: meta.created_at ?? BASE_TIME,
    updated_at: meta.updated_at ?? BASE_TIME,
    completed_at: meta.completed_at ?? null,
    links: meta.links ?? [],
    last_activity_at: meta.last_activity_at ?? BASE_TIME,
  };
  return {
    meta: fullMeta,
    body: "",
    path: `tasks/${fullMeta.state}/${fullMeta.kind}-${fullMeta.id}.md`,
  };
}

describe("NextService", () => {
  const tasks: TaskDoc[] = [
    makeTask({
      id: "epic-alpha",
      title: "Alpha Epic",
      kind: "epic",
      state: "idea",
      priority: "high",
      children: ["story-alpha"],
    }),
    makeTask({
      id: "story-root-ready",
      title: "Root Ready Story",
      kind: "story",
      state: "ready",
      priority: "high",
    }),
    makeTask({
      id: "story-alpha",
      title: "Alpha Story",
      kind: "story",
      state: "ready",
      priority: "high",
      children: ["ready-urgent", "ready-high", "ready-low", "blocked-task", "overlay-blocked"],
    }),
    makeTask({
      id: "ready-urgent",
      title: "Urgent Fix",
      kind: "task",
      state: "ready",
      priority: "urgent",
      size: "small",
      executor: "standard",
      touches: ["app/shared/**"],
      updated_at: "2025-01-02T00:00:00.000Z",
    }),
    makeTask({
      id: "ready-high",
      title: "High Priority",
      kind: "task",
      state: "ready",
      priority: "high",
      size: "medium",
      executor: "expert",
      touches: ["module:billing/forms/**"],
      updated_at: "2025-01-03T00:00:00.000Z",
    }),
    makeTask({
      id: "ready-low",
      title: "Low Priority",
      kind: "task",
      state: "ready",
      priority: "low",
      size: "tiny",
      executor: "simple",
      touches: [],
      isolation: "isolated",
      updated_at: "2025-01-04T00:00:00.000Z",
    }),
    makeTask({
      id: "blocked-task",
      title: "Blocked Task",
      kind: "task",
      state: "ready",
      depends_on: ["ready-urgent"],
      updated_at: "2025-01-05T00:00:00.000Z",
    }),
    makeTask({
      id: "overlay-blocked",
      title: "Blocked Overlay",
      kind: "task",
      state: "ready",
      priority: "high",
      blocked: "waiting on legal",
      updated_at: "2025-01-05T12:00:00.000Z",
    }),
    makeTask({
      id: "dependency-done",
      title: "Finished Dependency",
      kind: "task",
      state: "done",
      priority: "normal",
      updated_at: "2025-01-01T12:00:00.000Z",
    }),
    makeTask({
      id: "needs-done",
      title: "Ready After Dependency",
      kind: "task",
      state: "ready",
      priority: "normal",
      depends_on: ["dependency-done"],
      touches: ["services/email/**"],
      updated_at: "2025-01-06T00:00:00.000Z",
    }),
    makeTask({
      id: "global-touch",
      title: "Global Task",
      kind: "task",
      state: "ready",
      priority: "normal",
      touches: [],
      isolation: "global",
      updated_at: "2025-01-07T00:00:00.000Z",
    }),
    makeTask({
      id: "in-progress-task",
      title: "Active Work Item",
      kind: "task",
      state: "in-progress",
      priority: "urgent",
      touches: ["app/active/**"],
      updated_at: "2025-01-09T00:00:00.000Z",
    }),
    makeTask({
      id: "idea-task",
      title: "Idea Stage Task",
      kind: "task",
      state: "idea",
      priority: "urgent",
      updated_at: "2025-01-08T00:00:00.000Z",
    }),
  ];

  it("ranks ready tasks by priority, epic status, size, and staleness", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 3,
      kinds: new Set(["task"]),
      includeRootWithoutKind: true,
    });
    const ids = result.selected.map((candidate) => candidate.doc.meta.id);
    expect(ids).toEqual(["ready-urgent", "ready-high", "story-root-ready"]);
  });

  it("includes parentless stories by default", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 3,
      kinds: new Set(["task"]),
      includeRootWithoutKind: true,
    });
    const candidateIds = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(candidateIds).toContain("story-root-ready");
  });

  it("omits in-progress tasks from candidates and selections", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 10,
      kinds: new Set(["task"]),
      includeRootWithoutKind: true,
    });
    const candidateIds = result.candidates.map((candidate) => candidate.doc.meta.id);
    const selectedIds = result.selected.map((candidate) => candidate.doc.meta.id);
    expect(candidateIds).not.toContain("in-progress-task");
    expect(selectedIds).not.toContain("in-progress-task");
  });

  it("excludes tasks with incomplete dependencies", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({ count: 5, kinds: new Set(["task"]) });
    const ids = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(ids).not.toContain("blocked-task");
  });

  it("excludes blocked tasks by default", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({ count: 5, kinds: new Set(["task"]) });
    const ids = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(ids).not.toContain("overlay-blocked");
  });

  it("includes blocked tasks when explicitly requested", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 5,
      kinds: new Set(["task"]),
      includeBlocked: true,
    });
    const ids = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(ids).toContain("overlay-blocked");
  });

  it("omits idea-state tasks from candidates and selections", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 5,
      kinds: new Set(["task"]),
      includeRootWithoutKind: true,
    });
    const candidateIds = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(candidateIds).not.toContain("idea-task");
    const selectedIds = result.selected.map((candidate) => candidate.doc.meta.id);
    expect(selectedIds).not.toContain("idea-task");
  });

  it("respects executor preference when priorities tie", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 2,
      kinds: new Set(["task"]),
      executorPreference: "expert",
    });
    expect(result.selected.map((candidate) => candidate.doc.meta.id)[0]).toBe("ready-urgent");
  });

  it("filters by max size and ambiguity", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 5,
      kinds: new Set(["task"]),
      maxSize: "small",
      ambiguityFilter: new Set(["low"]),
    });
    const ids = result.candidates.map((candidate) => candidate.doc.meta.id);
    expect(ids).toEqual(["ready-urgent", "ready-low"]);
  });

  it("greedily selects non-conflicting tasks when parallelizing", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 3,
      parallelize: 3,
      kinds: new Set(["task"]),
      includeRootWithoutKind: false,
    });
    const selectedIds = result.selected.map((candidate) => candidate.doc.meta.id);
    expect(selectedIds).toContain("ready-urgent");
    expect(selectedIds).toContain("ready-high");
    expect(selectedIds).toContain("needs-done");
    const conflictEntry = result.skippedDueToConflicts.find(
      (entry) => entry.candidate.doc.meta.id === "global-touch",
    );
    expect(conflictEntry?.conflictsWith.length).toBeGreaterThan(0);
  });

  it("supports parent filter", () => {
    const service = new NextService(tasks);
    const result = service.evaluate({
      count: 5,
      kinds: new Set(["task"]),
      parent: "story-alpha",
      includeRootWithoutKind: false,
    });
    const ids = result.selected.map((candidate) => candidate.doc.meta.id);
    expect(ids).toEqual(["ready-urgent", "ready-high", "ready-low"]);
  });
});
