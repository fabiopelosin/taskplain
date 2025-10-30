import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { TaskService } from "../src/services/taskService";
import { buildSnapshot, WebServerService } from "../src/services/webServerService";

const stateOrder = ["idea", "ready", "in-progress", "done", "canceled"] as const;

describe("WebServerService", () => {
  let repoRoot: string;
  let service: TaskService;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-web-"));
    service = new TaskService({ repoRoot });
  });

  afterEach(async () => {
    await fs.remove(repoRoot);
  });

  it("builds a snapshot grouped by state with same-state nesting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const epic = await service.newTask({
      title: "Epic Root",
      kind: "epic",
      state: "idea",
      priority: "normal",
    });
    vi.advanceTimersByTime(1000);
    const storyBacklog = await service.newTask({
      title: "Story Backlog",
      kind: "story",
      state: "idea",
      priority: "normal",
      parent: epic.meta.id,
    });
    vi.advanceTimersByTime(1000);
    const storyReady = await service.newTask({
      title: "Story Ready",
      kind: "story",
      state: "ready",
      priority: "normal",
      parent: epic.meta.id,
    });
    vi.advanceTimersByTime(1000);
    const taskIdea = await service.newTask({
      title: "Task Idea",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: storyBacklog.meta.id,
    });
    vi.advanceTimersByTime(1000);
    const taskInProgress = await service.newTask({
      title: "Task Progress",
      kind: "task",
      state: "in-progress",
      priority: "normal",
      parent: storyBacklog.meta.id,
    });
    vi.advanceTimersByTime(1000);
    const ideaSolo = await service.newTask({
      title: "Independent Idea",
      kind: "task",
      state: "idea",
      priority: "normal",
    });
    vi.advanceTimersByTime(1000);
    const readySolo = await service.newTask({
      title: "Ready Later",
      kind: "story",
      state: "ready",
      priority: "normal",
    });
    vi.useRealTimers();

    const docs = await service.listAllTasks();
    const snapshot = buildSnapshot(docs, repoRoot);

    expect(Object.keys(snapshot.columns)).toEqual(stateOrder.slice());
    expect(snapshot.columns.idea.map((node) => node.id)).toEqual([ideaSolo.meta.id, epic.meta.id]);

    const epicNode = snapshot.columns.idea.find((node) => node.id === epic.meta.id);
    expect(epicNode?.children).toHaveLength(1);
    expect(epicNode?.children?.[0].id).toBe(storyBacklog.meta.id);
    expect(epicNode?.children?.[0].children?.[0].id).toBe(taskIdea.meta.id);
    // Tasks without actual acceptance criteria checkboxes return undefined
    expect(epicNode?.acceptance).toBeUndefined();

    expect(snapshot.columns.ready.map((node) => node.id)).toEqual([
      readySolo.meta.id,
      storyReady.meta.id,
    ]);
    expect(snapshot.columns["in-progress"].map((node) => node.id)).toEqual([
      taskInProgress.meta.id,
    ]);
  });

  it("preserves declared child order for same-state children", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T08:00:00Z"));
    const parent = await service.newTask({
      title: "Story Parent",
      kind: "story",
      state: "idea",
      priority: "normal",
    });
    vi.advanceTimersByTime(1000);
    const firstChild = await service.newTask({
      title: "Child One",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: parent.meta.id,
    });
    vi.advanceTimersByTime(1000);
    const secondChild = await service.newTask({
      title: "Child Two",
      kind: "task",
      state: "idea",
      priority: "normal",
      parent: parent.meta.id,
    });
    vi.useRealTimers();

    const docs = await service.listAllTasks();
    const snapshot = buildSnapshot(docs, repoRoot);
    const parentNode = snapshot.columns.idea.find((node) => node.id === parent.meta.id);
    expect(parentNode?.children?.map((child) => child.id)).toEqual([
      firstChild.meta.id,
      secondChild.meta.id,
    ]);
    expect(parentNode?.family?.children.map((child) => child.id)).toEqual([
      firstChild.meta.id,
      secondChild.meta.id,
    ]);
  });

  it("streams updates over websocket when tasks change", async () => {
    const story = await service.newTask({
      title: "Story Live",
      kind: "story",
      state: "ready",
      priority: "normal",
    });

    const webService = new WebServerService({
      repoRoot,
      taskService: service,
    });

    if (!(await canBindLoopback())) {
      expect(true).toBe(true);
      return;
    }

    const abortController = new AbortController();
    let resolveReady: ((value: { url: string }) => void) | undefined;
    const readyPromise = new Promise<{ url: string }>((resolve) => {
      resolveReady = resolve;
    });

    const serverPromise = webService.run({
      port: 0,
      signal: abortController.signal,
      onReady: (info) => {
        resolveReady?.({ url: info.url });
      },
    });

    const { url } = await readyPromise;
    const apiResponse = await fetch(`${url}/api/tasks`);
    expect(apiResponse.ok).toBe(true);
    const initialPayload = (await apiResponse.json()) as {
      columns: Record<string, unknown[]>;
    };
    expect(Array.isArray(initialPayload.columns.ready)).toBe(true);

    const wsUrl = `${url.replace("http", "ws")}/ws`;
    const socket = new WebSocket(wsUrl);

    const received: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket")), 5000);
      socket.on("message", (data) => {
        const payload = JSON.parse(data.toString()) as {
          type: string;
          payload: unknown;
        };
        if (payload.type === "tasks/snapshot") {
          received.push(payload.payload as Record<string, unknown>);
          if (received.length === 1) {
            service.block(story.meta.id, "waiting").catch((error) => reject(error));
          } else {
            clearTimeout(timer);
            resolve();
          }
        }
      });
      socket.on("error", (error) => reject(error));
    });

    const latest = received.at(-1) as {
      columns: Record<string, Array<Record<string, unknown>>>;
    };
    const readyColumn = latest.columns.ready;
    expect(Array.isArray(readyColumn)).toBe(true);
    const storyNode = readyColumn.find((node) => node.id === story.meta.id);
    expect(storyNode?.blocked).toBe("waiting");

    socket.close();
    abortController.abort();
    await serverPromise;
  }, 20000);

  it("creates tasks through the API", async () => {
    const webService = new WebServerService({
      repoRoot,
      taskService: service,
    });

    if (!(await canBindLoopback())) {
      expect(true).toBe(true);
      return;
    }

    const abortController = new AbortController();
    let resolveReady: ((value: { url: string; port: number }) => void) | undefined;
    const readyPromise = new Promise<{ url: string; port: number }>((resolve) => {
      resolveReady = resolve;
    });

    const serverPromise = webService.run({
      port: 0,
      signal: abortController.signal,
      onReady: (info) => resolveReady?.(info),
    });

    const { url } = await readyPromise;
    try {
      const response = await fetch(`${url}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Created from board",
          kind: "task",
          state: "idea",
          priority: "normal",
          size: "medium",
          ambiguity: "low",
          executor: "standard",
        }),
      });

      expect(response.ok).toBe(true);
      const payload = (await response.json()) as {
        id: string;
        snapshot: { columns: Record<string, Array<{ id: string }>> };
      };

      const created = await service.loadTaskById(payload.id);
      expect(created.meta.title).toBe("Created from board");
      expect(created.meta.state).toBe("idea");
      expect(created.meta.priority).toBe("normal");
      expect(created.meta.size).toBe("medium");
      expect(created.meta.ambiguity).toBe("low");
      expect(created.meta.executor).toBe("standard");

      const ideaEntries = payload.snapshot.columns.idea as Array<{
        id: string;
        acceptance?: { completed: number; total: number };
      }>;
      const ideaIds = ideaEntries.map((task) => task.id);
      expect(ideaIds).toContain(payload.id);
      const createdNode = ideaEntries.find((task) => task.id === payload.id);
      // Tasks without actual acceptance criteria checkboxes return undefined
      expect(createdNode?.acceptance).toBeUndefined();
    } finally {
      abortController.abort();
      await serverPromise;
    }
  }, 10000);
});
async function canBindLoopback(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
