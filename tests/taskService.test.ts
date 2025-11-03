import os from "node:os";
import path from "node:path";
import type { MoveOptions } from "fs-extra";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitAdapter } from "../src/adapters/gitAdapter";
import { readTaskFile } from "../src/adapters/taskFile";
import { TaskService } from "../src/services/taskService";

const FIXED_DATE = new Date("2024-01-02T03:04:05.678Z");

describe("TaskService.newTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes deterministic markdown with canonical ordering", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-new-task-"));
    const service = new TaskService({ repoRoot });

    try {
      const doc = await service.newTask({
        title: "Golden Coverage Story",
        kind: "story",
        priority: "high",
        labels: ["coverage"],
        assignees: ["codex"],
      });

      const written = await fs.readFile(doc.path, "utf8");
      await expect(written).toMatchFileSnapshot("taskService.newTask.story.md");

      const reread = await readTaskFile(doc.path);
      expect(reread.doc.meta.title).toBe("Golden Coverage Story");
      expect(reread.doc.meta.labels).toEqual(["coverage"]);
      expect(reread.warnings).toHaveLength(0);
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.move", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cascades idea descendants to ready when requested", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-ready-"));
    const service = new TaskService({ repoRoot });

    try {
      const epic = await service.newTask({
        title: "Epic Root",
        kind: "epic",
        state: "ready",
        priority: "normal",
      });
      const storyBacklog = await service.newTask({
        title: "Idea Story",
        kind: "story",
        state: "idea",
        priority: "normal",
        parent: epic.meta.id,
      });
      const storyReady = await service.newTask({
        title: "Ready Story",
        kind: "story",
        state: "ready",
        priority: "normal",
        parent: epic.meta.id,
      });
      const storyDone = await service.newTask({
        title: "Done Story",
        kind: "story",
        state: "done",
        priority: "normal",
        parent: epic.meta.id,
        commit_message: "chore(test): seed done story [Task:done-story]",
      });
      const taskBacklog = await service.newTask({
        title: "Idea Task",
        kind: "task",
        state: "idea",
        priority: "normal",
        parent: storyBacklog.meta.id,
      });
      const taskProgress = await service.newTask({
        title: "Progress Task",
        kind: "task",
        state: "in-progress",
        priority: "normal",
        parent: storyBacklog.meta.id,
      });

      const result = await service.move(epic.meta.id, "in-progress", {
        cascade: "ready",
      });

      expect(result.changed).toBe(true);
      expect(result.fromState).toBe("ready");
      expect(result.toState).toBe("in-progress");
      expect(result.cascade.mode).toBe("ready");
      expect(result.cascade.changedCount).toBe(2);

      const summary = result.cascade.children.map((child) => ({
        id: child.id,
        changed: child.changed === true,
        skipped: child.skipped === true,
        reason: child.reason,
      }));

      expect(summary).toEqual([
        {
          id: storyBacklog.meta.id,
          changed: true,
          skipped: false,
          reason: "cascade:ready",
        },
        {
          id: storyReady.meta.id,
          changed: false,
          skipped: true,
          reason: "already_target_state",
        },
        {
          id: storyDone.meta.id,
          changed: false,
          skipped: true,
          reason: "terminal_state",
        },
        {
          id: taskBacklog.meta.id,
          changed: true,
          skipped: false,
          reason: "cascade:ready",
        },
        {
          id: taskProgress.meta.id,
          changed: false,
          skipped: true,
          reason: "state_excluded",
        },
      ]);

      const updatedStoryBacklog = await service.loadTaskById(storyBacklog.meta.id);
      expect(updatedStoryBacklog.meta.state).toBe("ready");
      const updatedTaskBacklog = await service.loadTaskById(taskBacklog.meta.id);
      expect(updatedTaskBacklog.meta.state).toBe("ready");
      const updatedTaskProgress = await service.loadTaskById(taskProgress.meta.id);
      expect(updatedTaskProgress.meta.state).toBe("in-progress");
      const updatedStoryReady = await service.loadTaskById(storyReady.meta.id);
      expect(updatedStoryReady.meta.state).toBe("ready");
      const updatedStoryDone = await service.loadTaskById(storyDone.meta.id);
      expect(updatedStoryDone.meta.state).toBe("done");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("respects dry-run cancellations across descendants", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-cancel-"));
    const service = new TaskService({ repoRoot });

    try {
      const epic = await service.newTask({
        title: "Epic Cancel",
        kind: "epic",
        state: "ready",
        priority: "normal",
      });
      const storyReady = await service.newTask({
        title: "Story Ready",
        kind: "story",
        state: "ready",
        priority: "normal",
        parent: epic.meta.id,
      });
      const taskProgress = await service.newTask({
        title: "Active Task",
        kind: "task",
        state: "in-progress",
        priority: "normal",
        parent: storyReady.meta.id,
      });

      const result = await service.move(epic.meta.id, "canceled", {
        dryRun: true,
        cascade: "cancel",
      });

      expect(result.dryRun).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.cascade.mode).toBe("cancel");
      expect(result.cascade.changedCount).toBe(2);

      const cascadeSummary = result.cascade.children.filter((child) => child.changed === true);
      expect(cascadeSummary.map((child) => child.id)).toEqual([
        storyReady.meta.id,
        taskProgress.meta.id,
      ]);

      const reloadedEpic = await service.loadTaskById(epic.meta.id);
      expect(reloadedEpic.meta.state).toBe("ready");
      const reloadedStory = await service.loadTaskById(storyReady.meta.id);
      expect(reloadedStory.meta.state).toBe("ready");
      const reloadedTask = await service.loadTaskById(taskProgress.meta.id);
      expect(reloadedTask.meta.state).toBe("in-progress");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("refuses to move blocked tasks unless forced or canceling", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-blocked-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Blocked Parent",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await service.block(task.meta.id, "waiting on approval");

      await expect(service.move(task.meta.id, "in-progress")).rejects.toThrow(/blocked/);

      const forced = await service.move(task.meta.id, "in-progress", {
        force: true,
      });
      expect(forced.changed).toBe(true);
      expect(forced.meta.blocked).toBe("waiting on approval");

      const canceled = await service.move(task.meta.id, "canceled");
      expect(canceled.changed).toBe(true);
      expect(canceled.toState).toBe("canceled");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("renames tasks into dated done filenames when completing", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-complete-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Finish Reports",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await service.update({
        id: task.meta.id,
        metaPatch: {
          commit_message: "chore(test): finish reports [Task:finish-reports]",
        },
        unset: [],
        sections: {},
      });

      const previousPath = task.path;
      const result = await service.move(task.meta.id, "done");

      expect(result.changed).toBe(true);
      expect(result.meta.state).toBe("done");
      expect(result.meta.completed_at).toBe("2024-01-02T03:04:05.678Z");

      const relativeDonePath = path.join("tasks", "30-done", "2024-01-02 task-finish-reports.md");
      expect(path.relative(repoRoot, result.toPath)).toBe(relativeDonePath);

      const moved = await service.loadTaskById(task.meta.id);
      expect(path.relative(repoRoot, moved.path)).toBe(relativeDonePath);
      expect(await fs.pathExists(previousPath)).toBe(false);
      expect(await fs.pathExists(path.join(repoRoot, relativeDonePath))).toBe(true);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("previews done renames without touching disk in dry-run mode", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-dry-run-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Dry Run Task",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await service.update({
        id: task.meta.id,
        metaPatch: {
          commit_message: "chore(test): dry run [Task:dry-run-task]",
        },
        unset: [],
        sections: {},
      });

      const originalPath = task.path;
      const result = await service.move(task.meta.id, "done", { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.changed).toBe(true);
      expect(path.relative(repoRoot, result.toPath)).toBe(
        path.join("tasks", "30-done", "2024-01-02 task-dry-run-task.md"),
      );

      const reloaded = await service.loadTaskById(task.meta.id);
      expect(reloaded.meta.state).toBe("ready");
      expect(reloaded.path).toBe(originalPath);
      expect(await fs.pathExists(originalPath)).toBe(true);
      expect(await fs.pathExists(result.toPath)).toBe(false);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("allows transitions from terminal states", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-invalid-"));
    const service = new TaskService({ repoRoot });

    try {
      const completed = await service.newTask({
        title: "Already Done",
        kind: "task",
        state: "done",
        priority: "normal",
        commit_message: "chore(test): already done [Task:already-done]",
      });

      const moved = await service.move(completed.meta.id, "ready");
      expect(moved.changed).toBe(true);
      expect(moved.fromState).toBe("done");
      expect(moved.toState).toBe("ready");
      const reloaded = await service.loadTaskById(completed.meta.id);
      expect(reloaded.meta.state).toBe("ready");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("falls back to filesystem move when git mv fails", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-fallback-"));
    const git: Partial<GitAdapter> = {
      mv: vi.fn().mockRejectedValue(new Error("not tracked")),
    };
    const service = new TaskService({ repoRoot, git: git as GitAdapter });

    const realMove = fs.move;
    const moveSpy = vi
      .spyOn(fs, "move")
      .mockImplementation(async (source, destination, options) => {
        return realMove(source, destination, options as MoveOptions);
      });

    try {
      const task = await service.newTask({
        title: "Fallback Task",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      const result = await service.move(task.meta.id, "in-progress");

      expect(result.changed).toBe(true);
      expect(git.mv).toHaveBeenCalledWith(
        path.join("tasks", "10-ready", "task-fallback-task.md"),
        path.join("tasks", "20-in-progress", "task-fallback-task.md"),
      );
      expect(moveSpy).toHaveBeenCalledTimes(1);
      expect(path.relative(repoRoot, result.toPath)).toBe(
        path.join("tasks", "20-in-progress", "task-fallback-task.md"),
      );
    } finally {
      moveSpy.mockRestore();
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService handling of invalid files", () => {
  it("skips invalid metadata files with warnings when listing", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-invalid-meta-"));
    const service = new TaskService({ repoRoot });

    try {
      const valid = await service.newTask({
        title: "Valid Task",
        kind: "task",
        state: "idea",
        priority: "normal",
      });

      const invalidDir = path.join(repoRoot, "tasks", "00-idea");
      await fs.ensureDir(invalidDir);
      const invalidPath = path.join(invalidDir, "task-invalid-links.md");

      const invalidContent = `---\n` +
        `id: task-invalid-links\n` +
        `title: Invalid Links\n` +
        `kind: task\n` +
        `state: idea\n` +
        `priority: normal\n` +
        `created_at: 2025-11-03T00:00:00.000Z\n` +
        `updated_at: 2025-11-03T00:00:00.000Z\n` +
        `last_activity_at: 2025-11-03T00:00:00.000Z\n` +
        `links:\n` +
        `  - type: file\n` +
        `    url: ./example.md\n` +
        `---\n\n` +
        `## Overview\n` +
        `Invalid placeholder.\n\n` +
        `## Acceptance Criteria\n` +
        `- [ ] placeholder\n\n` +
        `## Technical Approach\n` +
        `TBD\n`;

      await fs.writeFile(invalidPath, invalidContent, "utf8");

      const docs = await service.listAllTasks();
      const ids = docs.map((doc) => doc.meta.id);
      expect(ids).toContain(valid.meta.id);
      expect(ids).not.toContain("task-invalid-links");

      const warnings = service.drainWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      const parseWarning = warnings.find((warning) => warning.code === "parse_failed");
      expect(parseWarning).toBeDefined();
      expect(parseWarning?.file).toBe(invalidPath);
      expect(parseWarning?.message).toContain("links[0].type");
      expect(parseWarning?.message).toContain("Unsupported link type");
      expect(parseWarning?.field).toBe("links[0].type");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("reports skipped invalid files when loading missing tasks", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-invalid-read-"));
    const service = new TaskService({ repoRoot });

    try {
      const invalidDir = path.join(repoRoot, "tasks", "00-idea");
      await fs.ensureDir(invalidDir);
      const invalidPath = path.join(invalidDir, "broken-frontmatter.md");
      await fs.writeFile(invalidPath, "---\n[[\n---\n", "utf8");

      await expect(service.loadTaskById("missing-task"))
        .rejects.toThrow("skipped 1 invalid file");

      const warnings = service.drainWarnings();
      const readWarning = warnings.find((warning) => warning.code === "read_failed");
      expect(readWarning).toBeDefined();
      expect(readWarning?.file).toBe(invalidPath);
      expect(readWarning?.message).toContain("Unable to read task file");
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.complete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves tasks to done and stamps completion metadata", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-move-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Complete Coverage",
        kind: "task",
        state: "ready",
        priority: "high",
      });

      await service.update({
        id: task.meta.id,
        metaPatch: {
          commit_message: "feat(test): complete coverage [Task:complete-coverage]",
        },
        unset: [],
        sections: {},
      });

      const result = await service.complete(task.meta.id);
      expect(result.dryRun).toBe(false);
      expect(result.changed).toBe(true);
      expect(result.fromState).toBe("ready");
      expect(result.toState).toBe("done");
      expect(result.meta.state).toBe("done");
      expect(result.meta.completed_at).toBe("2024-01-02T03:04:05.678Z");

      const relativeDonePath = path.join(
        "tasks",
        "30-done",
        "2024-01-02 task-complete-coverage.md",
      );
      expect(path.relative(repoRoot, result.toPath)).toBe(relativeDonePath);

      const fromDisk = await service.loadTaskById(task.meta.id);
      expect(path.relative(repoRoot, fromDisk.path)).toBe(relativeDonePath);
      expect(fromDisk.meta.state).toBe("done");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("previews completion in dry-run mode without touching disk", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-dry-run-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Preview Completion",
        kind: "task",
        state: "in-progress",
        priority: "normal",
      });
      const originalPath = task.path;

      await service.update({
        id: task.meta.id,
        metaPatch: {
          commit_message: "feat(test): preview completion [Task:preview-completion]",
        },
        unset: [],
        sections: {},
      });

      const preview = await service.complete(task.meta.id, { dryRun: true });
      expect(preview.dryRun).toBe(true);
      expect(preview.changed).toBe(true);
      expect(preview.toState).toBe("done");

      const reloaded = await service.loadTaskById(task.meta.id);
      expect(reloaded.meta.state).toBe("in-progress");
      expect(reloaded.path).toBe(originalPath);
      expect(await fs.pathExists(originalPath)).toBe(true);
      expect(await fs.pathExists(preview.toPath)).toBe(false);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("rejects completion when descendants remain unfinished", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-blocked-"));
    const service = new TaskService({ repoRoot });

    try {
      const story = await service.newTask({
        title: "Blocked Story",
        kind: "story",
        state: "in-progress",
        priority: "high",
      });
      const child = await service.newTask({
        title: "Pending Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: story.meta.id,
      });

      await expect(service.complete(story.meta.id)).rejects.toThrow(
        `Cannot complete ${story.meta.id}. Blocking descendants: ${child.meta.id}`,
      );
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("is a no-op when the task is already done", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-noop-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Already Finished",
        kind: "task",
        state: "done",
        priority: "normal",
        commit_message: "chore(test): already finished [Task:already-finished]",
      });

      const result = await service.complete(task.meta.id);
      expect(result.changed).toBe(false);
      expect(result.fromState).toBe("done");
      expect(result.toState).toBe("done");
      expect(result.meta.state).toBe("done");
      expect(result.dryRun).toBe(false);
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.newTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates done tasks with dated filenames and completion timestamps", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-new-task-"));
    const service = new TaskService({ repoRoot });

    try {
      const doc = await service.newTask({
        title: "Ship Completed Story",
        kind: "story",
        state: "done",
        priority: "high",
        commit_message: "feat(test): completed story fixture [Task:ship-completed-story]",
      });

      const expectedRelativePath = path.join(
        "tasks",
        "30-done",
        "2024-01-02 story-ship-completed-story.md",
      );
      expect(path.relative(repoRoot, doc.path)).toBe(expectedRelativePath);
      expect(doc.meta.state).toBe("done");
      expect(doc.meta.completed_at).toBe("2024-01-02T03:04:05.678Z");

      const { doc: fromDisk } = await readTaskFile(doc.path);
      expect(path.relative(repoRoot, fromDisk.path)).toBe(expectedRelativePath);
      expect(fromDisk.meta.completed_at).toBe("2024-01-02T03:04:05.678Z");
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.update", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects updates to fields outside the allowlist", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-update-allowlist-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Allowlist Check",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await expect(
        service.update({
          id: task.meta.id,
          metaPatch: {
            title: "Valid Change",
          },
          unset: [],
          sections: {
            overview: "still valid",
          },
        }),
      ).resolves.toMatchObject({
        changed: true,
      });

      await expect(
        service.update({
          id: task.meta.id,
          metaPatch: {
            // @ts-expect-error intentional invalid field
            imaginary: "value",
          },
          unset: [],
          sections: {},
        }),
      ).rejects.toThrow(/Field 'imaginary'/);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("updates timestamps when metadata changes", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-update-timestamps-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Timestamp Task",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      const firstDoc = await service.loadTaskById(task.meta.id);
      const baselineUpdatedAt = firstDoc.meta.updated_at;
      expect(baselineUpdatedAt).toBe("2024-01-02T03:04:05.678Z");

      const later = new Date(FIXED_DATE.getTime() + 60_000);
      vi.setSystemTime(later);

      const result = await service.update({
        id: task.meta.id,
        metaPatch: {
          priority: "high",
        },
        unset: [],
        sections: {},
      });

      expect(result.changed).toBe(true);
      expect(result.meta.priority).toBe("high");
      expect(result.meta.updated_at).toBe("2024-01-02T03:05:05.678Z");
      expect(result.meta.last_activity_at).toBe("2024-01-02T03:05:05.678Z");

      const updatedDoc = await service.loadTaskById(task.meta.id);
      expect(updatedDoc.meta.updated_at).toBe("2024-01-02T03:05:05.678Z");
      expect(updatedDoc.meta.last_activity_at).toBe("2024-01-02T03:05:05.678Z");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("replaces the entire body when rawBody is provided", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-update-body-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Body Update",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      const nextBody = [
        "## Overview",
        "",
        "Fresh overview content.",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] First requirement",
        "",
        "## Technical Approach",
        "",
        "Plan goes here.",
        "",
        "## Post-Implementation Insights",
        "",
        "Notes go here.",
        "",
        "Validation details.",
      ].join("\n");

      const later = new Date(FIXED_DATE.getTime() + 120_000);
      vi.setSystemTime(later);

      const result = await service.update({
        id: task.meta.id,
        metaPatch: {},
        unset: [],
        sections: {},
        rawBody: nextBody,
      });

      expect(result.changed).toBe(true);
      expect(result.meta.updated_at).toBe("2024-01-02T03:06:05.678Z");

      const updatedDoc = await service.loadTaskById(task.meta.id);
      expect(updatedDoc.body.trim()).toBe(nextBody.trim());
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.deleteTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes the task file and detaches it from its parent", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-delete-"));
    const service = new TaskService({ repoRoot });

    try {
      const story = await service.newTask({
        title: "Parent Story",
        kind: "story",
        state: "ready",
        priority: "normal",
      });
      const keepTask = await service.newTask({
        title: "Keep Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: story.meta.id,
      });
      const removeTask = await service.newTask({
        title: "Remove Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: story.meta.id,
      });

      const result = await service.deleteTask(removeTask.meta.id);

      expect(result.deleted).toBe(true);
      expect(result.parentUpdates).toHaveLength(1);
      expect(result.parentUpdates[0].id).toBe(story.meta.id);
      expect(result.parentUpdates[0].next).toEqual([keepTask.meta.id]);

      const exists = await fs.pathExists(removeTask.path);
      expect(exists).toBe(false);

      const updatedParent = await service.loadTaskById(story.meta.id);
      expect(updatedParent.meta.children).toEqual([keepTask.meta.id]);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("refuses to delete tasks referenced by dependencies", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-delete-deps-"));
    const service = new TaskService({ repoRoot });

    try {
      const story = await service.newTask({
        title: "Dep Story",
        kind: "story",
        state: "ready",
        priority: "normal",
      });
      const dependency = await service.newTask({
        title: "Referenced Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: story.meta.id,
      });
      const dependent = await service.newTask({
        title: "Depends Task",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: story.meta.id,
      });

      await service.update({
        id: dependent.meta.id,
        metaPatch: { depends_on: [dependency.meta.id] },
        unset: [],
        sections: {},
      });

      await expect(service.deleteTask(dependency.meta.id)).rejects.toThrow(/other tasks reference/);
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.adoptChild", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds an orphan story to an epic", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-adopt-epic-"));
    const service = new TaskService({ repoRoot });

    try {
      const epic = await service.newTask({
        title: "Epic Root",
        kind: "epic",
        state: "ready",
        priority: "normal",
      });
      const existing = await service.newTask({
        title: "Existing Story",
        kind: "story",
        state: "ready",
        priority: "normal",
        parent: epic.meta.id,
      });
      const orphan = await service.newTask({
        title: "Orphan Story",
        kind: "story",
        state: "ready",
        priority: "normal",
      });

      const result = await service.adoptChild(epic.meta.id, orphan.meta.id);

      expect(result.changed).toBe(true);
      expect(result.parent.id).toBe(epic.meta.id);
      expect(result.updates[0].role).toBe("target");
      expect(result.updates[0].next).toEqual([existing.meta.id, orphan.meta.id]);

      const noOp = await service.adoptChild(epic.meta.id, orphan.meta.id);
      expect(noOp.changed).toBe(false);
      expect(noOp.updates[0].previous).toEqual(noOp.updates[0].next);

      const updatedEpic = await service.loadTaskById(epic.meta.id);
      expect(updatedEpic.meta.children).toEqual([existing.meta.id, orphan.meta.id]);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("supports dry-run and reparenting with ordering controls", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-adopt-story-"));
    const service = new TaskService({ repoRoot });

    try {
      const epic = await service.newTask({
        title: "Epic",
        kind: "epic",
        state: "ready",
        priority: "normal",
      });
      const storyAlpha = await service.newTask({
        title: "Alpha",
        kind: "story",
        state: "ready",
        priority: "normal",
        parent: epic.meta.id,
      });
      const storyBeta = await service.newTask({
        title: "Beta",
        kind: "story",
        state: "ready",
        priority: "normal",
        parent: epic.meta.id,
      });
      const alphaPrimary = await service.newTask({
        title: "Alpha Primary",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: storyAlpha.meta.id,
      });
      const alphaSecondary = await service.newTask({
        title: "Alpha Secondary",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: storyAlpha.meta.id,
      });
      const betaExisting = await service.newTask({
        title: "Beta Existing",
        kind: "task",
        state: "ready",
        priority: "normal",
        parent: storyBeta.meta.id,
      });
      const orphanTask = await service.newTask({
        title: "Orphan Task",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      const preview = await service.adoptChild(storyBeta.meta.id, orphanTask.meta.id, {
        dryRun: true,
        before: betaExisting.meta.id,
      });
      expect(preview.dryRun).toBe(true);
      expect(preview.changed).toBe(true);

      const betaBefore = await service.loadTaskById(storyBeta.meta.id);
      expect(betaBefore.meta.children).toEqual([betaExisting.meta.id]);

      const applied = await service.adoptChild(storyBeta.meta.id, orphanTask.meta.id, {
        before: betaExisting.meta.id,
      });
      expect(applied.changed).toBe(true);
      const betaAfterFirst = await service.loadTaskById(storyBeta.meta.id);
      expect(betaAfterFirst.meta.children).toEqual([orphanTask.meta.id, betaExisting.meta.id]);

      const reparent = await service.adoptChild(storyBeta.meta.id, alphaPrimary.meta.id, {
        after: orphanTask.meta.id,
      });
      expect(reparent.changed).toBe(true);
      const formerUpdate = reparent.updates.find((entry) => entry.role === "former");
      expect(formerUpdate?.id).toBe(storyAlpha.meta.id);
      expect(formerUpdate?.next).toEqual([alphaSecondary.meta.id]);
      const targetUpdate = reparent.updates.find((entry) => entry.role === "target");
      expect(targetUpdate?.next).toEqual([
        orphanTask.meta.id,
        alphaPrimary.meta.id,
        betaExisting.meta.id,
      ]);

      const alphaAfter = await service.loadTaskById(storyAlpha.meta.id);
      expect(alphaAfter.meta.children).toEqual([alphaSecondary.meta.id]);
      const betaFinal = await service.loadTaskById(storyBeta.meta.id);
      expect(betaFinal.meta.children).toEqual([
        orphanTask.meta.id,
        alphaPrimary.meta.id,
        betaExisting.meta.id,
      ]);
    } finally {
      await fs.remove(repoRoot);
    }
  });
});

describe("TaskService.block and unblock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets and persists a blocked message", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-block-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Needs Review",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      const result = await service.block(task.meta.id, "waiting for reviewer");
      expect(result.changed).toBe(true);
      expect(result.blocked).toBe("waiting for reviewer");

      const { doc } = await readTaskFile(task.path);
      expect(doc.meta.blocked).toBe("waiting for reviewer");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("returns unchanged when message does not change", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-block-nochange-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Pending Decision",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await service.block(task.meta.id, "waiting on legal");
      const repeat = await service.block(task.meta.id, "waiting on legal");
      expect(repeat.changed).toBe(false);
      expect(repeat.blocked).toBe("waiting on legal");
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("removes the blocked marker and reports the previous value", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-unblock-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Awaiting QA",
        kind: "task",
        state: "ready",
        priority: "normal",
      });

      await service.block(task.meta.id, "qa pass");
      const result = await service.unblock(task.meta.id);
      expect(result.changed).toBe(true);
      expect(result.previousBlocked).toBe("qa pass");

      const { doc } = await readTaskFile(task.path);
      expect(Object.hasOwn(doc.meta, "blocked")).toBe(false);
    } finally {
      await fs.remove(repoRoot);
    }
  });

  it("emits a warning when blocking a completed task", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-block-done-"));
    const service = new TaskService({ repoRoot });

    try {
      const task = await service.newTask({
        title: "Done Item",
        kind: "task",
        state: "done",
        priority: "normal",
        commit_message: "chore(test): done item [Task:done-item]",
      });

      await service.block(task.meta.id, "post-release note");
      const warnings = service.drainWarnings();
      expect(warnings.some((warning) => warning.code === "blocked_terminal_state")).toBe(true);
    } finally {
      await fs.remove(repoRoot);
    }
  });
});
