import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";
import YAML from "yaml";

import { cliPath, ensureCliBuilt } from "../helpers/cliHarness";

const execFileAsync = promisify(execFile);

interface ExecutionAttemptInput {
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  status: "completed" | "failed" | "abandoned";
  executor: {
    tool: string;
    model?: string;
  };
  error_reason?: string;
}

async function updateFrontmatter(absPath: string, patch: Record<string, unknown>): Promise<void> {
  const contents = await fs.readFile(absPath, "utf8");
  const match = contents.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Frontmatter missing in ${absPath}`);
  }
  const meta = YAML.parse(match[1] ?? "") ?? {};
  const nextMeta = { ...meta, ...patch };
  const nextFront = YAML.stringify(nextMeta, { lineWidth: 0 });
  const ensuredFront = nextFront.endsWith("\n") ? nextFront : `${nextFront}\n`;
  const rebuilt = `---\n${ensuredFront}---\n${match[2] ?? ""}`;
  await fs.writeFile(absPath, rebuilt, "utf8");
}

async function seedTelemetryWorkspace(): Promise<{
  tempDir: string;
  storyId: string;
  taskAId: string;
  taskBId: string;
  taskCId: string;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-stats-"));
  try {
    await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });

    const now = Date.now();
    const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000);

    const storyJson = await execFileAsync(
      "node",
      [cliPath, "new", "--title", "Telemetry Story", "--kind", "story", "--output", "json"],
      { cwd: tempDir },
    );
    const storyPayload = JSON.parse(storyJson.stdout) as { id: string; path: string };
    const storyPath = path.join(tempDir, storyPayload.path);

    const taskAJson = await execFileAsync(
      "node",
      [cliPath, "new", "--title", "Task Alpha", "--parent", storyPayload.id, "--output", "json"],
      { cwd: tempDir },
    );
    const taskAPayload = JSON.parse(taskAJson.stdout) as { id: string; path: string };
    const taskAPath = path.join(tempDir, taskAPayload.path);

    const taskBJson = await execFileAsync(
      "node",
      [cliPath, "new", "--title", "Task Beta", "--parent", storyPayload.id, "--output", "json"],
      { cwd: tempDir },
    );
    const taskBPayload = JSON.parse(taskBJson.stdout) as { id: string; path: string };
    const taskBPath = path.join(tempDir, taskBPayload.path);

    const taskCJson = await execFileAsync(
      "node",
      [cliPath, "new", "--title", "Task Gamma", "--parent", storyPayload.id, "--output", "json"],
      { cwd: tempDir },
    );
    const taskCPayload = JSON.parse(taskCJson.stdout) as { id: string; path: string };
    const taskCPath = path.join(tempDir, taskCPayload.path);

    const buildAttempts = (base: Date, model: string): ExecutionAttemptInput[] => {
      const attempt1Start = new Date(base.getTime() - 10 * 60 * 1000);
      const attempt1End = new Date(base.getTime() - 9 * 60 * 1000);
      const attempt2Start = new Date(base.getTime() - 5 * 60 * 1000);
      const attempt2End = new Date(base.getTime() - 3 * 60 * 1000);
      return [
        {
          started_at: attempt1Start.toISOString(),
          ended_at: attempt1End.toISOString(),
          duration_seconds: Math.round((attempt1End.getTime() - attempt1Start.getTime()) / 1000),
          status: "failed",
          executor: { tool: "agent-alpha", model },
          error_reason: "timeout",
        },
        {
          started_at: attempt2Start.toISOString(),
          ended_at: attempt2End.toISOString(),
          duration_seconds: Math.round((attempt2End.getTime() - attempt2Start.getTime()) / 1000),
          status: "completed",
          executor: { tool: "agent-alpha", model },
        },
      ];
    };

    const baseA = hoursAgo(2);
    await updateFrontmatter(taskAPath, {
      updated_at: baseA.toISOString(),
      last_activity_at: baseA.toISOString(),
      execution: { attempts: buildAttempts(baseA, "claude-3.5-sonnet") },
    });

    const baseB = hoursAgo(4);
    const attemptBStart = new Date(baseB.getTime() - 6 * 60 * 1000);
    const attemptBEnd = new Date(baseB.getTime() - 4 * 60 * 1000);
    await updateFrontmatter(taskBPath, {
      updated_at: baseB.toISOString(),
      last_activity_at: baseB.toISOString(),
      execution: {
        attempts: [
          {
            started_at: attemptBStart.toISOString(),
            ended_at: attemptBEnd.toISOString(),
            duration_seconds: Math.round((attemptBEnd.getTime() - attemptBStart.getTime()) / 1000),
            status: "completed",
            executor: { tool: "agent-beta", model: "gpt-4o" },
          },
        ],
      },
    });

    const baseC = hoursAgo(8);
    await updateFrontmatter(taskCPath, {
      updated_at: baseC.toISOString(),
      last_activity_at: baseC.toISOString(),
    });

    const storyBase = hoursAgo(12);
    await updateFrontmatter(storyPath, {
      updated_at: storyBase.toISOString(),
      last_activity_at: storyBase.toISOString(),
    });

    return {
      tempDir,
      storyId: storyPayload.id,
      taskAId: taskAPayload.id,
      taskBId: taskBPayload.id,
      taskCId: taskCPayload.id,
    };
  } catch (error) {
    await fs.remove(tempDir);
    throw error;
  }
}

describe("taskplain stats CLI", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("renders human-readable telemetry summary", async () => {
    const { tempDir } = await seedTelemetryWorkspace();
    try {
      const { stdout } = await execFileAsync("node", [cliPath, "stats", "--no-color"], {
        cwd: tempDir,
      });

      expect(stdout).toContain("Execution Stats");
      expect(stdout).toContain("telemetry: 2");
      expect(stdout).toContain("insufficient: 2");
      expect(stdout).toContain("Average work time per task");
      expect(stdout).toContain("Total work time");
      expect(stdout).toContain("Average attempts per task");
      expect(stdout).toContain("task-alpha");
      expect(stdout).toContain("task-beta");
      expect(stdout).toContain("Latest Executor");
      expect(stdout).not.toContain("Retries");
      expect(stdout).toContain("Tools: agent-alpha with claude-3.5-sonnet");
      expect(stdout).toContain("agent-beta with gpt-4o");
      expect(stdout).toContain("Insufficient telemetry for 2 task");
      expect(stdout).toContain("telemetry-story");
      expect(stdout).toContain("task-gamma");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("respects since and limit filters in JSON mode", async () => {
    const { tempDir } = await seedTelemetryWorkspace();
    try {
      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "stats", "--since", "1d", "--limit", "2", "--output", "json"],
        { cwd: tempDir },
      );
      const payload = JSON.parse(stdout) as {
        counts: { total_tasks: number; with_execution: number; insufficient_telemetry: number };
        tasks: Array<{ id: string }>;
        executors: Array<{ tool: string | null; model: string | null }>;
      };

      expect(payload.counts.total_tasks).toBe(2);
      expect(payload.counts.with_execution).toBe(2);
      expect(payload.counts.insufficient_telemetry).toBe(0);
      expect(payload.tasks.map((t) => t.id)).toEqual(["task-alpha", "task-beta"]);
      expect(
        payload.executors.map((entry) => `${entry.tool ?? "null"}/${entry.model ?? "null"}`),
      ).toEqual(["agent-alpha/claude-3.5-sonnet", "agent-beta/gpt-4o"]);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("walks descendants when --task is provided", async () => {
    const { tempDir, storyId } = await seedTelemetryWorkspace();
    try {
      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "stats", "--task", storyId, "--output", "json"],
        { cwd: tempDir },
      );
      const payload = JSON.parse(stdout) as {
        counts: { total_tasks: number; with_execution: number; insufficient_telemetry: number };
        tasks: Array<{ id: string }>;
        insufficient_telemetry_ids: string[];
      };

      expect(payload.counts.total_tasks).toBe(4);
      expect(payload.counts.with_execution).toBe(2);
      expect(payload.counts.insufficient_telemetry).toBe(2);
      expect(new Set(payload.tasks.map((t) => t.id))).toEqual(new Set(["task-alpha", "task-beta"]));
      expect(new Set(payload.insufficient_telemetry_ids)).toEqual(
        new Set(["telemetry-story", "task-gamma"]),
      );
    } finally {
      await fs.remove(tempDir);
    }
  });
});
