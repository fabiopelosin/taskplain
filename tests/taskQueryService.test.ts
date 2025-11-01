import { describe, expect, it } from "vitest";

import type { TaskDoc } from "../src/domain/types";
import { TaskQueryService } from "../src/services/taskQueryService";

function buildDoc(meta: TaskDoc["meta"], path: string): TaskDoc {
  return {
    meta: {
      size: "medium",
      ambiguity: "low",
      executor: "standard",
      isolation: "module",
      touches: [],
      depends_on: [],
      blocks: [],
      ...meta,
    },
    body: "",
    path,
  };
}

const BASE_TIME = "2025-01-01T00:00:00.000Z";

describe("TaskQueryService.buildOpenTree", () => {
  const docs: TaskDoc[] = [
    buildDoc(
      {
        id: "landing-page",
        title: "Landing Page Refresh",
        kind: "epic",
        state: "idea",
        priority: "high",
        created_at: BASE_TIME,
        updated_at: "2025-01-06T10:00:00.000Z",
      },
      "tasks/00-idea/epic-landing-page.md",
    ),
    buildDoc(
      {
        id: "hero-copy",
        title: "Rewrite hero copy",
        kind: "story",
        state: "idea",
        priority: "normal",
        parent: "landing-page",
        created_at: BASE_TIME,
        updated_at: "2025-01-05T09:00:00.000Z",
      },
      "tasks/00-idea/story-hero-copy.md",
    ),
    buildDoc(
      {
        id: "cta-copy",
        title: "Polish CTA wording",
        kind: "task",
        state: "idea",
        priority: "normal",
        parent: "hero-copy",
        created_at: BASE_TIME,
        updated_at: "2025-01-04T08:00:00.000Z",
      },
      "tasks/00-idea/task-cta-copy.md",
    ),
    buildDoc(
      {
        id: "email-verification",
        title: "Tighten email verification",
        kind: "story",
        state: "ready",
        priority: "high",
        parent: "landing-page",
        created_at: BASE_TIME,
        updated_at: "2025-01-07T11:00:00.000Z",
      },
      "tasks/10-ready/story-email-verification.md",
    ),
    buildDoc(
      {
        id: "verify-copy",
        title: "Audit verification copy",
        kind: "task",
        state: "ready",
        priority: "urgent",
        parent: "email-verification",
        created_at: BASE_TIME,
        updated_at: "2025-01-07T12:00:00.000Z",
      },
      "tasks/10-ready/task-verify-copy.md",
    ),
    buildDoc(
      {
        id: "blocked-open-task",
        title: "Blocked open task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: "email-verification",
        blocked: "waiting on UX",
        created_at: BASE_TIME,
        updated_at: "2025-01-08T12:00:00.000Z",
      },
      "tasks/10-ready/task-blocked-open-task.md",
    ),
    buildDoc(
      {
        id: "billing-a11y",
        title: "Billing form accessibility",
        kind: "story",
        state: "idea",
        priority: "high",
        created_at: BASE_TIME,
        updated_at: "2025-01-03T07:00:00.000Z",
      },
      "tasks/00-idea/story-billing-a11y.md",
    ),
    buildDoc(
      {
        id: "metric-name",
        title: "Fix metric name",
        kind: "task",
        state: "idea",
        priority: "low",
        created_at: BASE_TIME,
        updated_at: "2025-01-02T06:00:00.000Z",
      },
      "tasks/00-idea/task-metric-name.md",
    ),
    buildDoc(
      {
        id: "missing-parent",
        title: "Dangling parent",
        kind: "task",
        state: "idea",
        priority: "normal",
        parent: "ghost-story",
        created_at: BASE_TIME,
        updated_at: "2025-01-01T05:00:00.000Z",
      },
      "tasks/00-idea/task-missing-parent.md",
    ),
  ];

  const service = new TaskQueryService(docs);

  it("groups open work by state, epic, story, and task", () => {
    const openTree = service.buildOpenTree(["idea", "ready"]);
    expect(openTree).toHaveLength(2);

    const ideaGroup = openTree[0];
    expect(ideaGroup.state).toBe("idea");
    expect(ideaGroup.by_epic).toHaveLength(1);
    const landingEpic = ideaGroup.by_epic[0];
    expect(landingEpic.epic.id).toBe("landing-page");
    expect(landingEpic.children).toHaveLength(1);
    expect(landingEpic.children[0].story.id).toBe("hero-copy");
    expect(landingEpic.children[0].tasks.map((task) => task.id)).toEqual(["cta-copy"]);

    expect(ideaGroup.ungrouped.stories.map((story) => story.id)).toEqual(["billing-a11y"]);
    expect(ideaGroup.ungrouped.tasks.map((task) => task.id)).toEqual([
      "missing-parent",
      "metric-name",
    ]);

    const ready = openTree[1];
    expect(ready.state).toBe("ready");
    expect(ready.by_epic).toHaveLength(1);
    expect(ready.by_epic[0].epic.id).toBe("landing-page");
    expect(ready.by_epic[0].children[0].story.id).toBe("email-verification");
    expect(ready.by_epic[0].children[0].tasks[0].id).toBe("verify-copy");
  });

  it("defaults to idea,ready,in-progress when input is empty or invalid", () => {
    const openTree = service.buildOpenTree(["done" as never, "invalid" as never]);
    expect(openTree.map((group) => group.state)).toEqual(["idea", "ready"]);
  });

  it("filters by priority while keeping ancestors", () => {
    const openTree = service.buildOpenTree(["idea", "ready"], {
      priority: "urgent",
    });
    const readyGroup = openTree.find((group) => group.state === "ready");
    expect(readyGroup).toBeDefined();
    expect(readyGroup?.by_epic).toHaveLength(1);
    const epicGroup = readyGroup?.by_epic[0];
    expect(epicGroup?.epic.id).toBe("landing-page");
    expect(epicGroup?.children).toHaveLength(1);
    const storyGroup = epicGroup?.children[0];
    expect(storyGroup?.story.id).toBe("email-verification");
    expect(storyGroup?.tasks.map((task) => task.id)).toEqual(["verify-copy"]);
  });

  it("carries blocked metadata on open items", () => {
    const openTree = service.buildOpenTree(["ready"]);
    const readyGroup = openTree.find((group) => group.state === "ready");
    const epicGroup = readyGroup?.by_epic[0];
    const storyGroup = epicGroup?.children[0];
    const blockedTask = storyGroup?.tasks.find((task) => task.id === "blocked-open-task");
    expect(blockedTask?.blocked).toBe("waiting on UX");
  });

  it("emits stable open item structure", () => {
    const [ideaOnlyGroup] = service.buildOpenTree(["idea"]);
    const [epicGroup] = ideaOnlyGroup.by_epic;
    expect(epicGroup).toBeDefined();
    const epicKeys = Object.keys(epicGroup.epic);
    expect(epicKeys).toEqual(["id", "kind", "state", "priority", "title", "path", "updated_at"]);
    const storyKeys = Object.keys(epicGroup.children[0].story);
    expect(storyKeys).toEqual([
      "id",
      "kind",
      "state",
      "priority",
      "title",
      "path",
      "updated_at",
      "parent",
    ]);
    const taskKeys = Object.keys(epicGroup.children[0].tasks[0]);
    expect(taskKeys).toEqual([
      "id",
      "kind",
      "state",
      "priority",
      "title",
      "path",
      "updated_at",
      "parent",
    ]);
  });

  it("hides blocked work when requesting ready-only", () => {
    const openTree = service.buildOpenTree(["ready"], { readyOnly: true });
    const readyGroup = openTree.find((group) => group.state === "ready");
    const epicGroup = readyGroup?.by_epic[0];
    const storyGroup = epicGroup?.children[0];
    const taskIds = storyGroup?.tasks.map((task) => task.id) ?? [];
    expect(taskIds).not.toContain("blocked-open-task");
  });
});

describe("TaskQueryService.list", () => {
  const docs: TaskDoc[] = [
    buildDoc(
      {
        id: "open-blocked",
        title: "Blocked Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        blocked: "waiting",
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
      },
      "tasks/10-ready/task-open-blocked.md",
    ),
    buildDoc(
      {
        id: "open-ready",
        title: "Ready Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
      },
      "tasks/10-ready/task-open-ready.md",
    ),
    buildDoc(
      {
        id: "done-blocked",
        title: "Done but blocked",
        kind: "task",
        state: "done",
        priority: "normal",
        blocked: "should warn",
        created_at: BASE_TIME,
        updated_at: BASE_TIME,
        commit_message: "chore(test): done blocked [Task:done-blocked]",
      },
      "tasks/30-done/task-done-blocked.md",
    ),
  ];

  const service = new TaskQueryService(docs);

  it("returns only blocked open items when blocked flag is true", () => {
    const items = service.list({ blocked: true, openStatesOnly: true });
    expect(items.map((item) => item.id)).toEqual(["open-blocked"]);
    expect(items[0].blocked).toBe("waiting");
  });

  it("returns only unblocked open items when blocked flag is false", () => {
    const items = service.list({ blocked: false, openStatesOnly: true });
    expect(items.map((item) => item.id)).toEqual(["open-ready"]);
  });
});
