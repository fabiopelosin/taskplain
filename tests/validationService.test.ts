import path from "node:path";
import { describe, expect, it } from "vitest";

import { stateDir } from "../src/domain/paths";
import type { Kind, Priority, State, TaskDoc, TaskMeta } from "../src/domain/types";
import { ValidationService } from "../src/services/validationService";

const ISO = "2024-05-06T07:08:09.123Z";

function fullBody(options: { includeInsightsHeading?: boolean } = {}): string {
  const includeInsightsHeading = options.includeInsightsHeading ?? false;
  const sections = [
    "## Overview",
    "",
    "## Acceptance Criteria",
    "",
    "<!-- Objective pass/fail checks only. Each desired behavior gets its own checkbox. When all are checked, the task is complete. Be specific and avoid vague language. Add feature checks below. -->",
    "",
    '<!-- Example checks: "POST /foo returns 201", "Clicking X shows Y", "Database migration runs without errors" -->',
    "",
    "- [ ] Describe the expected outcome",
    "",
    "## Technical Approach",
    "",
  ];

  if (includeInsightsHeading) {
    sections.push(
      "## Post-Implementation Insights",
      "",
      "### Changelog",
      "- Captured learnings",
      "",
      "### Decisions",
      "- Recorded trade-offs",
      "",
      "### Technical Changes",
      "- Documented code-level changes",
      "",
    );
  } else {
    sections.push(
      "## Post-Implementation Insights",
      "",
      "### Changelog",
      "",
      "### Decisions",
      "",
      "### Technical Changes",
      "",
    );
  }

  return sections.join("\n");
}

interface BuildDocOptions {
  id: string;
  title: string;
  kind: Kind;
  state: State;
  priority?: Priority;
  parent?: string;
  children?: string[];
  body?: string;
  labels?: string[];
  assignees?: string[];
  depends_on?: string[];
  blocks?: string[];
  path?: string;
  commit_message?: string;
}

function buildDoc(options: BuildDocOptions): TaskDoc {
  const meta: TaskMeta = {
    id: options.id,
    title: options.title,
    kind: options.kind,
    state: options.state,
    priority: options.priority ?? "normal",
    created_at: ISO,
    updated_at: ISO,
    last_activity_at: ISO,
    size: "medium",
    ambiguity: "low",
    executor: "standard",
    isolation: "module",
  };

  if (options.state === "done") {
    meta.completed_at = ISO;
    meta.commit_message =
      options.commit_message ?? `chore(test): finish ${options.id} [Task:${options.id}]`;
  }

  if (options.parent !== undefined) {
    meta.parent = options.parent;
  }
  if (options.children) {
    meta.children = options.children;
  }
  if (options.depends_on) {
    meta.depends_on = options.depends_on;
  }
  if (options.blocks) {
    meta.blocks = options.blocks;
  }
  if (options.labels) {
    meta.labels = options.labels;
  }
  if (options.assignees) {
    meta.assignees = options.assignees;
  }

  const fileName =
    options.state === "done"
      ? `${ISO.slice(0, 10)} ${options.kind}-${options.id}.md`
      : `${options.kind}-${options.id}.md`;

  const docPath = options.path ?? path.posix.join(stateDir(options.state), fileName);

  return {
    meta,
    body: options.body ?? fullBody(),
    path: docPath,
  };
}

describe("ValidationService.validate", () => {
  it("accepts canonical documents", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "story-valid",
      title: "Valid Story",
      kind: "story",
      state: "ready",
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("requires Post-Implementation Insights heading once a task is done", () => {
    const validator = new ValidationService();
    const body = [
      "## Overview",
      "",
      "## Acceptance Criteria",
      "",
      "- [ ] Describe the expected outcome",
      "",
      "## Technical Approach",
      "",
    ].join("\n");
    const doc = buildDoc({
      id: "task-missing-insights",
      title: "Missing Done Insights",
      kind: "task",
      state: "done",
      body,
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("heading");
  });

  it("detects structural issues for single documents", () => {
    const validator = new ValidationService();
    const body = ["## Overview", "", "## Post-Implementation Insights", ""].join("\n");
    const doc = buildDoc({
      id: "story-done",
      title: "Done Story",
      kind: "story",
      state: "done",
      body,
      path: path.posix.join(stateDir("done"), "story-story-done.md"),
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code).sort()).toEqual([
      "filename",
      "heading",
      "heading",
    ]);
  });

  it("returns schema errors when metadata fails validation", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "story-invalid-title",
      title: "",
      kind: "story",
      state: "ready",
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "schema")).toBe(true);
  });

  it("requires acceptance criteria checkboxes", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "story-no-checkbox",
      title: "Story Invalid AC",
      kind: "story",
      state: "ready",
      body: [
        "## Overview",
        "",
        "## Acceptance Criteria",
        "",
        "Write some text without checkbox",
        "",
        "## Technical Approach",
        "",
        "## Post-Implementation Insights",
        "",
        "### Changelog",
        "",
        "### Decisions",
        "",
        "### Technical Changes",
        "",
      ].join("\n"),
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("acceptance_criteria_format");
  });

  it("ignores placeholder comment-only acceptance criteria lines", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "story-placeholder-checkbox",
      title: "Story Placeholder Checkbox",
      kind: "story",
      state: "ready",
      body: [
        "## Overview",
        "",
        "## Acceptance Criteria",
        "",
        "- [ ] <!-- placeholder criteria -->",
        "- [ ] Deliver the actual outcome",
        "",
        "## Technical Approach",
        "",
        "## Post-Implementation Insights",
        "",
        "### Changelog",
        "",
        "### Decisions",
        "",
        "### Technical Changes",
        "",
      ].join("\n"),
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails when acceptance criteria section is empty", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "story-empty-ac",
      title: "Story Empty AC",
      kind: "story",
      state: "ready",
      body: [
        "## Overview",
        "",
        "## Acceptance Criteria",
        "",
        "   ",
        "",
        "## Technical Approach",
        "",
        "## Post-Implementation Insights",
        "",
        "### Changelog",
        "",
        "### Decisions",
        "",
        "### Technical Changes",
        "",
      ].join("\n"),
    });
    const result = validator.validate(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("acceptance_criteria_empty");
  });

  it("warns instead of failing when in-progress tasks have all acceptance criteria checked", () => {
    const validator = new ValidationService();
    const doc = buildDoc({
      id: "task-all-checked",
      title: "Task With Checked ACs",
      kind: "task",
      state: "in-progress",
      body: [
        "## Overview",
        "",
        "## Acceptance Criteria",
        "",
        "- [x] Outcome verified",
        "- [x] Cleanup performed",
        "",
        "## Technical Approach",
        "",
        "## Post-Implementation Insights",
        "",
        "### Changelog",
        "",
        "### Decisions",
        "",
        "### Technical Changes",
        "",
      ].join("\n"),
    });

    const result = validator.validate(doc);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("all_acceptance_criteria_completed");
    expect(result.warnings[0].message).toContain(
      "Complete it with 'taskplain complete task-all-checked'",
    );
    expect(result.warnings[0].message).toContain("uncheck criteria");
  });
});

describe("ValidationService.validateAll", () => {
  it("reports cross-document inconsistencies and hierarchy issues", () => {
    const validator = new ValidationService();
    const docs: TaskDoc[] = [
      buildDoc({
        id: "epic-root",
        title: "Epic Root",
        kind: "epic",
        state: "in-progress",
        children: ["story-one", "story-missing", "story-cycle", "task-loose", "story-conflict"],
      }),
      buildDoc({
        id: "story-one",
        title: "Story One",
        kind: "story",
        state: "ready",
        parent: "epic-root",
        children: ["task-leaf", "task-leaf", "task-nested-1"],
        depends_on: ["invalid id", "story-one", "story-missing", "story-one"],
        blocks: ["story-one", "story-missing", "story-missing", "invalid block"],
      }),
      buildDoc({
        id: "story-cycle",
        title: "Story Cycle",
        kind: "story",
        state: "ready",
        parent: "epic-root",
        children: ["epic-root"],
      }),
      buildDoc({
        id: "task-leaf",
        title: "Task Leaf",
        kind: "task",
        state: "ready",
        parent: "story-one",
      }),
      buildDoc({
        id: "task-loose",
        title: "Task Loose",
        kind: "task",
        state: "ready",
        parent: "story-missing",
      }),
      buildDoc({
        id: "story-legacy",
        title: "Story Legacy",
        kind: "story",
        state: "ready",
        parent: "epic-root",
      }),
      buildDoc({
        id: "story-conflict",
        title: "Story Conflict",
        kind: "story",
        state: "ready",
        parent: "epic-other",
      }),
      buildDoc({
        id: "epic-other",
        title: "Epic Other",
        kind: "epic",
        state: "ready",
      }),
      buildDoc({
        id: "epic-child",
        title: "Epic Child",
        kind: "epic",
        state: "ready",
        parent: "epic-root",
      }),
      buildDoc({
        id: "task-orphan",
        title: "Task Orphan",
        kind: "task",
        state: "ready",
        parent: "epic-root",
      }),
      buildDoc({
        id: "task-nested-1",
        title: "Task Nested 1",
        kind: "task",
        state: "ready",
        parent: "story-one",
        children: ["task-nested-2"],
      }),
      buildDoc({
        id: "task-nested-2",
        title: "Task Nested 2",
        kind: "task",
        state: "ready",
        parent: "task-nested-1",
      }),
      buildDoc({
        id: "story-dupe",
        title: "Story Duplicate Primary",
        kind: "story",
        state: "ready",
      }),
      buildDoc({
        id: "story-dupe",
        title: "Story Duplicate Secondary",
        kind: "story",
        state: "ready",
        path: path.posix.join(stateDir("ready"), "story-story-dupe-secondary.md"),
      }),
    ];

    const result = validator.validateAll(docs);
    expect(result.ok).toBe(false);
    expect(result.errors).not.toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    const codes = result.errors.map((error) => error.code).sort();
    expect(codes).toMatchInlineSnapshot(`
      [
        "blocks_duplicate",
        "blocks_invalid_id",
        "blocks_self_reference",
        "child_not_listed",
        "child_not_listed",
        "child_not_listed",
        "conflicting_parent",
        "conflicting_parent",
        "conflicting_parent",
        "conflicting_parent",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "cycle",
        "depends_on_invalid_id",
        "depends_on_self_reference",
        "depends_on_self_reference",
        "depth_exceeded",
        "depth_exceeded",
        "depth_exceeded",
        "duplicate_child_reference",
        "duplicate_id",
        "filename",
        "invalid_child_kind",
        "invalid_child_kind",
        "invalid_child_kind",
        "invalid_child_kind",
        "invalid_children_kind",
        "invalid_parent_kind",
        "invalid_parent_kind",
        "invalid_parent_kind",
        "invalid_parent_kind",
        "invalid_parent_kind",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "legacy_parent_metadata",
        "missing_block_target",
        "missing_block_target",
        "missing_child_reference",
        "missing_dependency",
      ]
    `);
  });
});

describe("ValidationService.detectParentChildStateWarnings", () => {
  it("warns for idea parent with done children", () => {
    const validator = new ValidationService();
    const docs: TaskDoc[] = [
      buildDoc({
        id: "epic-x",
        title: "Epic X",
        kind: "epic",
        state: "idea",
        children: ["story-a"],
      }),
      buildDoc({ id: "story-a", title: "Story A", kind: "story", state: "done", parent: "epic-x" }),
    ];
    const warnings = validator.detectParentChildStateWarnings(docs);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("state_anomaly");
    expect(warnings[0].file.endsWith("epic-epic-x.md")).toBe(true);
  });

  it("warns for idea parent with in-progress children", () => {
    const validator = new ValidationService();
    const docs: TaskDoc[] = [
      buildDoc({
        id: "story-x",
        title: "Story X",
        kind: "story",
        state: "idea",
        children: ["task-a"],
      }),
      buildDoc({
        id: "task-a",
        title: "Task A",
        kind: "task",
        state: "in-progress",
        parent: "story-x",
      }),
    ];
    const warnings = validator.detectParentChildStateWarnings(docs);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("state_progression");
  });

  it("warns for canceled parent with active children", () => {
    const validator = new ValidationService();
    const docs: TaskDoc[] = [
      buildDoc({
        id: "epic-c",
        title: "Epic C",
        kind: "epic",
        state: "canceled",
        children: ["story-c1", "story-c2"],
      }),
      buildDoc({
        id: "story-c1",
        title: "Story C1",
        kind: "story",
        state: "ready",
        parent: "epic-c",
      }),
      buildDoc({
        id: "story-c2",
        title: "Story C2",
        kind: "story",
        state: "in-progress",
        parent: "epic-c",
      }),
    ];
    const warnings = validator.detectParentChildStateWarnings(docs);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("inconsistent_cancellation");
  });

  it("warns for done parent with canceled children", () => {
    const validator = new ValidationService();
    const docs: TaskDoc[] = [
      buildDoc({
        id: "story-d",
        title: "Story D",
        kind: "story",
        state: "done",
        children: ["task-d1"],
      }),
      buildDoc({
        id: "task-d1",
        title: "Task D1",
        kind: "task",
        state: "canceled",
        parent: "story-d",
      }),
    ];
    const warnings = validator.detectParentChildStateWarnings(docs);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("incomplete_closure");
  });
});
