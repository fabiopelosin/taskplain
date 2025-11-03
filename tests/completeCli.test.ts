import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

describe("taskplain complete CLI integration", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("auto-checks acceptance criteria when --check-acs is used", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      const { stdout } = await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--title",
          "CLI Acceptance Flag",
          "--kind",
          "task",
          "--state",
          "in-progress",
          "--output",
          "json",
        ],
        { cwd: tempDir },
      );

      const payload = JSON.parse(stdout) as { id: string; path: string };
      const taskPath = path.join(tempDir, payload.path);
      let contents = await fs.readFile(taskPath, "utf8");

      contents = contents.replace(
        "state: in-progress",
        `state: in-progress\ncommit_message: "feat(test): cli acceptance flag [Task:${payload.id}]"`,
      );
      contents = contents.replace(
        /## Acceptance Criteria[\s\S]*?## Technical Approach/,
        `## Acceptance Criteria\n\n- [ ] flips API flag\n- [x] logs audit event\n\n## Technical Approach`,
      );
      await fs.writeFile(taskPath, contents, "utf8");

      await execFileAsync("node", [cliPath, "complete", payload.id, "--check-acs"], {
        cwd: tempDir,
      });

      const doneDir = path.join(tempDir, "tasks/30-done");
      const entries = await fs.readdir(doneDir);
      expect(entries.length).toBe(1);
      const donePath = path.join(doneDir, entries[0] ?? "");
      const updated = await fs.readFile(donePath, "utf8");
      expect(updated).toContain("- [x] flips API flag");
      expect(updated).toContain("- [x] logs audit event");
      expect(updated).not.toContain("- [ ] flips API flag");
    } finally {
      await fs.remove(tempDir);
    }
  });
});
