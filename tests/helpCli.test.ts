import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt, repoRoot } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);
const ESC = "\u001B";

describe("taskplain help output", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("shows command groups once on root help", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--help"], {
      cwd: repoRoot,
    });
    expect(stdout.includes("Command Groups")).toBe(true);
    expect((stdout.match(/Command Groups/g) ?? []).length).toBe(1);
    expect(stdout).not.toContain("Commands:\n");
  });

  it("explains documentation flags in taskplain help", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "--color", "never", "help"], {
      cwd: repoRoot,
    });
    expect(stdout).toContain("--playbook");
    expect(stdout).toContain("--reference");
    expect(stdout).toContain("--contract");
    expect(stdout).toContain("--snippet");
  });

  it("omits command groups on subcommand help", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "new", "--help"], {
      cwd: repoRoot,
    });
    expect(stdout).not.toContain("Command Groups");
  });

  it("dumps aggregated help via help --reference and honors separators", async () => {
    const stripAnsi = (value: string): string => {
      let result = "";
      for (let i = 0; i < value.length; i += 1) {
        if (value[i] === ESC) {
          let j = i + 1;
          if (j < value.length && value[j] === "[") {
            j += 1;
            while (j < value.length) {
              const ch = value[j];
              if ((ch >= "0" && ch <= "9") || ch === ";") {
                j += 1;
                continue;
              }
              break;
            }
            if (j < value.length && value[j] === "m") {
              i = j;
              continue;
            }
          }
        }
        result += value[i];
      }
      return result;
    };
    const [{ stdout: dump }, { stdout: newHelp }, { stdout: listHelp }] = await Promise.all([
      execFileAsync("node", [cliPath, "--color", "never", "help", "--reference"], {
        cwd: repoRoot,
      }),
      execFileAsync("node", [cliPath, "new", "--help"], { cwd: repoRoot }),
      execFileAsync("node", [cliPath, "list", "--help"], { cwd: repoRoot }),
    ]);

    const plainDump = stripAnsi(dump);
    expect(plainDump).toContain("Usage: taskplain [options] [command]");
    expect(plainDump).toContain(stripAnsi(newHelp.trim()));
    expect(plainDump).toContain(stripAnsi(listHelp.trim()));
    expect(plainDump).toContain("Usage: taskplain cleanup");
    expect(plainDump).toMatch(/\n-+\n\nUsage: taskplain new/);
    expect(plainDump).not.toContain("Usage: taskplain archive");
  });

  it("emits JSON when help --contract is invoked", async () => {
    const { stdout } = await execFileAsync("node", [cliPath, "help", "--contract"], {
      cwd: repoRoot,
    });
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("commands");
    expect(parsed.commands.some((cmd: { name: string }) => cmd.name === "help")).toBe(true);
  });
});
