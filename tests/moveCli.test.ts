import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

describe("taskplain move CLI integration", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("renames files and updates metadata without git available", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-fs-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Filesystem Move",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );

      const createPayload = JSON.parse(createJson);
      const originalPath = path.join(tempDir, createPayload.path);

      const { stdout: moveJson } = await execFileAsync(
        "node",
        [cliPath, "move", createPayload.id, "in-progress", "--output", "json"],
        { cwd: tempDir },
      );
      const movePayload = JSON.parse(moveJson);
      expect(movePayload.parent_move.from).toBe("ready");
      expect(movePayload.parent_move.to).toBe("in-progress");
      expect(movePayload.dryRun).toBe(false);

      const movedPath = path.join(tempDir, movePayload.parent_move.to_path);
      expect(await fs.pathExists(movedPath)).toBe(true);
      expect(await fs.pathExists(originalPath)).toBe(false);

      const movedContents = await fs.readFile(movedPath, "utf8");
      expect(movedContents).toContain("state: in-progress");

      const { stdout: dryRunJson } = await execFileAsync(
        "node",
        [cliPath, "move", createPayload.id, "done", "--dry-run", "--output", "json"],
        { cwd: tempDir },
      );
      const dryRunPayload = JSON.parse(dryRunJson);
      expect(dryRunPayload.dryRun).toBe(true);
      expect(dryRunPayload.parent_move.from).toBe("in-progress");
      expect(dryRunPayload.parent_move.to).toBe("done");

      const dryRunHuman = await execFileAsync(
        "node",
        [cliPath, "move", createPayload.id, "done", "--dry-run"],
        { cwd: tempDir },
      );
      expect(dryRunHuman.stdout.trim()).toContain("IN-PROGRESS -> DONE");

      const predictedDonePath = path.join(tempDir, dryRunPayload.parent_move.to_path);
      expect(await fs.pathExists(predictedDonePath)).toBe(false);

      const finalContents = await fs.readFile(movedPath, "utf8");
      expect(finalContents).toContain("state: in-progress");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("uses git mv when files are tracked", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-git-"));
    try {
      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "Taskplain Bot"], {
        cwd: tempDir,
      });
      await execFileAsync("git", ["config", "user.email", "taskplain@example.com"], {
        cwd: tempDir,
      });

      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Tracked Move",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );
      const createPayload = JSON.parse(createJson);

      await execFileAsync("git", ["add", "."], { cwd: tempDir });
      await execFileAsync("git", ["commit", "-m", "seed task"], {
        cwd: tempDir,
      });

      const { stdout: moveJson } = await execFileAsync(
        "node",
        [cliPath, "move", createPayload.id, "in-progress", "--output", "json"],
        { cwd: tempDir },
      );
      const movePayload = JSON.parse(moveJson);
      expect(movePayload.parent_move.changed).toBe(true);

      const status = await execFileAsync("git", ["status", "--short"], {
        cwd: tempDir,
      });
      const renameSummary = `${createPayload.path} -> ${movePayload.parent_move.to_path}`;
      expect(status.stdout).toContain(renameSummary);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("falls back to filesystem move when git mv fails for untracked files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-fallback-"));
    try {
      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "Taskplain Bot"], {
        cwd: tempDir,
      });
      await execFileAsync("git", ["config", "user.email", "taskplain@example.com"], {
        cwd: tempDir,
      });

      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout: createJson } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "Fallback Move",
          "--kind",
          "task",
          "--state",
          "ready",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );
      const createPayload = JSON.parse(createJson);

      const { stdout: moveJson } = await execFileAsync(
        "node",
        [cliPath, "move", createPayload.id, "in-progress", "--output", "json"],
        { cwd: tempDir },
      );
      const movePayload = JSON.parse(moveJson);

      const movedPath = path.join(tempDir, movePayload.parent_move.to_path);
      expect(await fs.pathExists(movedPath)).toBe(true);

      const status = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], {
        cwd: tempDir,
      });
      expect(status.stdout).toContain(movePayload.parent_move.to_path);
      expect(status.stdout).not.toContain(createPayload.path);
    } finally {
      await fs.remove(tempDir);
    }
  });
});

describe("taskplain set CLI behavior", () => {
  it("guides users to update command and exits with code 5", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-set-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      let exitCode: number | undefined;
      let stderr = "";
      try {
        await execFileAsync("node", [cliPath, "set", "example", "state=ready"], {
          cwd: tempDir,
        });
      } catch (error) {
        const execError = error as { code?: number; stderr?: string };
        exitCode = execError.code;
        stderr = execError.stderr ?? "";
      }

      expect(exitCode).toBe(5);
      expect(stderr).toContain("'set' is removed");
      expect(stderr).toContain("taskplain update <id> --meta key=value");
    } finally {
      await fs.remove(tempDir);
    }
  });
});
