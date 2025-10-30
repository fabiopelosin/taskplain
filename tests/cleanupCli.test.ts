import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

async function createOldDoneTask(tempDir: string, title: string) {
  const { stdout } = await execFileAsync(
    "node",
    [cliPath, "new", "--title", title, "--kind", "task", "--state", "done", "--output", "json"],
    { cwd: tempDir },
  );
  const payload = JSON.parse(stdout) as { id: string; path: string };
  const filePath = path.join(tempDir, payload.path);
  const contents = await fs.readFile(filePath, "utf8");
  const stamp = "2024-01-01T00:00:00Z";
  const replaceMeta = (source: string, key: string, value: string) => {
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (!pattern.test(source)) {
      throw new Error(`Missing ${key} metadata in ${payload.path}`);
    }
    return source.replace(pattern, `${key}: ${value}`);
  };
  let next = replaceMeta(contents, "completed_at", stamp);
  next = replaceMeta(next, "updated_at", stamp);
  next = replaceMeta(next, "last_activity_at", stamp);
  await fs.writeFile(filePath, next, "utf8");
  return payload;
}

describe("taskplain cleanup CLI integration", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("removes old done tasks and reports cleaned IDs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-cleanup-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const task = await createOldDoneTask(tempDir, "Old Cleanup Target");

      const dryRun = await execFileAsync(
        "node",
        [cliPath, "cleanup", "--older-than", "30d", "--dry-run", "--output", "json"],
        { cwd: tempDir },
      );
      const dryRunPayload = JSON.parse(dryRun.stdout);
      expect(dryRunPayload.dryRun).toBe(true);
      expect(dryRunPayload.cleanedCount).toBe(1);
      expect(dryRunPayload.cleanedTasks).toContain(task.id);

      const run = await execFileAsync(
        "node",
        [cliPath, "cleanup", "--older-than", "30d", "--output", "json"],
        { cwd: tempDir },
      );
      const runPayload = JSON.parse(run.stdout);
      expect(runPayload.dryRun).toBe(false);
      expect(runPayload.cleanedCount).toBe(1);
      expect(runPayload.cleanedTasks).toContain(task.id);

      const taskPath = path.join(tempDir, task.path);
      expect(await fs.pathExists(taskPath)).toBe(false);
    } finally {
      await fs.remove(tempDir);
    }
  });
});
