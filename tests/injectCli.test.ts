import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

describe("taskplain inject CLI", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("updates the managed snippet and optionally prints it to stdout", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-inject-cli-"));
    try {
      const first = await execFileAsync("node", [cliPath, "inject", "AGENTS.md"], { cwd: tempDir });
      expect(first.stdout).toContain("Snippet updated.");
      const targetPath = path.join(tempDir, "AGENTS.md");
      const contents = await fs.readFile(targetPath, "utf8");
      expect(contents).toContain("<!-- taskplain:start");
      expect(contents).toContain("<!-- taskplain:end -->");

      const second = await execFileAsync("node", [cliPath, "inject", "AGENTS.md", "--stdout"], {
        cwd: tempDir,
      });
      expect(second.stdout).toContain("Snippet already up to date.");
      expect(second.stdout.split("\n").some((line) => line.includes("taskplain pickup"))).toBe(
        true,
      );
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("checks snippet freshness without modifying files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-inject-check-"));
    try {
      await execFileAsync("node", [cliPath, "inject", "AGENTS.md"], {
        cwd: tempDir,
      });
      const success = await execFileAsync("node", [cliPath, "inject", "AGENTS.md", "--check"], {
        cwd: tempDir,
      });
      expect(success.stdout).toMatch(/Snippet is current/);

      // Introduce drift inside the managed block and ensure --check surfaces it.
      const snippetPath = path.join(tempDir, "AGENTS.md");
      const contents = await fs.readFile(snippetPath, "utf8");
      const mutated = contents.replace("Taskplain CLI", "Taskplain CLI (stale)");
      expect(mutated).not.toBe(contents);
      await fs.writeFile(snippetPath, mutated, "utf8");
      try {
        await execFileAsync("node", [cliPath, "inject", "AGENTS.md", "--check"], { cwd: tempDir });
        throw new Error("Expected --check to fail for stale snippet");
      } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        expect(failure.code).toBe(4);
        expect(failure.stderr ?? "").toContain("Snippet is stale");
      }
    } finally {
      await fs.remove(tempDir);
    }
  });
});
