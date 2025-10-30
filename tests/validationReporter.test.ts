import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterAll, describe, expect, it } from "vitest";

import { TaskService } from "../src/services/taskService";
import {
  collectValidationIssues,
  groupErrorsByFile,
  type ValidationStreamEvent,
} from "../src/services/validationReporter";
import { ValidationService } from "../src/services/validationService";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-validate-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.remove(dir)));
});

describe("validation reporter", () => {
  it("collects parse errors alongside validation issues", async () => {
    const repoRoot = await makeRepo();
    const service = new TaskService({ repoRoot });
    await service.newTask({
      title: "Valid Story",
      kind: "story",
      parent: undefined,
      state: "idea",
      priority: "normal",
    });

    const tasksDir = path.join(repoRoot, "tasks", "00-idea");
    await fs.ensureDir(tasksDir);
    const invalidPath = path.join(tasksDir, "story-broken.md");
    const invalidContent = [
      "---",
      "title: Story 1.1: Unify Report Data Structure",
      "kind: story",
      "state: idea",
      "priority: high",
      "created_at: 2024-01-01T00:00:00.000Z",
      "updated_at: 2024-01-01T00:00:00.000Z",
      "completed_at: null",
      "links: []",
      "last_activity_at: 2024-01-01T00:00:00.000Z",
      "---",
      "",
      "## Overview",
      "",
      "## Acceptance Criteria",
    ].join("\n");
    await fs.writeFile(invalidPath, invalidContent, "utf8");

    const validator = new ValidationService();
    const { errors, parseErrors, filesChecked } = await collectValidationIssues(service, validator);

    expect(filesChecked).toBe(2);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].code).toBe("parse");
    expect(parseErrors[0].file).toBe(invalidPath);

    const grouped = groupErrorsByFile([...errors, ...parseErrors]);
    expect(grouped.get(invalidPath)).toBeDefined();
    expect(grouped.get(invalidPath)?.[0].code).toBe("parse");
  });

  it("emits document events in deterministic order even with concurrency", async () => {
    const repoRoot = await makeRepo();
    const service = new TaskService({ repoRoot });
    for (let index = 0; index < 6; index += 1) {
      await service.newTask({
        title: `Story ${index}`,
        kind: "story",
        state: "idea",
        priority: "normal",
      });
    }

    const validator = new ValidationService();
    const events: ValidationStreamEvent[] = [];
    await collectValidationIssues(service, validator, {
      maxConcurrency: 4,
      minParallelFiles: 1,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const documentIndexes = events
      .filter((event) => event.stage === "document")
      .map((event) => event.index);
    expect(documentIndexes).toHaveLength(6);
    expect(documentIndexes).toEqual([...documentIndexes].sort((a, b) => a - b));
  });
});
