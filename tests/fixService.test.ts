import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterAll, describe, expect, it } from "vitest";
import type { GitAdapter } from "../src/adapters/gitAdapter";
import { writeTaskFile } from "../src/adapters/taskFile";
import { stateDir } from "../src/domain/paths";
import { postImplementationInsightsScaffold } from "../src/domain/types";
import { FixService } from "../src/services/fixService";
import { TaskService } from "../src/services/taskService";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-fix-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.remove(dir)));
});

describe("FixService", () => {
  it("normalizes front matter ordering", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Out of order",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const manualFrontMatter = [
      "---",
      `title: ${created.meta.title}`,
      `id: ${created.meta.id}`,
      `kind: ${created.meta.kind}`,
      "children: []",
      `priority: ${created.meta.priority}`,
      `state: ${created.meta.state}`,
      `created_at: ${created.meta.created_at}`,
      `updated_at: ${created.meta.updated_at}`,
      "completed_at: null",
      "links: []",
      `last_activity_at: ${created.meta.last_activity_at}`,
      "---",
      "",
      created.body,
    ].join("\n");
    await fs.writeFile(created.path, `${manualFrontMatter}\n`, "utf8");

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    expect(summary.items).toHaveLength(1);
    const result = summary.items[0];
    expect(result.changed).toBe(true);
    expect(result.changes).toContain("normalized front matter order");

    const updated = await fs.readFile(created.path, "utf8");
    const frontMatterMatch = updated.match(/^---\n([\s\S]*?)\n---/);
    expect(frontMatterMatch).toBeTruthy();
    const keys = frontMatterMatch?.[1]
      .trim()
      .split("\n")
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual([
      "id",
      "title",
      "kind",
      "children",
      "state",
      "priority",
      "size",
      "ambiguity",
      "executor",
      "isolation",
      "created_at",
      "updated_at",
      "completed_at",
      "links",
      "last_activity_at",
    ]);
  });

  it("adds missing required headings", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Missing heading",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const trimmedBody = created.body.replace(/\n## Technical Approach\s*\n/, "\n");
    await writeTaskFile(created.path, { ...created, body: trimmedBody });

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    const result = summary.items[0];
    expect(result.changed).toBe(true);
    expect(result.changes).toContain("added heading ## Technical Approach");

    const repaired = await taskService.getTask(created.path);
    expect(repaired.body).toContain("## Technical Approach");
  });

  it("updates legacy Post-Implementation Insights comment to scaffold", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Legacy insights comment",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const legacyComment = [
      "<!--",
      "## Post-Implementation Insights",
      "",
      "### Changelog",
      "Required: Summarize shipped behavior.",
      "",
      "### Decisions",
      "Optional: Record key choices.",
      "",
      "### Architecture",
      "Optional: Outline structural updates.",
      "-->",
    ].join("\n");

    const legacyBody = created.body.replace(
      /\n## Post-Implementation Insights[\s\S]*$/m,
      `\n${legacyComment}\n`,
    );
    await writeTaskFile(created.path, { ...created, body: legacyBody });

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    const result = summary.items[0];
    expect(result.changed).toBe(true);

    const repaired = await taskService.getTask(created.path);
    expect(repaired.body).toContain(postImplementationInsightsScaffold);
    expect(repaired.body).not.toContain("<!--");
  });

  it("leaves acceptance criteria instructions as comments rather than empty checkboxes", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Instructional comments",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    // Add actual checkboxes to the acceptance criteria section
    const mutatedBody = created.body.replace(
      /## Acceptance Criteria\s*\n\n<!--[\s\S]*?-->/,
      "## Acceptance Criteria\n\nRenames mismatched task filenames during validation fix\nLeaves tasks ready for agents after cleanup",
    );
    await writeTaskFile(created.path, { ...created, body: mutatedBody });

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    const result = summary.items[0];
    expect(result.changed).toBe(true);
    expect(result.changes).toContain("seeded acceptance criteria checklist");

    const repaired = await taskService.getTask(created.path);
    const sectionMatch = repaired.body.match(
      /## Acceptance Criteria([\s\S]*?)## Technical Approach/,
    );
    expect(sectionMatch).toBeTruthy();
    const acceptanceSection = sectionMatch?.[1] ?? "";
    expect(acceptanceSection).toContain(
      "- [ ] Renames mismatched task filenames during validation fix",
    );
    expect(acceptanceSection).toContain("- [ ] Leaves tasks ready for agents after cleanup");
    expect(acceptanceSection).not.toContain("<!--");
  });

  it("adds Post-Implementation Insights heading for done tasks missing it", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Done without insights",
      kind: "task",
      state: "idea",
      priority: "normal",
    });

    const doneDate = created.meta.updated_at.slice(0, 10);
    const donePath = path.join(
      repoRoot,
      stateDir("done"),
      `${doneDate} ${created.meta.kind}-${created.meta.id}.md`,
    );
    await fs.ensureDir(path.dirname(donePath));
    const strippedBody = created.body.replace(/\n## Post-Implementation Insights[\s\S]*$/m, "\n");
    const doneDoc = {
      ...created,
      meta: {
        ...created.meta,
        state: "done" as const,
        completed_at: created.meta.updated_at,
        commit_message: `chore(fix): ensure insights heading [Task:${created.meta.id}]`,
      },
      path: donePath,
      body: strippedBody,
    };

    await fs.remove(created.path);
    await writeTaskFile(donePath, doneDoc);

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    const result = summary.items[0];
    expect(result.changed).toBe(true);
    expect(result.changes).toContain("added heading ## Post-Implementation Insights");

    const repaired = await taskService.getTask(donePath);
    expect(repaired.body).toContain("## Post-Implementation Insights");
  });

  it("synchronizes stale timestamps", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Stale timestamps",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const staleDoc = {
      ...created,
      meta: {
        ...created.meta,
        updated_at: "2024-01-01T00:00:00.000Z",
        last_activity_at: "2024-01-01T00:00:00.000Z",
      },
    };
    await writeTaskFile(created.path, staleDoc);

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixIds([created.meta.id]);
    const result = summary.items[0];
    expect(result.changes).toContain("synchronized timestamps");

    const repaired = await taskService.getTask(created.path);
    expect(repaired.meta.updated_at).not.toBe("2024-01-01T00:00:00.000Z");
    expect(repaired.meta.last_activity_at).toBe(repaired.meta.updated_at);
  });

  it("is idempotent when files are already normalized", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Idempotent story",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const fixer = new FixService({ repoRoot, taskService });
    await fixer.fixIds([created.meta.id]);

    const secondPass = await fixer.fixIds([created.meta.id]);
    expect(secondPass.items).toHaveLength(1);
    expect(secondPass.items[0].changed).toBe(false);
    expect(secondPass.items[0].changes).toHaveLength(0);
  });

  it("synchronizes stale timestamps even when git reports no changes", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Git-stable timestamps",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const frozenTimestamp = "2024-01-01T00:00:00.000Z";
    const staleDoc = {
      ...created,
      meta: {
        ...created.meta,
        updated_at: frozenTimestamp,
        last_activity_at: frozenTimestamp,
      },
    };
    await writeTaskFile(created.path, staleDoc);

    const fakeGit = {
      listChangedFiles: async () => new Set<string>(),
    } as unknown as GitAdapter;

    const fixer = new FixService({ repoRoot, taskService, git: fakeGit });
    const summary = await fixer.fixAll();
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0].changed).toBe(true);
    expect(summary.items[0].changes).toContain("synchronized timestamps");

    const reloaded = await taskService.getTask(created.path);
    expect(reloaded.meta.updated_at).not.toBe(frozenTimestamp);
    expect(reloaded.meta.last_activity_at).not.toBe(frozenTimestamp);
  });

  it("renames mismatched filenames when enabled", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Needs rename",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const expectedPath = created.path;
    const dir = path.dirname(expectedPath);
    const wrongPath = path.join(dir, "needs-rename.md");
    await fs.move(expectedPath, wrongPath);

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixAll({ renameFiles: true });

    expect(summary.items).toHaveLength(1);
    const result = summary.items[0];
    expect(result.rename?.ok).toBe(true);
    expect(result.path).toBe(expectedPath);
    expect(result.changes.some((entry) => entry.includes("renamed file to"))).toBe(true);

    const renamedExists = await fs.pathExists(expectedPath);
    expect(renamedExists).toBe(true);
    const oldExists = await fs.pathExists(wrongPath);
    expect(oldExists).toBe(false);
  });

  it("reports failed rename attempts when target exists", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });
    const created = await taskService.newTask({
      title: "Rename conflict",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const expectedPath = created.path;
    const dir = path.dirname(expectedPath);
    const wrongPath = path.join(dir, "rename-conflict.md");
    await fs.move(expectedPath, wrongPath);
    await fs.writeFile(expectedPath, "placeholder", "utf8");

    const fixer = new FixService({ repoRoot, taskService });
    const summary = await fixer.fixAll({ renameFiles: true });

    expect(summary.items).toHaveLength(1);
    const result = summary.items[0];
    expect(result.rename?.ok).toBe(false);
    expect(result.rename?.reason).toBe("target already exists");
    expect(result.path).toBe(wrongPath);

    const expectedStillExists = await fs.pathExists(expectedPath);
    expect(expectedStillExists).toBe(true);
    const wrongStillExists = await fs.pathExists(wrongPath);
    expect(wrongStillExists).toBe(true);
  });

  it("migrates legacy parent metadata into parent-owned children lists", async () => {
    const repoRoot = await makeRepo();
    const taskService = new TaskService({ repoRoot });

    const epic = await taskService.newTask({
      title: "Legacy Epic",
      kind: "epic",
      state: "idea",
      priority: "normal",
    });

    const story = await taskService.newTask({
      title: "Legacy Story",
      kind: "story",
      state: "idea",
      priority: "normal",
    });

    const legacyStoryDoc = {
      ...story,
      meta: {
        ...story.meta,
        parent: epic.meta.id,
      },
    };
    await writeTaskFile(story.path, legacyStoryDoc);

    const fixer = new FixService({ repoRoot, taskService });
    await fixer.fixAll();

    const migratedStory = await taskService.getTask(story.path);
    expect(migratedStory.meta.parent).toBeUndefined();
    expect(migratedStory.meta.children).toBeUndefined();

    const migratedEpic = await taskService.getTask(epic.path);
    expect(migratedEpic.meta.children).toEqual([migratedStory.meta.id]);
  });
});
