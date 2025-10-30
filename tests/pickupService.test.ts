import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PickupService } from "../src/services/pickupService";
import { TaskService } from "../src/services/taskService";

const FIXED_DATE = new Date("2025-01-01T12:00:00.000Z");

describe("PickupService", () => {
  let repoRoot: string;
  let taskService: TaskService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-pickup-service-"));
    taskService = new TaskService({ repoRoot });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.remove(repoRoot);
  });

  it("promotes idea ancestors and surfaces ready child suggestions in dry-run mode", async () => {
    const epic = await taskService.newTask({
      title: "Pickup Epic",
      kind: "epic",
      state: "idea",
      priority: "normal",
    });
    const story = await taskService.newTask({
      title: "Pickup Story",
      kind: "story",
      state: "idea",
      priority: "high",
      parent: epic.meta.id,
    });
    const readyTask = await taskService.newTask({
      title: "Ready Child",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: story.meta.id,
    });
    const blockedTask = await taskService.newTask({
      title: "Blocked Child",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: story.meta.id,
    });
    await taskService.block(blockedTask.meta.id, "waiting on review");

    const pickupService = new PickupService(taskService);
    const result = await pickupService.execute({
      id: story.meta.id,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.moves.length).toBeGreaterThanOrEqual(2);
    const moveSummary = result.moves.map((move) => ({
      id: move.id,
      from: move.fromState,
      to: move.toState,
    }));
    expect(moveSummary).toEqual(
      expect.arrayContaining([
        { id: epic.meta.id, from: "idea", to: "ready" },
        { id: story.meta.id, from: "idea", to: "in-progress" },
      ]),
    );

    expect(result.target.meta.state).toBe("in-progress");
    expect(result.ancestors[0]?.meta.state).toBe("ready");

    const candidateIds = result.children.candidates.map((candidate) => candidate.doc.meta.id);
    expect(candidateIds).not.toContain(readyTask.meta.id);

    const notReadyIds = result.children.notReady.map((entry) => entry.doc.meta.id);
    expect(notReadyIds).toEqual(expect.arrayContaining([readyTask.meta.id, blockedTask.meta.id]));

    expect(result.children.totalDirectChildren).toBe(2);
  });

  it("applies moves when not running in dry-run mode", async () => {
    const epic = await taskService.newTask({
      title: "Live Epic",
      kind: "epic",
      state: "idea",
      priority: "normal",
    });
    const story = await taskService.newTask({
      title: "Live Story",
      kind: "story",
      state: "idea",
      priority: "normal",
      parent: epic.meta.id,
    });
    await taskService.newTask({
      title: "Live Task",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: story.meta.id,
    });

    const pickupService = new PickupService(taskService);
    const result = await pickupService.execute({
      id: story.meta.id,
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    const updatedStory = await taskService.loadTaskById(story.meta.id);
    expect(updatedStory.meta.state).toBe("in-progress");
    expect(path.basename(updatedStory.path)).toMatch(/^story-live-story\.md$/);
    expect(updatedStory.path.includes(path.join("tasks", "20-in-progress"))).toBe(true);

    const updatedEpic = await taskService.loadTaskById(epic.meta.id);
    expect(updatedEpic.meta.state).toBe("ready");
    expect(updatedEpic.path.includes(path.join("tasks", "10-ready"))).toBe(true);
  });

  it("promotes ready targets into in-progress", async () => {
    const epic = await taskService.newTask({
      title: "Ready Epic",
      kind: "epic",
      state: "ready",
      priority: "normal",
    });
    const story = await taskService.newTask({
      title: "Ready Story",
      kind: "story",
      state: "ready",
      priority: "high",
      parent: epic.meta.id,
    });

    const pickupService = new PickupService(taskService);
    const result = await pickupService.execute({ id: story.meta.id });

    const storyMove = result.moves.find((move) => move.id === story.meta.id);
    expect(storyMove).toBeDefined();
    expect(storyMove?.fromState).toBe("ready");
    expect(storyMove?.toState).toBe("in-progress");
    expect(storyMove?.changed).toBe(true);

    const epicMove = result.moves.find((move) => move.id === epic.meta.id);
    expect(epicMove).toBeDefined();
    expect(epicMove?.changed).toBe(false);
    expect(epicMove?.fromState).toBe("ready");
    expect(epicMove?.toState).toBe("ready");

    const updatedStory = await taskService.loadTaskById(story.meta.id);
    expect(updatedStory.meta.state).toBe("in-progress");
    expect(updatedStory.path.includes(path.join("tasks", "20-in-progress"))).toBe(true);
  });

  it("does not suggest in-progress children when ranking next work", async () => {
    const story = await taskService.newTask({
      title: "Parent Story",
      kind: "story",
      state: "ready",
      priority: "normal",
    });
    const readyChild = await taskService.newTask({
      title: "Ready Child Work",
      kind: "task",
      state: "ready",
      priority: "high",
      parent: story.meta.id,
    });
    await taskService.newTask({
      title: "Active Child Work",
      kind: "task",
      state: "in-progress",
      priority: "high",
      parent: story.meta.id,
    });

    const pickupService = new PickupService(taskService);
    const result = await pickupService.execute({
      id: story.meta.id,
      dryRun: true,
      childSuggestionLimit: 5,
    });

    const candidateIds = result.children.candidates.map((candidate) => candidate.doc.meta.id);
    expect(candidateIds).toEqual([readyChild.meta.id]);
    const selectedIds = result.children.selected.map((candidate) => candidate.doc.meta.id);
    expect(selectedIds).toEqual([readyChild.meta.id]);
  });
});
