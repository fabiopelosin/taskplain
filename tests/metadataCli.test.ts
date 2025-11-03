import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { META_KEY_ORDER } from "../src/adapters/taskFile";
import type { TaskMeta } from "../src/domain/types";
import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

describe("taskplain metadata CLI", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("returns ordered metadata with defaulted empties", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-metadata-get-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Metadata Get Demo",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );

      const created = JSON.parse(createJson) as { id: string; meta: TaskMeta };
      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "metadata", "get", created.id, "--output", "json"],
        { cwd: tempDir },
      );

      const payload = JSON.parse(stdout) as {
        id: string;
        meta: Record<string, unknown>;
      };

      expect(payload.id).toBe(created.id);
      expect(Object.keys(payload.meta)).toEqual(META_KEY_ORDER);
      expect(payload.meta.parent).toBeNull();
      expect(payload.meta.children).toEqual([]);
      expect(payload.meta.assignees).toEqual([]);
      expect(payload.meta.labels).toEqual([]);
      expect(payload.meta.links).toEqual([]);
      expect(payload.meta.touches).toEqual([]);
      expect(payload.meta.depends_on).toEqual([]);
      expect(payload.meta.blocks).toEqual([]);
      expect(payload.meta.execution).toBeNull();
      expect(typeof payload.meta.created_at).toBe("string");
      expect(payload.meta.size).toBe(created.meta.size);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("applies partial metadata patches and supports unsetting fields", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-metadata-set-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Metadata Set Demo",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );

      const created = JSON.parse(createJson) as { id: string; path: string };

      const patchPath = path.join(tempDir, "metadata-patch.json");
      await fs.writeFile(
        patchPath,
        JSON.stringify({ priority: "high", touches: ["src/app.ts"] }),
        "utf8",
      );

      const { stdout: setJson } = await execFileAsync(
        "bash",
        [
          "-lc",
          `cat metadata-patch.json | node "${cliPath}" metadata set ${created.id} --output json`,
        ],
        { cwd: tempDir },
      );

      const setResult = JSON.parse(setJson) as {
        meta: Record<string, unknown>;
        metaChanges: string[];
        changed: boolean;
      };

      expect(setResult.changed).toBe(true);
      expect(setResult.meta.priority).toBe("high");
      expect(setResult.meta.touches).toEqual(["src/app.ts"]);
      expect(setResult.metaChanges).toEqual(expect.arrayContaining(["priority", "touches"]));

      const taskPath = path.join(tempDir, created.path);
      const contents = await fs.readFile(taskPath, "utf8");
      expect(contents).toContain("priority: high");
      expect(contents).toContain("touches:");

      const unsetPath = path.join(tempDir, "metadata-unset.json");
      await fs.writeFile(unsetPath, JSON.stringify({ touches: null }), "utf8");

      const { stdout: unsetJson } = await execFileAsync(
        "bash",
        [
          "-lc",
          `cat metadata-unset.json | node "${cliPath}" metadata set ${created.id} --output json`,
        ],
        { cwd: tempDir },
      );

      const unsetResult = JSON.parse(unsetJson) as { metaChanges: string[] };
      expect(unsetResult.metaChanges).toEqual(expect.arrayContaining(["touches"]));

      const updatedContents = await fs.readFile(taskPath, "utf8");
      expect(updatedContents).not.toContain("touches:");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("validates unknown metadata keys with a clear error", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-metadata-invalid-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Metadata Invalid Demo",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );

      const created = JSON.parse(createJson) as { id: string };

      let caught: unknown;
      const invalidPath = path.join(tempDir, "metadata-invalid.json");
      await fs.writeFile(invalidPath, JSON.stringify({ unknown: "value" }), "utf8");

      try {
        await execFileAsync(
          "bash",
          ["-lc", `cat metadata-invalid.json | node "${cliPath}" metadata set ${created.id}`],
          { cwd: tempDir },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      const err = caught as { stderr?: string; code?: number };
      expect(err.code).toBe(1);
      expect(err.stderr ?? "").toContain("Unknown metadata key");
    } finally {
      await fs.remove(tempDir);
    }
  });
});
