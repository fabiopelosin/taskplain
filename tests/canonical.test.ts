import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { describe, expect, it } from "vitest";

import {
  getHandbookSnippet,
  renderHandbook,
  SNIPPET_MARKER_END,
  SNIPPET_MARKER_START,
} from "../src/domain/canonical";
import { stateOrder } from "../src/domain/types";
import { renderDescribe } from "../src/services/describeService";
import { checkManagedSnippet, writeManagedSnippet } from "../src/services/handbookService";

describe("handbook rendering", () => {
  it("returns the managed snippet for overview", () => {
    const snippet = renderHandbook("overview", "md");
    expect(snippet).toBe(getHandbookSnippet("md"));
    expect(snippet).toContain(SNIPPET_MARKER_START);
    expect(snippet).toContain(SNIPPET_MARKER_END);
  });

  it("emits deterministic markdown for the full handbook", () => {
    const handbook = renderHandbook("all", "md");
    expect(handbook).toMatchSnapshot();
    expect(handbook.endsWith("\n")).toBe(true);
    expect(handbook).toContain("## Conventions");
  });

  it("provides a plain-text variant", () => {
    const text = renderHandbook("all", "txt");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimStart().startsWith("#")).toBe(false);
  });
});

describe("managed snippet writer", () => {
  it("creates a new file when none exists", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-snippet-"));
    const repoRoot = dir;
    const result = await writeManagedSnippet(repoRoot, "AGENTS.md");
    expect(result.changed).toBe(true);
    const written = await fs.readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(written).toBe(getHandbookSnippet("md"));
  });

  it("replaces the existing managed block without touching neighbors", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-snippet-"));
    const filePath = path.join(dir, "AGENTS.md");
    const oldSnippet = getHandbookSnippet("md").replace(
      "This repo uses Taskplain",
      "Legacy content",
    );
    const preamble = "# Human introduction\n\n";
    const epilogue = "\n## Appendix\n- Other tool snippet";
    await fs.writeFile(filePath, `${preamble}${oldSnippet}${epilogue}`, "utf8");

    const result = await writeManagedSnippet(dir, "AGENTS.md");
    expect(result.changed).toBe(true);
    const written = await fs.readFile(filePath, "utf8");
    expect(written.startsWith(preamble)).toBe(true);
    expect(written.endsWith(epilogue)).toBe(true);
    expect((written.match(new RegExp(SNIPPET_MARKER_START, "g")) ?? []).length).toBe(1);
  });

  it("is idempotent when snippet already matches", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-snippet-"));
    const filePath = path.join(dir, "AGENTS.md");
    await fs.writeFile(filePath, getHandbookSnippet("md"), "utf8");

    const result = await writeManagedSnippet(dir, "AGENTS.md");
    expect(result.changed).toBe(false);
    const written = await fs.readFile(filePath, "utf8");
    expect(written).toBe(getHandbookSnippet("md"));
  });

  it("detects stale snippets", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "taskplain-snippet-"));
    const filePath = path.join(dir, "AGENTS.md");
    const stale = getHandbookSnippet("md").replace("Taskplain", "TaskplainX");
    await fs.writeFile(filePath, stale, "utf8");

    const check = await checkManagedSnippet(dir, "AGENTS.md");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("stale");

    await writeManagedSnippet(dir, "AGENTS.md");
    const fresh = await checkManagedSnippet(dir, "AGENTS.md");
    expect(fresh.ok).toBe(true);
  });
});

describe("describe payload", () => {
  it("produces JSON with expected structure", () => {
    const serialized = renderDescribe("json");
    expect(serialized.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(parsed.name).toBe("taskplain");
    expect(Array.isArray(parsed.commands)).toBe(true);
    const helpCommand = parsed.commands.find((cmd: { name: string }) => cmd.name === "help") as
      | { options: Array<{ name: string }> }
      | undefined;
    expect(helpCommand).toBeTruthy();
    if (helpCommand) {
      expect(helpCommand.options.some((option) => option.name === "--playbook")).toBe(true);
      expect(helpCommand.options.some((option) => option.name === "--reference")).toBe(true);
      expect(helpCommand.options.some((option) => option.name === "--contract")).toBe(true);
      expect(helpCommand.options.some((option) => option.name === "--snippet")).toBe(true);
    }
    expect(parsed.commands.find((cmd: { name: string }) => cmd.name === "inject")).toBeTruthy();
    const newCommand = parsed.commands.find((cmd: { name: string }) => cmd.name === "new");
    expect(newCommand).toBeTruthy();
    expect(
      newCommand.options.some(
        (option: { name: string; default?: string }) =>
          option.name === "--output <format>" && option.default === "human",
      ),
    ).toBe(true);
    expect(newCommand.outputSchema.properties.meta).toBeDefined();
    const updateCommand = parsed.commands.find((cmd: { name: string }) => cmd.name === "update");
    expect(updateCommand).toBeTruthy();
    expect(
      updateCommand.options.some((option: { name: string }) => option.name.startsWith("--meta")),
    ).toBe(true);
    expect(updateCommand.outputSchema.properties.warnings).toBeDefined();
    expect(parsed.conventions.states.map((s: { id: string }) => s.id)).toEqual([...stateOrder]);
    expect(parsed.snippet.content).toContain("Taskplain");
    expect(parsed.schema.task).toBeDefined();
  });
});
