import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  orderTaskMeta,
  readTaskFile,
  serializeTaskDoc,
  writeTaskFile,
} from "../src/adapters/taskFile";
import { stateDir } from "../src/domain/paths";
import type { TaskDoc, TaskMeta } from "../src/domain/types";

const FIXED_NOW = new Date("2024-05-06T07:08:09.123Z");
const ISO = FIXED_NOW.toISOString();

const tempDirs: string[] = [];

function fullBody(): string {
  return [
    "## Overview",
    "- Provide deterministic markdown output",
    "",
    "## Acceptance Criteria",
    "- [ ] Preserve YAML ordering",
    "",
    "## Technical Approach",
    "- Exercise adapter helpers",
    "",
    "<!--",
    "## Post-Implementation Insights",
    "",
    "> Uncomment this section when moving the task to `done` so completions include the knowledge we extracted.",
    "> Capture discoveries, decisions, and architecture updates with concrete bullet points.",
    "> - **Changelog** (required): Summarize what shipped using Keep a Changelog verbs.",
    "> - **Decisions** (optional): Note key choices, rejected alternatives, and rationale.",
    "> - **Architecture** (optional): Document notable patterns, refactors, or new structures.",
    "",
    "### Changelog",
    "- Coverage-focused fixtures",
    "- Track via Vitest snapshots",
    "",
    "### Decisions",
    "- ",
    "",
    "### Architecture",
    "- ",
    "-->",
    "",
  ].join("\n");
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-taskfile-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.remove(dir)));
});

describe("orderTaskMeta", () => {
  it("arranges metadata keys in canonical order", () => {
    const scrambled = {
      updated_at: ISO,
      created_at: ISO,
      priority: "high",
      kind: "story",
      state: "idea",
      commit_message: "feat(tasks): add commit metadata  [Task:demo]",
      id: "story-canonical",
      title: "Canonical Story",
      executor: "expert",
      isolation: "module",
      ambiguity: "medium",
      size: "small",
      last_activity_at: ISO,
      depends_on: ["task-a", "task-b"],
      blocks: ["task-c"],
      labels: ["coverage", "regression"],
      assignees: ["codex"],
      touches: ["src/**"],
    } as TaskMeta;

    const ordered = orderTaskMeta(scrambled);
    const serialized = JSON.stringify(ordered, null, 2);
    expect(serialized).toMatchInlineSnapshot(`
      "{
        "id": "story-canonical",
        "title": "Canonical Story",
        "kind": "story",
        "state": "idea",
        "commit_message": "feat(tasks): add commit metadata  [Task:demo]",
        "priority": "high",
        "size": "small",
        "ambiguity": "medium",
        "executor": "expert",
        "isolation": "module",
        "touches": [
          "src/**"
        ],
        "depends_on": [
          "task-a",
          "task-b"
        ],
        "blocks": [
          "task-c"
        ],
        "assignees": [
          "codex"
        ],
        "labels": [
          "coverage",
          "regression"
        ],
        "created_at": "2024-05-06T07:08:09.123Z",
        "updated_at": "2024-05-06T07:08:09.123Z",
        "last_activity_at": "2024-05-06T07:08:09.123Z"
      }"
    `);
  });
});

describe("serializeTaskDoc", () => {
  it("renders golden markdown with ordered front matter", async () => {
    const doc: TaskDoc = {
      meta: {
        id: "story-golden-fixture",
        title: "Golden Fixture Story",
        kind: "story",
        state: "idea",
        priority: "high",
        labels: ["quality", "coverage"],
        assignees: ["agent-alpha"],
        depends_on: ["task-upstream"],
        blocks: ["task-followup"],
        created_at: ISO,
        updated_at: ISO,
        last_activity_at: ISO,
        size: "medium",
        ambiguity: "low",
        executor: "standard",
        isolation: "module",
        links: [
          {
            type: "github_issue",
            repo: "taskplain/taskplain",
            number: 42,
          },
        ],
      },
      body: fullBody(),
      path: path.join(stateDir("idea"), "story-story-golden-fixture.md"),
    };

    const serialized = serializeTaskDoc(doc);
    await expect(serialized).toMatchFileSnapshot("taskFileAdapter.serialize.story.md");
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("normalizes Date instances nested in execution metadata", async () => {
    const created = new Date("2025-11-03T01:02:03.000Z");
    const attemptStart = new Date("2025-11-03T01:10:00.000Z");
    const attemptEnd = new Date("2025-11-03T01:15:00.000Z");
    const reviewTime = new Date("2025-11-03T01:20:00.000Z");

    const repo = await makeRepo();
    const filePath = path.join(
      repo,
      stateDir("in-progress"),
      "task-task-datetime-normalization.md",
    );
    await fs.ensureDir(path.dirname(filePath));

    const doc = {
      meta: {
        id: "task-datetime-normalization",
        title: "Normalize execution timestamps",
        kind: "task",
        state: "in-progress",
        priority: "normal",
        created_at: created,
        updated_at: created,
        execution: {
          attempts: [
            {
              started_at: attemptStart,
              ended_at: attemptEnd,
              duration_seconds: 300,
              status: "failed",
              executor: {
                tool: "agent-driver",
                model: "gpt-5-codex",
              },
              reviewer: {
                name: "fabio",
                approved: false,
                reviewed_at: reviewTime,
              },
            },
          ],
        },
      },
      body: fullBody(),
      path: path.join(stateDir("in-progress"), "task-task-datetime-normalization.md"),
    } as unknown as TaskDoc;

    const serialized = serializeTaskDoc(doc);
    await fs.writeFile(filePath, serialized, "utf8");

    const { doc: parsed } = await readTaskFile(filePath);

    const attempt = parsed.meta.execution?.attempts[0];
    expect(typeof parsed.meta.created_at).toBe("string");
    expect(typeof parsed.meta.updated_at).toBe("string");
    expect(attempt).toBeDefined();
    expect(typeof attempt?.started_at).toBe("string");
    expect(typeof attempt?.ended_at).toBe("string");
    expect(typeof attempt?.reviewer?.reviewed_at).toBe("string");

    expect(attempt?.started_at).toBe("2025-11-03T01:10:00.000Z");
    expect(attempt?.ended_at).toBe("2025-11-03T01:15:00.000Z");
    expect(attempt?.reviewer?.reviewed_at).toBe("2025-11-03T01:20:00.000Z");
  });
});

describe("readTaskFile", () => {
  it("normalizes metadata and collects warnings for invalid fixtures", async () => {
    const repo = await makeRepo();
    const relPath = path.join(repo, stateDir("idea"), "story-story-normalized.md");
    await fs.ensureDir(path.dirname(relPath));

    const content = [
      "---",
      "id: story-normalized",
      "title: Needs Normalization",
      "kind: story",
      "state: in_progress",
      "priority: 1",
      "labels: coverage ",
      "parent: null",
      "custom_meta: keep-me",
      "---",
      "",
      "## Overview",
      "",
      "## Post-Implementation Insights",
      "",
      "Residual text without sections",
      "",
    ].join("\n");

    await fs.writeFile(relPath, content, "utf8");

    const result = await readTaskFile(relPath);
    const { doc, warnings } = result;

    expect(doc.meta.state).toBe("in-progress");
    expect(doc.meta.priority).toBe("low");
    expect(doc.meta.labels).toEqual(["coverage"]);
    expect(doc.meta.created_at).toBe(FIXED_NOW.toISOString());
    expect(doc.meta.updated_at).toBe(FIXED_NOW.toISOString());
    expect(doc.meta.last_activity_at).toBe(FIXED_NOW.toISOString());
    expect(warnings.map((warn) => warn.code).sort()).toMatchInlineSnapshot(`
      [
        "created_at_missing",
        "labels_coerced",
        "last_activity_missing",
        "missing_heading",
        "missing_heading",
        "parent_removed",
        "priority_normalized",
        "state_normalized",
        "unknown_meta_key",
        "updated_at_missing",
      ]
    `);
  });

  it("preserves execution telemetry without emitting unknown_meta_key warnings", async () => {
    const repo = await makeRepo();
    const relPath = path.join(repo, stateDir("in-progress"), "task-task-execution-telemetry.md");
    await fs.ensureDir(path.dirname(relPath));

    const content = [
      "---",
      "id: task-execution-telemetry",
      "title: Execution Telemetry",
      "kind: task",
      "state: in-progress",
      "priority: normal",
      "created_at: 2025-11-03T07:08:09.123Z",
      "updated_at: 2025-11-03T07:08:09.123Z",
      "last_activity_at: 2025-11-03T07:08:09.123Z",
      "execution:",
      "  attempts:",
      "    - started_at: 2025-11-03T07:10:00.000Z",
      "      ended_at: 2025-11-03T07:20:00.000Z",
      "      duration_seconds: 600",
      "      status: completed",
      "      executor:",
      "        tool: agent-driver",
      "        model: gpt-5-codex",
      "---",
      "",
      "## Overview",
      "",
      "- Track execution attempts successfully.",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] Placeholder",
      "",
      "## Technical Approach",
      "",
      "- Placeholder",
    ].join("\n");

    await fs.writeFile(relPath, content, "utf8");

    const { warnings } = await readTaskFile(relPath);
    expect(warnings).toHaveLength(0);
  });

  it("fails validation when a done task omits commit_message", async () => {
    const repo = await makeRepo();
    const relPath = path.join(repo, stateDir("done"), "2025-11-02 task-missing-commit.md");
    await fs.ensureDir(path.dirname(relPath));

    const content = [
      "---",
      "id: task-missing-commit",
      "title: Missing Commit",
      "kind: task",
      "state: done",
      "priority: normal",
      "created_at: 2025-11-02T07:08:09.123Z",
      "updated_at: 2025-11-02T07:08:09.123Z",
      "completed_at: 2025-11-02T07:08:09.123Z",
      "last_activity_at: 2025-11-02T07:08:09.123Z",
      "---",
      "",
      "## Overview",
      "",
      "Work finished but commit message missing.",
      "",
      "## Acceptance Criteria",
      "",
      "- [x] Placeholder",
      "",
      "## Technical Approach",
      "",
      "- Placeholder",
    ].join("\n");

    await fs.writeFile(relPath, content, "utf8");

    await expect(readTaskFile(relPath)).rejects.toThrowError(
      /commit_message is required when state is done/,
    );
  });

  it("allows historical done tasks without commit_message before cutoff", async () => {
    const repo = await makeRepo();
    const relPath = path.join(repo, stateDir("done"), "2024-05-06 task-legacy.md");
    await fs.ensureDir(path.dirname(relPath));

    const content = [
      "---",
      "id: task-legacy",
      "title: Legacy Done",
      "kind: task",
      "state: done",
      "priority: normal",
      "created_at: 2024-05-06T07:08:09.123Z",
      "updated_at: 2024-05-06T07:08:09.123Z",
      "completed_at: 2024-05-06T07:08:09.123Z",
      "last_activity_at: 2024-05-06T07:08:09.123Z",
      "---",
      "",
      "## Overview",
      "",
      "Legacy task predates commit_message enforcement.",
      "",
      "## Acceptance Criteria",
      "",
      "- [x] Placeholder",
      "",
      "## Technical Approach",
      "",
      "- Placeholder",
    ].join("\n");

    await fs.writeFile(relPath, content, "utf8");

    await expect(readTaskFile(relPath)).resolves.toBeDefined();
  });
});

describe("writeTaskFile", () => {
  it("round-trips documents without introducing spurious warnings", async () => {
    const repo = await makeRepo();
    const outputPath = path.join(repo, stateDir("ready"), "story-story-roundtrip.md");
    await fs.ensureDir(path.dirname(outputPath));

    const doc: TaskDoc = {
      meta: {
        id: "story-roundtrip",
        title: "Roundtrip Story",
        kind: "story",
        state: "ready",
        priority: "normal",
        created_at: ISO,
        updated_at: ISO,
        last_activity_at: ISO,
        size: "medium",
        ambiguity: "low",
        executor: "standard",
        isolation: "module",
      },
      body: fullBody(),
      path: outputPath,
    };

    await writeTaskFile(outputPath, doc);
    const reread = await readTaskFile(outputPath);
    expect(reread.doc.meta).toEqual(doc.meta);
    const expectedBody = `\n${fullBody().trimEnd()}`;
    expect(reread.doc.body).toBe(expectedBody);
    expect(reread.warnings).toHaveLength(0);
  });
});
