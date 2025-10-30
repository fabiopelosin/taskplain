import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { beforeAll, describe, expect, it } from "vitest";

import { cliPath, ensureCliBuilt } from "./helpers/cliHarness";

const execFileAsync = promisify(execFile);

describe("taskplain new CLI", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("emits json payload when --output json is provided", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-new-cli-"));
    const title = "CLI Output Check";
    const { stdout } = await execFileAsync(
      "node",
      [cliPath, "new", "--title", title, "--output", "json"],
      { cwd: tempDir },
    );

    const payload = JSON.parse(stdout);
    expect(payload.id).toBe("cli-output-check");
    expect(payload.path.startsWith("tasks/")).toBe(true);
    expect(payload.meta.title).toBe(title);
    expect(payload.meta.kind).toBe("task");

    const createdFile = path.join(tempDir, payload.path);
    const exists = await fs.pathExists(createdFile);
    expect(exists).toBe(true);
    const contents = await fs.readFile(createdFile, "utf8");
    expect(contents).toContain(title);
  });

  it("infers child kinds when --kind is omitted", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-new-infer-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Parent Epic", "--kind", "epic", "--output", "json"],
        { cwd: tempDir },
      );

      const story = await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Child Story", "--parent", "parent-epic", "--output", "json"],
        { cwd: tempDir },
      );
      const storyPayload = JSON.parse(story.stdout);
      expect(storyPayload.meta.kind).toBe("story");

      const task = await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Grand Task", "--parent", "child-story", "--output", "json"],
        { cwd: tempDir },
      );
      const taskPayload = JSON.parse(task.stdout);
      expect(taskPayload.meta.kind).toBe("task");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("asks for explicit kind when the parent is a task", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-new-grandchild-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      await execFileAsync("node", [cliPath, "new", "--title", "Root Epic", "--kind", "epic"], {
        cwd: tempDir,
      });
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Story Node", "--parent", "root-epic"],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Leaf Task", "--parent", "story-node"],
        { cwd: tempDir },
      );

      await expect(
        execFileAsync("node", [cliPath, "new", "--title", "Too Deep", "--parent", "leaf-task"], {
          cwd: tempDir,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Cannot infer kind: parent 'leaf-task' is a task"),
      });
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("renders open tree with ids and paths", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-tree-open-"));
    try {
      await execFileAsync("node", [cliPath, "init", "--sample"], {
        cwd: tempDir,
      });
      const human = await execFileAsync(
        "node",
        [
          cliPath,
          "tree",
          "--open",
          "--show-id",
          "--show-path",
          "--relative-path",
          "--compact",
          "--no-color",
        ],
        { cwd: tempDir },
      );
      expect(human.stdout).toContain("(id: ");
      expect(human.stdout).toContain("./tasks/");
      expect(human.stdout).not.toContain("path:");
      expect(human.stdout.includes("\u001b[")).toBe(false);
      expect(human.stdout).not.toContain("\n\n");

      const json = await execFileAsync("node", [cliPath, "tree", "--open", "--output", "json"], {
        cwd: tempDir,
      });
      const payload = JSON.parse(json.stdout);
      expect(Array.isArray(payload.states) && payload.states.length > 0).toBe(true);
      const firstState = payload.states[0];
      const candidate =
        firstState.by_epic[0]?.epic ??
        firstState.by_epic[0]?.children[0]?.story ??
        firstState.by_epic[0]?.children[0]?.tasks[0] ??
        firstState.ungrouped.stories[0] ??
        firstState.ungrouped.tasks[0];
      expect(candidate).toBeDefined();
      expect(typeof candidate.path).toBe("string");
      const keys = Object.keys(candidate);
      expect(keys.slice(0, 7)).toEqual([
        "id",
        "kind",
        "state",
        "priority",
        "title",
        "path",
        "updated_at",
      ]);
      if ("parent" in candidate) {
        expect(keys).toContain("parent");
      }
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("renders streamlined columns for taskplain list", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-list-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init", "--sample"], {
        cwd: tempDir,
      });
      const { stdout } = await execFileAsync("node", [cliPath, "list", "--state", "ready"], {
        cwd: tempDir,
      });

      expect(stdout).toContain("ID");
      expect(stdout).toContain("TITLE");
      expect(stdout).toContain("KIND");
      expect(stdout).toContain("STATE");
      expect(stdout).toContain("PRIO");
      expect(stdout).not.toContain("SIZE");
      expect(stdout).not.toContain("AMB");
      expect(stdout).not.toContain("EXEC");
      expect(stdout).not.toContain("ISO");
      expect(stdout).not.toContain("PARENT");
      expect(stdout).not.toContain("ASSIGNEES");
      expect(stdout).not.toContain("UPDATED");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("supports metadata patches and section replacements via update", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-update-cli-"));
    const title = "Update Target Story";
    await execFileAsync("node", [cliPath, "new", "--title", title, "--kind", "story"], {
      cwd: tempDir,
    });

    const overviewPath = path.join(tempDir, "overview.md");
    await fs.writeFile(overviewPath, "Updated overview via file", "utf8");

    const { stdout } = await execFileAsync(
      "node",
      [
        cliPath,
        "update",
        "update-target-story",
        "--meta",
        "priority=high",
        "--field",
        "overview",
        "@overview.md",
        "--output",
        "json",
      ],
      { cwd: tempDir },
    );

    const payload = JSON.parse(stdout);
    expect(payload.meta.priority).toBe("high");
    expect(payload.sectionChanges.some((entry: { id: string }) => entry.id === "overview")).toBe(
      true,
    );

    const targetPath = payload.to ?? "";
    const expectedRelative = "tasks/00-idea/story-update-target-story.md";
    const updatedFile = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(tempDir, targetPath || expectedRelative);
    const fileContents = await fs.readFile(updatedFile, "utf8");
    expect(fileContents).toContain("Updated overview");
  });

  it("reports changed_state and no_op in complete JSON output", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-json-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      await execFileAsync("node", [cliPath, "new", "--title", "Complete Flow", "--kind", "task"], {
        cwd: tempDir,
      });

      const first = await execFileAsync(
        "node",
        [cliPath, "complete", "complete-flow", "--output", "json"],
        { cwd: tempDir },
      );
      const payloadFirst = JSON.parse(first.stdout);
      expect(payloadFirst.changed_state).toBe(true);
      expect(payloadFirst.no_op).toBe(false);

      const second = await execFileAsync(
        "node",
        [cliPath, "complete", "complete-flow", "--output", "json"],
        { cwd: tempDir },
      );
      const payloadSecond = JSON.parse(second.stdout);
      expect(payloadSecond.changed_state).toBe(false);
      expect(payloadSecond.no_op).toBe(true);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("rejects deprecated --commit integration", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-complete-commit-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Deprecated Commit", "--kind", "task"],
        { cwd: tempDir },
      );

      let error: unknown;
      try {
        await execFileAsync(
          "node",
          [cliPath, "complete", "deprecated-commit", "--commit", "legacy"],
          { cwd: tempDir },
        );
      } catch (err) {
        error = err;
      }

      expect(error && typeof error === "object").toBe(true);
      const execError = error as { code?: number; stderr?: string };
      expect(execError.code).toBe(5);
      expect(execError.stderr ?? "").toContain("conventional commits");
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("renames mismatched task files with fix --rename-files", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-fix-rename-"));
    try {
      await execFileAsync("node", [cliPath, "new", "--title", "Rename CLI", "--kind", "story"], {
        cwd: tempDir,
      });

      const expectedRelative = "tasks/00-idea/story-rename-cli.md";
      const expectedPath = path.join(tempDir, expectedRelative);
      const wrongPath = path.join(tempDir, "tasks/00-idea/rename-cli.md");
      await fs.move(expectedPath, wrongPath);

      const original = await fs.readFile(wrongPath, "utf8");
      const normalized = original.replace(
        /## Acceptance Criteria[\s\S]*?## Technical Approach/,
        "## Acceptance Criteria\n\n- [ ] Renames mismatched task filenames during validation fix\n- [ ] Leaves tasks ready for agents after cleanup\n\n## Technical Approach",
      );
      await fs.writeFile(wrongPath, normalized, "utf8");

      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "validate", "--fix", "--rename-files", "--output", "json"],
        { cwd: tempDir },
      );

      const lines = stdout
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      const payload = JSON.parse(lines[0]);
      expect(payload.rename.renamed).toBe(1);
      expect(payload.rename.failed).toBe(0);

      const renamedExists = await fs.pathExists(expectedPath);
      expect(renamedExists).toBe(true);
      const oldExists = await fs.pathExists(wrongPath);
      expect(oldExists).toBe(false);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("surfaces rename conflicts in fix output", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-fix-rename-conflict-"));
    try {
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Rename Conflict CLI", "--kind", "story"],
        {
          cwd: tempDir,
        },
      );

      const expectedRelative = "tasks/00-idea/story-rename-conflict-cli.md";
      const expectedPath = path.join(tempDir, expectedRelative);
      const wrongPath = path.join(tempDir, "tasks/00-idea/rename-conflict-cli.md");
      await fs.move(expectedPath, wrongPath);
      await fs.writeFile(expectedPath, "placeholder", "utf8");

      let error: unknown;
      try {
        await execFileAsync(
          "node",
          [cliPath, "validate", "--fix", "--rename-files", "--output", "json"],
          { cwd: tempDir },
        );
      } catch (err) {
        error = err;
      }

      expect(error && typeof error === "object").toBe(true);
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      expect(execError.code).not.toBe(0);
      const lines = (execError.stdout ?? "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      const payload = JSON.parse(lines[0]);
      expect(payload.rename.failed).toBe(1);
      expect(payload.rename.errors[0].reason).toBe("target already exists");

      const expectedStillExists = await fs.pathExists(expectedPath);
      expect(expectedStillExists).toBe(true);
      const wrongStillExists = await fs.pathExists(wrongPath);
      expect(wrongStillExists).toBe(true);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("adopts children and deletes tasks through CLI commands", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-adopt-delete-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });

      const epicPayload = JSON.parse(
        (
          await execFileAsync(
            "node",
            [cliPath, "new", "--title", "CLI Epic", "--kind", "epic", "--output", "json"],
            { cwd: tempDir },
          )
        ).stdout,
      );

      const existingStory = JSON.parse(
        (
          await execFileAsync(
            "node",
            [
              cliPath,
              "new",
              "--title",
              "Existing Story",
              "--kind",
              "story",
              "--parent",
              epicPayload.id,
              "--output",
              "json",
            ],
            { cwd: tempDir },
          )
        ).stdout,
      );

      const orphanStory = JSON.parse(
        (
          await execFileAsync(
            "node",
            [cliPath, "new", "--title", "Orphan Story", "--kind", "story", "--output", "json"],
            { cwd: tempDir },
          )
        ).stdout,
      );

      const adoptPayload = JSON.parse(
        (
          await execFileAsync(
            "node",
            [cliPath, "adopt", epicPayload.id, orphanStory.id, "--output", "json"],
            { cwd: tempDir },
          )
        ).stdout,
      );

      expect(adoptPayload.changed).toBe(true);
      expect(adoptPayload.parent.id).toBe(epicPayload.id);
      const epicFile = path.join(tempDir, epicPayload.path);
      const epicContents = await fs.readFile(epicFile, "utf8");
      expect(epicContents).toContain(`- ${existingStory.id}`);
      expect(epicContents).toContain(`- ${orphanStory.id}`);

      const keepTask = JSON.parse(
        (
          await execFileAsync(
            "node",
            [
              cliPath,
              "new",
              "--title",
              "Keep Task",
              "--kind",
              "task",
              "--parent",
              existingStory.id,
              "--output",
              "json",
            ],
            { cwd: tempDir },
          )
        ).stdout,
      );

      const removeTask = JSON.parse(
        (
          await execFileAsync(
            "node",
            [
              cliPath,
              "new",
              "--title",
              "Remove Task",
              "--kind",
              "task",
              "--parent",
              existingStory.id,
              "--output",
              "json",
            ],
            { cwd: tempDir },
          )
        ).stdout,
      );

      const deletePayload = JSON.parse(
        (
          await execFileAsync("node", [cliPath, "delete", removeTask.id, "--output", "json"], {
            cwd: tempDir,
          })
        ).stdout,
      );

      expect(deletePayload.deleted).toBe(true);
      expect(deletePayload.parent_updates[0].next).toEqual([keepTask.id]);

      const removedExists = await fs.pathExists(path.join(tempDir, removeTask.path));
      expect(removedExists).toBe(false);

      const storyFile = path.join(tempDir, existingStory.path);
      const storyContents = await fs.readFile(storyFile, "utf8");
      expect(storyContents).toContain(`- ${keepTask.id}`);
      expect(storyContents).not.toContain(`- ${removeTask.id}`);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("emits cascade details in move JSON output", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-move-cascade-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });

      await execFileAsync(
        "node",
        [cliPath, "new", "--kind", "epic", "--title", "Epic Root", "--state", "ready"],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--kind",
          "story",
          "--title",
          "Idea Story",
          "--parent",
          "epic-root",
          "--state",
          "idea",
        ],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--kind",
          "story",
          "--title",
          "Ready Story",
          "--parent",
          "epic-root",
          "--state",
          "ready",
        ],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--kind",
          "story",
          "--title",
          "Done Story",
          "--parent",
          "epic-root",
          "--state",
          "done",
        ],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--kind",
          "task",
          "--title",
          "Idea Task",
          "--parent",
          "idea-story",
          "--state",
          "idea",
        ],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [
          cliPath,
          "new",
          "--kind",
          "task",
          "--title",
          "Active Task",
          "--parent",
          "idea-story",
          "--state",
          "in-progress",
        ],
        { cwd: tempDir },
      );

      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "move", "epic-root", "in-progress", "--cascade", "ready", "--output", "json"],
        { cwd: tempDir },
      );

      const payload = JSON.parse(stdout);
      expect(payload.cascade).toBe("ready");
      expect(payload.parent_move.changed).toBe(true);
      expect(payload.parent_move.from).toBe("ready");
      expect(payload.parent_move.to).toBe("in-progress");
      expect(payload.children).toHaveLength(5);

      const childById = new Map(payload.children.map((child: { id: string }) => [child.id, child]));
      expect(childById.get("idea-story")).toMatchObject({
        changed: true,
        reason: "cascade:ready",
        from: "idea",
        to: "ready",
      });
      expect(childById.get("done-story")).toMatchObject({
        skipped: true,
        reason: "terminal_state",
      });
      expect(childById.get("ready-story")).toMatchObject({
        skipped: true,
        reason: "already_target_state",
      });
      expect(childById.get("idea-task")).toMatchObject({
        changed: true,
        reason: "cascade:ready",
        from: "idea",
        to: "ready",
      });
      expect(childById.get("active-task")).toMatchObject({
        skipped: true,
        reason: "state_excluded",
      });
    } finally {
      await fs.remove(tempDir);
    }
  });

  it("pickup command emits JSON context with ancestor and child data", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-pickup-cli-"));
    try {
      await execFileAsync("node", [cliPath, "init"], { cwd: tempDir });
      await execFileAsync("node", [cliPath, "new", "--title", "Pickup Epic", "--kind", "epic"], {
        cwd: tempDir,
      });
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Pickup Story", "--kind", "story", "--parent", "pickup-epic"],
        { cwd: tempDir },
      );
      await execFileAsync(
        "node",
        [cliPath, "new", "--title", "Pickup Child", "--kind", "task", "--parent", "pickup-story"],
        { cwd: tempDir },
      );

      const { stdout } = await execFileAsync(
        "node",
        [cliPath, "pickup", "pickup-story", "--dry-run", "--output", "json"],
        { cwd: tempDir },
      );

      const payload = JSON.parse(stdout);
      expect(payload.id).toBe("pickup-story");
      expect(payload.dry_run).toBe(true);
      expect(payload.context.target.meta.state).toBe("in-progress");
      expect(Array.isArray(payload.context.ancestors)).toBe(true);
      expect(payload.context.ancestors.length).toBeGreaterThan(0);
      const candidateIds = payload.context.children.candidates.map(
        (candidate: { id: string }) => candidate.id,
      );
      expect(candidateIds.length).toBe(0);
      const notReadyIds = payload.context.children.not_ready.map(
        (entry: { id: string }) => entry.id,
      );
      expect(notReadyIds).toContain("pickup-child");
      const notReadyEntry = payload.context.children.not_ready.find(
        (entry: { id: string }) => entry.id === "pickup-child",
      );
      expect(notReadyEntry?.reason).toBe("state=idea");
    } finally {
      await fs.remove(tempDir);
    }
  });
});
