#!/usr/bin/env node
import path from "node:path";
import { Command, Option } from "commander";
import fs from "fs-extra";
import open from "open";

import { GitAdapter } from "./adapters/gitAdapter";
import { SNIPPET_VERSION } from "./domain/canonical";
import { stateDir } from "./domain/paths";
import { isSectionId, orderedSectionIds, type SectionId } from "./domain/sections";
import type { Ambiguity, Executor, Isolation, Kind, Size, TaskDoc, TaskMeta } from "./domain/types";
import {
  ambiguityOrder,
  executorOrder,
  isolationOrder,
  kindOrder,
  linkSchema,
  priorityOrder,
  type State,
  sizeOrder,
  TASK_ID_REGEX,
} from "./domain/types";
import { CleanupService } from "./services/cleanup.service";
import { renderDescribe } from "./services/describeService";
import { FixService } from "./services/fixService";
import {
  checkManagedSnippet,
  generateHandbook,
  writeManagedSnippet,
} from "./services/handbookService";
import { NextService, type RankedCandidate } from "./services/nextService";
import { PickupService } from "./services/pickupService";
import type {
  OpenTreeItem,
  OpenTreeStateGroup,
  TaskListItem,
  TaskTreeNode,
} from "./services/taskQueryService";
import { type TaskCascadeMode, TaskService, type TaskWarning } from "./services/taskService";
import type { ValidationStreamEvent } from "./services/validationReporter";
import { collectValidationIssues } from "./services/validationReporter";
import { ValidationService } from "./services/validationService";
import { WebServerService } from "./services/webServerService";
import {
  type ColorMode,
  colors,
  formatHeading,
  formatId,
  formatNote,
  formatPath,
  formatPriority,
  formatState,
  getColorMode,
  renderTable,
  setColorMode,
  type TableCell,
} from "./utils/cliUi";

const allStates: State[] = ["idea", "ready", "in-progress", "done", "canceled"];
const openStateDefaults: State[] = ["idea", "ready", "in-progress"];
const openStateSet = new Set<State>(openStateDefaults);
const colorModes = new Set<ColorMode>(["auto", "always", "never"]);

function parsePriorityOption(value?: string): TaskMeta["priority"] | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (!priorityOrder.includes(normalized as (typeof priorityOrder)[number])) {
    throw new Error(`Invalid priority '${value}'. Expected one of: ${priorityOrder.join(", ")}`);
  }
  return normalized as TaskMeta["priority"];
}

function parseEnumListOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T[] | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`${flag} requires at least one value`);
  }
  const invalid = parts.filter((part): part is string => !allowed.includes(part as T));
  if (invalid.length > 0) {
    throw new Error(
      `${flag} received invalid values: ${invalid.join(", ")}. Expected one of: ${allowed.join(", ")}`,
    );
  }
  return Array.from(new Set(parts)) as T[];
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new Error(`${flag} requires a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseSingleEnumOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.includes(",")) {
    throw new Error(`${flag} accepts a single value`);
  }
  if (!allowed.includes(normalized as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  }
  return normalized as T;
}

const HUMAN_JSON_OUTPUT_VALUES = ["human", "json"] as const;
type HumanJsonOutput = (typeof HUMAN_JSON_OUTPUT_VALUES)[number];
const HUMAN_JSON_OUTPUT_SET = new Set<string>(HUMAN_JSON_OUTPUT_VALUES);

function parseHumanJsonOutput(
  value: string | undefined,
  { exitCode }: { exitCode?: number } = {},
): HumanJsonOutput {
  const normalized = (value ?? "human").trim().toLowerCase();
  if (!HUMAN_JSON_OUTPUT_SET.has(normalized)) {
    if (exitCode !== undefined) {
      process.exitCode = exitCode;
    }
    throw new Error("--output must be 'human' or 'json'");
  }
  return normalized as HumanJsonOutput;
}

const UPDATE_META_FIELDS = [
  "title",
  "priority",
  "parent",
  "assignees",
  "labels",
  "state",
  "blocked",
  "links",
  "size",
  "ambiguity",
  "executor",
  "isolation",
  "touches",
  "depends_on",
  "blocks",
] as const;

type UpdateMetaField = (typeof UPDATE_META_FIELDS)[number];

const UPDATE_ALLOWED_META = new Set<UpdateMetaField>(UPDATE_META_FIELDS);

const UNSET_ALLOWED_META = new Set<UpdateMetaField>([
  "parent",
  "assignees",
  "labels",
  "links",
  "blocked",
  "touches",
  "depends_on",
  "blocks",
]);

const cascadeModes: TaskCascadeMode[] = ["none", "ready", "cancel"];

function collectMetaOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function collectUnsetOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function collectFieldOption(value: string | string[], previous: string[][]): string[][] {
  const tokens = Array.isArray(value) ? value : [value];
  for (const token of tokens) {
    const current = previous[previous.length - 1];
    if (!current || current.length >= 2) {
      previous.push([token]);
    } else {
      current.push(token);
    }
  }
  return previous;
}

function warningsToJson(warnings: TaskWarning[], repoRoot: string): Array<Record<string, unknown>> {
  return warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    field: warning.field,
    file: path.relative(repoRoot, warning.file) || warning.file,
  }));
}

function printWarningsHuman(warnings: TaskWarning[], repoRoot: string): void {
  if (warnings.length === 0) {
    return;
  }
  const byFile = new Map<string, TaskWarning[]>();
  for (const w of warnings) {
    const list = byFile.get(w.file) ?? [];
    list.push(w);
    byFile.set(w.file, list);
  }
  const files = Array.from(byFile.keys()).sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    process.stderr.write(`- ${formatPath(file, repoRoot)}\n`);
    for (const w of byFile.get(file) ?? []) {
      const code = w.code ? colors.yellow(`[${w.code}]`) : colors.yellow("[warning]");
      const fieldInfo = w.field ? ` ${formatNote(`(${w.field})`)}` : "";
      const lines = `${w.message}`.split(/\r?\n/);
      if (lines.length === 0) continue;
      process.stderr.write(`    ${code}${fieldInfo ? ` ${fieldInfo}` : ""} ${lines[0]}\n`);
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().length === 0) continue;
        process.stderr.write(`    ${line}\n`);
      }
    }
  }
}

async function setupTaskService(
  repoRoot: string,
): Promise<{ taskService: TaskService; git?: GitAdapter }> {
  const gitAdapter = new GitAdapter(repoRoot);
  const isRepo = await gitAdapter.isRepo();
  const git = isRepo ? gitAdapter : undefined;
  return {
    taskService: new TaskService({ repoRoot, git }),
    git,
  };
}

async function buildTaskService(repoRoot: string): Promise<TaskService> {
  const { taskService } = await setupTaskService(repoRoot);
  return taskService;
}

type TaskCommandContext = {
  repoRoot: string;
  taskService: TaskService;
  git?: GitAdapter;
};

async function getTaskCommandContext(): Promise<TaskCommandContext> {
  const repoRoot = process.cwd();
  const { taskService, git } = await setupTaskService(repoRoot);
  return { repoRoot, taskService, git };
}

async function ensureStateTree(repoRoot: string): Promise<void> {
  for (const state of allStates) {
    await fs.ensureDir(path.join(repoRoot, stateDir(state)));
  }
}

async function createSampleTask(repoRoot: string): Promise<void> {
  const taskService = await buildTaskService(repoRoot);
  const templateTitle = "Sample Task";
  try {
    await taskService.newTask({
      title: templateTitle,
      kind: "task",
      state: "ready",
      priority: "normal",
    });
  } catch (error) {
    if ((error as Error).message.includes("already exists")) {
      return;
    }
    throw error;
  }
}

async function handleInit(options: { sample: boolean }): Promise<void> {
  const repoRoot = process.cwd();
  await ensureStateTree(repoRoot);
  if (options.sample) {
    await createSampleTask(repoRoot);
  }
  process.stdout.write("Taskplain workspace initialized.\n\nNext:\n  taskplain inject AGENTS.md\n");
}

async function handleNewTask(cmd: {
  title: string;
  kind?: string;
  parent?: string;
  state?: "idea" | "ready" | "in-progress" | "done" | "canceled";
  priority?: "none" | "low" | "normal" | "high" | "urgent";
  output?: string;
}): Promise<void> {
  const { repoRoot, taskService } = await getTaskCommandContext();
  const requestedKind = parseSingleEnumOption<Kind>(cmd.kind, kindOrder, "--kind");
  const kind = await resolveNewTaskKind(taskService, requestedKind, cmd.parent);
  const doc = await taskService.newTask({
    title: cmd.title,
    kind,
    parent: cmd.parent,
    state: cmd.state,
    priority: cmd.priority,
  });
  const relativePath = path.relative(repoRoot, doc.path) || doc.path;
  const outputFormat = parseHumanJsonOutput(cmd.output);

  if (outputFormat === "json") {
    const payload = {
      id: doc.meta.id,
      path: relativePath,
      meta: doc.meta,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${colors.green("created")} ${formatId(doc.meta.id)} -> ${formatPath(relativePath)}\n`,
  );
}

async function resolveNewTaskKind(
  taskService: TaskService,
  requested: Kind | undefined,
  parentId?: string,
): Promise<Kind> {
  if (requested) {
    return requested;
  }

  const trimmedParent = parentId?.trim();
  if (!trimmedParent) {
    return "task";
  }

  const parent = await taskService.loadTaskById(trimmedParent);
  switch (parent.meta.kind) {
    case "epic":
      return "story";
    case "story":
      return "task";
    case "task":
      throw new Error(
        `Cannot infer kind: parent '${trimmedParent}' is a task. Pass --kind explicitly to choose a child type.`,
      );
    default:
      throw new Error(
        `Cannot infer kind from parent '${trimmedParent}' of type '${parent.meta.kind}'. Pass --kind explicitly.`,
      );
  }
}

type ValidateCommandOptions = {
  output?: string;
  concurrency?: string;
  minParallel?: string;
  fix?: boolean;
  renameFiles?: boolean;
  strict?: boolean;
};

async function handleValidate(options: ValidateCommandOptions = {}): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output, { exitCode: 3 });
  const maxConcurrency = parseOptionalPositiveInteger(options.concurrency, "--concurrency");
  const minParallel = parseOptionalPositiveInteger(options.minParallel, "--min-parallel");

  if (options.fix) {
    await handleFix([], {
      all: true,
      renameFiles: options.renameFiles === true,
      output: options.output ?? "human",
    });
  }

  const { repoRoot, taskService } = await getTaskCommandContext();
  const validator = new ValidationService();

  const start = process.hrtime.bigint();
  const printed = new Set<string>();

  const writeJson = (payload: unknown): void => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const handleEvent = (event: ValidationStreamEvent): void => {
    if (outputFormat === "json") {
      writeJson({
        type: "file",
        stage: event.stage,
        file: path.relative(repoRoot, event.file) || event.file,
        ok: event.ok,
        errors: event.errors,
      });
      return;
    }

    if (event.errors.length === 0) {
      return;
    }

    if (!printed.has(event.file)) {
      printed.add(event.file);
      process.stderr.write(`- ${formatPath(event.file, repoRoot)}\n`);
    }

    for (const issue of event.errors) {
      process.stderr.write(`    ${colors.red(`[${issue.code}]`)} ${issue.message}\n`);
    }
  };

  const { docs, errors, parseErrors, filesChecked } = await collectValidationIssues(
    taskService,
    validator,
    {
      maxConcurrency,
      minParallelFiles: minParallel,
      onEvent: handleEvent,
    },
  );

  // Collect normalization warnings surfaced during parsing and cross-document state anomalies
  const warningsFromIo = taskService.drainWarnings();
  const anomalyWarnings = validator.detectParentChildStateWarnings(docs).map((w) => ({
    code: w.code,
    message: w.message,
    field: w.field,
    file: w.file,
  }));
  const warnings = [...warningsFromIo, ...anomalyWarnings];
  if (outputFormat === "json") {
    for (const warning of warnings) {
      writeJson({
        type: "warning",
        file: path.relative(repoRoot, warning.file) || warning.file,
        code: warning.code,
        message: warning.message,
        field: warning.field ?? null,
        level: "warning",
      });
    }
  } else {
    printWarningsHuman(warnings, repoRoot);
  }

  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  const allErrors = [...parseErrors, ...errors];
  const uniqueErrorFiles = new Set<string>(allErrors.map((error) => error.file));
  const hasFilenameIssues = allErrors.some((error) => error.code === "filename");
  const formatDuration = (ms: number): string => {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  };

  const strict = options.strict === true;
  if (outputFormat === "json") {
    const summaryPayload: Record<string, unknown> = {
      type: "summary",
      ok: allErrors.length === 0 && (!strict || warnings.length === 0),
      files: filesChecked,
      docs: docs.length,
      parse_errors: parseErrors.length,
      validation_errors: errors.length,
      warnings: warnings.length,
      issues: allErrors.length,
      duration_ms: Math.round(durationMs),
      generated_at: new Date().toISOString(),
    };
    if (hasFilenameIssues) {
      summaryPayload.hints = ["taskplain validate --fix --rename-files"];
    }
    writeJson(summaryPayload);
  } else if (allErrors.length === 0) {
    process.stdout.write(
      `${colors.green("Validation OK")} ${formatNote(`(${filesChecked} files checked in ${formatDuration(durationMs)})`)}\n`,
    );
  } else {
    process.stderr.write(
      `${colors.red("Validation failed")}` +
        ` ${formatNote(
          `(${uniqueErrorFiles.size} files, ${allErrors.length} issues, ${formatDuration(durationMs)})`,
        )}\n`,
    );
  }

  if (allErrors.length > 0 || (strict && warnings.length > 0)) {
    process.exitCode = 1;
  }

  if (outputFormat === "human" && hasFilenameIssues) {
    process.stderr.write(
      `${formatNote("tip: run `taskplain validate --fix --rename-files` to repair filename mismatches")}\n`,
    );
  }
}

type FixCommandOptions = {
  all?: boolean;
  output?: string;
  renameFiles?: boolean;
};

async function handleFix(ids: string[], options: FixCommandOptions): Promise<void> {
  const repoRoot = process.cwd();
  const { taskService, git } = await setupTaskService(repoRoot);
  const fixer = new FixService({ repoRoot, taskService, git });

  const outputFormat = parseHumanJsonOutput(options.output);

  const useAll = options.all === true;
  if (!useAll && ids.length === 0) {
    throw new Error("Provide at least one id or pass --all to repair every task");
  }

  const renameFiles = options.renameFiles === true;
  const summary = useAll
    ? await fixer.fixAll({ renameFiles })
    : await fixer.fixIds(ids, { renameFiles });
  const changed = summary.items.filter((item) => item.changed);
  const unchanged = summary.items.filter((item) => !item.changed);
  const renameResults = summary.items
    .map((item) => item.rename)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const renameSuccess = renameResults.filter((entry) => entry.ok);
  const renameFailures = renameResults.filter((entry) => !entry.ok);

  if (outputFormat === "json") {
    const payload = {
      ok: summary.skipped.length === 0,
      updated: changed.length,
      unchanged: unchanged.length,
      skipped: summary.skipped,
      items: summary.items,
      rename: {
        renamed: renameSuccess.length,
        failed: renameFailures.length,
        errors: renameFailures.map((failure) => ({
          from: formatPath(failure.from, repoRoot),
          to: formatPath(failure.to, repoRoot),
          reason: failure.reason ?? null,
        })),
      },
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    if (summary.skipped.length > 0 || renameFailures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  for (const item of summary.items) {
    const formattedPath = formatPath(item.path, repoRoot);
    if (item.changed) {
      process.stdout.write(`${colors.green("updated")} ${formatId(item.id)} -> ${formattedPath}\n`);
      for (const change of item.changes) {
        process.stdout.write(`    ${formatNote(change)}\n`);
      }
    } else {
      process.stdout.write(
        `${formatNote("no changes")} ${formatId(item.id)} -> ${formattedPath}\n`,
      );
    }
  }

  if (summary.skipped.length > 0) {
    process.stderr.write(
      `${colors.red("skipped")} ${formatNote(`(${summary.skipped.length} files)`)}\n`,
    );
    for (const skipped of summary.skipped) {
      if (skipped.path) {
        process.stderr.write(
          `    ${formatPath(skipped.path, repoRoot)} ${formatNote(skipped.reason)}\n`,
        );
      } else {
        process.stderr.write(`    ${formatId(skipped.id)} ${formatNote(skipped.reason)}\n`);
      }
    }
    process.exitCode = 1;
  }

  if (renameResults.length > 0) {
    if (renameSuccess.length > 0) {
      for (const entry of renameSuccess) {
        process.stdout.write(
          `${colors.green("renamed")} ${formatPath(entry.from, repoRoot)} -> ${formatPath(entry.to, repoRoot)}\n`,
        );
      }
    }
    if (renameFailures.length > 0) {
      process.stderr.write(
        `${colors.red("rename failed")}` +
          ` ${formatNote(`(${renameFailures.length} files)`)}` +
          "\n",
      );
      for (const failure of renameFailures) {
        const reason = failure.reason ? formatNote(failure.reason) : "";
        process.stderr.write(
          `    ${formatPath(failure.from, repoRoot)} -> ${formatPath(failure.to, repoRoot)} ${reason}\n`,
        );
      }
      process.exitCode = 1;
    }
  }

  const updatedCount = changed.length;
  const untouchedCount = unchanged.length;
  process.stdout.write(
    `${formatNote(`completed: ${updatedCount} updated, ${untouchedCount} already normalized`)}\n`,
  );
}

async function handleMove(
  id: string,
  stateArg: string,
  options: {
    dryRun?: boolean;
    output?: string;
    cascade?: string;
    includeBlocked?: boolean;
    force?: boolean;
  },
): Promise<void> {
  if (!allStates.includes(stateArg as State)) {
    process.exitCode = 3;
    throw new Error(`Invalid state '${stateArg}'. Expected one of: ${allStates.join(", ")}`);
  }
  const nextState = stateArg as State;
  const { repoRoot, taskService } = await getTaskCommandContext();
  const cascadeInput = typeof options.cascade === "string" ? options.cascade : "none";
  const cascadeValue = cascadeInput.toLowerCase();
  if (!cascadeModes.includes(cascadeValue as TaskCascadeMode)) {
    process.exitCode = 3;
    throw new Error(`--cascade must be one of: ${cascadeModes.join(", ")}`);
  }
  const cascade = cascadeValue as TaskCascadeMode;
  const includeBlocked = options.includeBlocked === true;
  const force = options.force === true;
  const result = await taskService.move(id, nextState, {
    dryRun: options.dryRun,
    cascade,
    includeBlocked,
    force,
  });
  const warnings = taskService.drainWarnings();
  const outputFormat = parseHumanJsonOutput(options.output);

  if (outputFormat === "json") {
    const fromRelative = path.relative(repoRoot, result.fromPath) || result.fromPath;
    const toRelative = path.relative(repoRoot, result.toPath) || result.toPath;
    const payload = {
      id,
      cascade: result.cascade.mode,
      parent_move: {
        from: result.fromState,
        to: result.toState,
        changed: result.changed,
        from_path: fromRelative,
        to_path: toRelative,
      },
      children: result.cascade.children,
      dryRun: result.dryRun,
      changed_children: result.cascade.changedCount,
      warnings: warningsToJson(warnings, repoRoot),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const fromRelative = path.relative(repoRoot, result.fromPath) || result.fromPath;
  const toRelative = path.relative(repoRoot, result.toPath) || result.toPath;
  const anyChildChanges = result.cascade.changedCount > 0;
  const anyChanges = result.changed || anyChildChanges;

  if (result.dryRun) {
    const parentSummary = result.changed
      ? `${formatState(result.fromState)} -> ${formatState(result.toState)}`
      : `already ${formatState(result.toState)}`;
    const pathSummary = result.changed
      ? `${formatPath(fromRelative)} -> ${formatPath(toRelative)}`
      : formatPath(fromRelative);
    process.stdout.write(
      `${colors.yellow("dry-run")}: ${formatId(id)} ${parentSummary} ${formatNote(pathSummary)}\n`,
    );
  } else if (result.changed) {
    process.stdout.write(
      `${colors.green("moved")}: ${formatId(id)} ${formatState(result.fromState)} -> ${formatState(result.toState)} ${formatNote(
        `${formatPath(fromRelative)} -> ${formatPath(toRelative)}`,
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${formatNote("Parent unchanged")} ${formatId(id)} already in ${formatState(result.toState)}.\n`,
    );
  }

  if (result.cascade.mode !== "none") {
    process.stdout.write(`cascade ${result.cascade.mode}:\n`);
    for (const child of result.cascade.children) {
      if (child.changed) {
        const fromState = child.from ? ` ${formatState(child.from)}` : "";
        const toState = child.to ? ` -> ${formatState(child.to)}` : "";
        process.stdout.write(
          `  ${colors.green("changed")} ${formatId(child.id)}${fromState}${toState} ${formatNote(child.reason)}\n`,
        );
      } else if (child.skipped) {
        process.stdout.write(
          `  ${colors.yellow("skipped")} ${formatId(child.id)} ${formatNote(child.reason)}\n`,
        );
      } else {
        process.stdout.write(
          `  ${formatNote("no-op")} ${formatId(child.id)} ${formatNote(child.reason)}\n`,
        );
      }
    }
  }

  printWarningsHuman(warnings, repoRoot);
  if (!result.dryRun && !anyChanges) {
    process.exitCode = process.exitCode ?? 1;
  }
}

async function handleCleanup(options: {
  olderThan: string;
  dryRun?: boolean;
  output?: string;
}): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { taskService } = await getTaskCommandContext();

  const cleanupService = new CleanupService(taskService);

  const result = await cleanupService.cleanupTasks({
    olderThan: options.olderThan,
    dryRun: options.dryRun === true,
  });

  if (outputFormat === "json") {
    const cleanedCount = result.cleanedTasks.length;
    const payload = {
      dryRun: options.dryRun === true,
      cleanedCount,
      cleanedTasks: result.cleanedTasks,
      summaries: result.summaries,
      errors: result.errors,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  // Human output
  const cleanedCount = result.cleanedTasks.length;
  const prefix = options.dryRun
    ? colors.yellow("dry-run")
    : colors.green(`Cleaned ${cleanedCount} tasks`);
  process.stdout.write(`\n🧹  ${prefix}\n\n`);

  if (cleanedCount > 0) {
    process.stdout.write(`${colors.bold("Removed tasks:")}\n`);
    for (const id of result.cleanedTasks) {
      process.stdout.write(`  • ${formatId(id)}\n`);
    }
    process.stdout.write("\n");
  }

  // Output summaries
  if (result.summaries.changelog.length > 0) {
    process.stdout.write(
      `${colors.bold("📋 Changelog Entries")} (${result.summaries.changelog.length}):\n`,
    );
    for (const entry of result.summaries.changelog) {
      process.stdout.write(`  - ${entry}\n`);
    }
    process.stdout.write("\n");
  }

  if (result.summaries.decisions.length > 0) {
    process.stdout.write(
      `${colors.bold("🧠 Decisions")} (${result.summaries.decisions.length}):\n`,
    );
    for (const entry of result.summaries.decisions) {
      process.stdout.write(`  - ${entry}\n`);
    }
    process.stdout.write("\n");
  }

  if (result.summaries.architecture.length > 0) {
    process.stdout.write(
      `${colors.bold("🏗️  Architecture Insights")} (${result.summaries.architecture.length}):\n`,
    );
    for (const entry of result.summaries.architecture) {
      process.stdout.write(`  - ${entry}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(
    `${formatNote("Tip: copy these summaries into docs such as docs/changelog.md, docs/decisions.md, and docs/architecture.md before you commit.")}\n\n`,
  );

  // Show errors
  if (result.errors.length > 0) {
    process.stderr.write(`${colors.red("❌ Errors")} (${result.errors.length}):\n`);
    for (const error of result.errors) {
      process.stderr.write(`  • ${formatId(error.id)}: ${colors.red(error.error)}\n`);
    }
    process.stderr.write("\n");
  }

  if (result.cleanedTasks.length === 0) {
    process.stdout.write(
      `${formatNote("No tasks were eligible for cleanup older than")} ${options.olderThan}\n`,
    );
  }
}

async function handleDelete(
  id: string,
  options: { dryRun?: boolean; output?: string },
): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { repoRoot, taskService } = await getTaskCommandContext();
  const result = await taskService.deleteTask(id, {
    dryRun: options.dryRun === true,
  });
  const warnings = taskService.drainWarnings();

  const relativeTaskPath = path.relative(repoRoot, result.task.path) || result.task.path;

  if (outputFormat === "json") {
    const payload = {
      dryRun: result.dryRun,
      deleted: result.deleted,
      task: {
        ...result.task,
        path: relativeTaskPath,
      },
      descendants: result.descendants.map((entry) => ({
        ...entry,
        path: path.relative(repoRoot, entry.path) || entry.path,
      })),
      parent_updates: result.parentUpdates.map((update) => ({
        id: update.id,
        role: update.role,
        previous: update.previous,
        next: update.next,
        path: path.relative(repoRoot, update.path) || update.path,
      })),
      warnings: warningsToJson(warnings, repoRoot),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const prefix = result.dryRun ? colors.yellow("dry-run") : colors.green("deleted");
  process.stdout.write(
    `${prefix}: ${formatId(result.task.id)} ${formatNote(formatPath(relativeTaskPath))}\n`,
  );

  if (result.descendants.length > 0) {
    const summary = result.descendants.map((entry) => formatId(entry.id)).join(", ");
    process.stdout.write(`${colors.green("cascade")}: ${summary}\n`);
  }

  if (result.parentUpdates.length > 0) {
    const formatChildren = (values: string[]): string => `[${values.join(", ")}]`;
    process.stdout.write("parent updates:\n");
    for (const update of result.parentUpdates) {
      const changed = JSON.stringify(update.previous) !== JSON.stringify(update.next);
      const label = changed ? colors.green("former") : formatNote("former");
      process.stdout.write(
        `  ${label} ${formatId(update.id)} ${formatNote(
          `${formatChildren(update.previous)} -> ${formatChildren(update.next)}`,
        )}\n`,
      );
    }
  }

  printWarningsHuman(warnings, repoRoot);
}

async function handleAdopt(
  parentId: string,
  childId: string,
  options: {
    dryRun?: boolean;
    before?: string;
    after?: string;
    output?: string;
  },
): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { repoRoot, taskService } = await getTaskCommandContext();
  const result = await taskService.adoptChild(parentId, childId, {
    dryRun: options.dryRun === true,
    before: options.before,
    after: options.after,
  });
  const warnings = taskService.drainWarnings();

  if (outputFormat === "json") {
    const payload = {
      dryRun: result.dryRun,
      changed: result.changed,
      parent: {
        ...result.parent,
        path: path.relative(repoRoot, result.parent.path) || result.parent.path,
      },
      child: {
        ...result.child,
        path: path.relative(repoRoot, result.child.path) || result.child.path,
      },
      updates: result.updates.map((update) => ({
        id: update.id,
        role: update.role,
        previous: update.previous,
        next: update.next,
        path: path.relative(repoRoot, update.path) || update.path,
      })),
      warnings: warningsToJson(warnings, repoRoot),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (result.dryRun) {
    process.stdout.write(
      `${colors.yellow("dry-run")}: adopt ${formatId(childId)} -> ${formatId(parentId)}\n`,
    );
  } else if (result.changed) {
    process.stdout.write(
      `${colors.green("adopted")}: ${formatId(childId)} -> ${formatId(parentId)}\n`,
    );
  } else {
    process.stdout.write(
      `${formatNote("No changes")} ${formatId(childId)} already under ${formatId(parentId)}.\n`,
    );
  }

  if (result.updates.length > 0) {
    const formatChildren = (values: string[]): string => `[${values.join(", ")}]`;
    process.stdout.write("updates:\n");
    for (const update of result.updates) {
      const changed = JSON.stringify(update.previous) !== JSON.stringify(update.next);
      const label = update.role === "target" ? "parent" : "former";
      const prefix = changed ? colors.green(label) : formatNote(label);
      process.stdout.write(
        `  ${prefix} ${formatId(update.id)} ${formatNote(
          `${formatChildren(update.previous)} -> ${formatChildren(update.next)}`,
        )}\n`,
      );
    }
  }

  printWarningsHuman(warnings, repoRoot);
}

async function handleUpdate(
  id: string,
  options: {
    meta?: string[];
    field?: string[][];
    unset?: string[];
    dryRun?: boolean;
    output?: string;
  },
): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { repoRoot, taskService } = await getTaskCommandContext();

  const metaAssignments = Array.isArray(options.meta) ? options.meta : [];
  const fieldSpecs = Array.isArray(options.field) ? options.field : [];
  const unsetRaw = Array.isArray(options.unset) ? options.unset : [];

  const metaPatch = parseMetaAssignments(metaAssignments);
  const unsetKeys = parseUnsetKeys(unsetRaw);

  for (const key of Object.keys(metaPatch) as UpdateMetaField[]) {
    if (unsetKeys.includes(key)) {
      throw new Error(`Field '${key}' cannot be set and unset in the same command`);
    }
  }

  const sections = await parseFieldSpecs(fieldSpecs, repoRoot);

  const result = await taskService.update({
    id,
    metaPatch,
    unset: unsetKeys,
    sections,
    dryRun: options.dryRun === true,
  });

  const warnings = taskService.drainWarnings();

  if (outputFormat === "json") {
    const payload = {
      id,
      dryRun: result.dryRun,
      changed: result.changed,
      from: result.fromPath,
      to: result.toPath,
      meta: result.meta,
      metaChanges: result.metaChanges,
      sectionChanges: result.sectionChanges,
      warnings: warningsToJson(warnings, repoRoot),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (!result.changed) {
    process.stdout.write(`${formatNote("No changes")} ${formatId(id)} unchanged.\n`);
    printWarningsHuman(warnings, repoRoot);
    return;
  }

  const metaSummary = dedupe(result.metaChanges);
  const sectionSummary = result.sectionChanges
    .filter((entry) => entry.changed)
    .map((entry) => entry.id);
  const parts: string[] = [];
  if (metaSummary.length > 0) {
    parts.push(`meta=[${metaSummary.join(",")}]`);
  }
  if (sectionSummary.length > 0) {
    parts.push(`sections=[${sectionSummary.join(",")}]`);
  }
  if (result.fromPath !== result.toPath) {
    const fromRelative = path.relative(repoRoot, result.fromPath) || result.fromPath;
    const toRelative = path.relative(repoRoot, result.toPath) || result.toPath;
    parts.push(`path=${fromRelative}->${toRelative}`);
  }

  const prefix = result.dryRun ? colors.yellow("dry-run") : colors.green("updated");
  const summary = parts.length > 0 ? ` ${formatNote(parts.join(" "))}` : "";
  process.stdout.write(`${prefix} ${formatId(id)}${summary}\n`);
  printWarningsHuman(warnings, repoRoot);
}

function parseMetaAssignments(assignments: string[]): Partial<Pick<TaskMeta, UpdateMetaField>> {
  const patch: Partial<Pick<TaskMeta, UpdateMetaField>> = {};
  for (const assignment of assignments) {
    const [rawKey, ...valueParts] = assignment.split("=");
    if (!rawKey || valueParts.length === 0) {
      throw new Error(`Invalid --meta value '${assignment}'. Use key=value syntax.`);
    }
    const key = rawKey.trim() as UpdateMetaField;
    if (!UPDATE_ALLOWED_META.has(key)) {
      throw new Error(
        `Field '${key}' cannot be updated. Allowed fields: ${UPDATE_META_FIELDS.join(", ")}`,
      );
    }
    const valueRaw = valueParts.join("=");
    (patch as Record<string, unknown>)[key] = parseMetaValue(key, valueRaw);
  }
  return patch;
}

function parseMetaValue(key: UpdateMetaField, raw: string): TaskMeta[UpdateMetaField] {
  switch (key) {
    case "title": {
      const value = raw.trim();
      if (value.length === 0) {
        throw new Error("title cannot be empty");
      }
      return value as TaskMeta["title"];
    }
    case "priority": {
      const value = raw.trim().toLowerCase();
      if (!priorityOrder.includes(value as (typeof priorityOrder)[number])) {
        throw new Error(`priority must be one of: ${priorityOrder.join(", ")}`);
      }
      return value as TaskMeta["priority"];
    }
    case "parent": {
      const value = raw.trim();
      if (value.length === 0) {
        throw new Error("parent cannot be empty. Use --unset parent to remove it.");
      }
      return value as TaskMeta["parent"];
    }
    case "assignees": {
      return parseJsonStringArray(raw, "assignees") as TaskMeta["assignees"];
    }
    case "labels": {
      return parseJsonStringArray(raw, "labels") as TaskMeta["labels"];
    }
    case "state": {
      const value = raw.trim().toLowerCase();
      if (!allStates.includes(value as State)) {
        throw new Error(`state must be one of: ${allStates.join(", ")}`);
      }
      return value as TaskMeta["state"];
    }
    case "blocked": {
      return raw as TaskMeta["blocked"];
    }
    case "links": {
      return parseLinks(raw);
    }
    case "size": {
      return parseDispatchEnumValue(raw, "size", sizeOrder) as TaskMeta["size"];
    }
    case "ambiguity": {
      return parseDispatchEnumValue(raw, "ambiguity", ambiguityOrder) as TaskMeta["ambiguity"];
    }
    case "executor": {
      return parseDispatchEnumValue(raw, "executor", executorOrder) as TaskMeta["executor"];
    }
    case "isolation": {
      return parseDispatchEnumValue(raw, "isolation", isolationOrder) as TaskMeta["isolation"];
    }
    case "touches": {
      return parseJsonStringArray(raw, "touches") as TaskMeta["touches"];
    }
    case "depends_on": {
      return parseTaskIdArray(raw, "depends_on") as TaskMeta["depends_on"];
    }
    case "blocks": {
      return parseTaskIdArray(raw, "blocks") as TaskMeta["blocks"];
    }
    default: {
      throw new Error(`Unhandled meta field '${key}'`);
    }
  }
}

function parseUnsetKeys(values: string[]): UpdateMetaField[] {
  const unset: UpdateMetaField[] = [];
  for (const value of values) {
    const key = value.trim() as UpdateMetaField;
    if (!UPDATE_ALLOWED_META.has(key) || !UNSET_ALLOWED_META.has(key)) {
      throw new Error(
        `Field '${key}' cannot be unset. Allowed fields: ${Array.from(UNSET_ALLOWED_META).join(", ")}`,
      );
    }
    if (!unset.includes(key)) {
      unset.push(key);
    }
  }
  return unset;
}

async function parseFieldSpecs(
  specs: string[][],
  repoRoot: string,
): Promise<Partial<Record<SectionId, string>>> {
  const updates: Partial<Record<SectionId, string>> = {};
  for (const entry of specs) {
    const tokens = Array.isArray(entry) ? entry : [entry];
    if (tokens.length < 2) {
      throw new Error("--field requires <section_id> and <text|@file>");
    }
    const [sectionRaw, ...valueTokens] = tokens;
    const sectionId = sectionRaw.trim();
    if (!isSectionId(sectionId)) {
      throw new Error(
        `Unknown section '${sectionId}'. Expected one of: ${orderedSectionIds.join(", ")}`,
      );
    }
    if (updates[sectionId]) {
      throw new Error(`Section '${sectionId}' provided multiple times`);
    }
    const rawValue = valueTokens.join(" ");
    if (rawValue.trim().length === 0) {
      throw new Error(`--field ${sectionId} requires non-empty content`);
    }
    updates[sectionId] = await loadFieldValue(rawValue, repoRoot);
  }
  return updates;
}

async function loadFieldValue(raw: string, repoRoot: string): Promise<string> {
  if (raw.startsWith("@")) {
    const filePath = raw.slice(1);
    if (filePath.length === 0) {
      throw new Error("--field @file requires a file path");
    }
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
    try {
      return await fs.readFile(resolved, "utf8");
    } catch (error) {
      throw new Error(`Unable to read file '${filePath}': ${(error as Error).message}`);
    }
  }
  return raw;
}

function parseJsonStringArray(raw: string, field: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error(`${field} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON array of strings`);
  }
  const values: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new Error(`${field} must be a JSON array of strings`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`${field} entries must be non-empty strings`);
    }
    values.push(trimmed);
  }
  return values;
}

function parseDispatchEnumValue<T extends string>(
  raw: string,
  field: string,
  allowed: readonly T[],
): T {
  const normalized = raw.trim().toLowerCase();
  if (!allowed.includes(normalized as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return normalized as T;
}

function parseTaskIdArray(raw: string, field: string): string[] {
  const values = parseJsonStringArray(raw, field);
  const normalized = Array.from(
    new Set(
      values.map((value) => {
        const trimmed = value.trim().toLowerCase();
        if (!TASK_ID_REGEX.test(trimmed)) {
          throw new Error(`${field} entries must match ${TASK_ID_REGEX}. Invalid: '${value}'`);
        }
        return trimmed;
      }),
    ),
  );
  return normalized;
}

function parseLinks(raw: string): TaskMeta["links"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error("links must be a JSON array of objects");
  }
  try {
    return linkSchema.array().parse(parsed);
  } catch (error) {
    throw new Error(`Invalid links array: ${(error as Error).message}`);
  }
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

async function handleComplete(
  id: string,
  options: {
    dryRun?: boolean;
    output?: string;
    commit?: string;
    closeGh?: string | boolean;
  },
): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { repoRoot, taskService } = await getTaskCommandContext();

  if (options.commit !== undefined) {
    process.stderr.write(
      "`taskplain complete --commit` has been removed. Use conventional commits with task references.\n",
    );
    process.exitCode = 5;
    return;
  }

  if (options.closeGh !== undefined) {
    process.stderr.write(
      "`--close-gh` now belongs to conventional commit footers. Use `Closes #<n>` in your commit message.\n",
    );
    process.exitCode = 5;
    return;
  }

  const result = await taskService.complete(id, {
    dryRun: options.dryRun,
  });
  const warnings = taskService.drainWarnings();
  const changedState = !result.dryRun && result.changed;
  const noOp = !result.changed;

  if (outputFormat === "json") {
    const payload = {
      id,
      state: result.meta.state,
      from: result.fromPath,
      to: result.toPath,
      dryRun: result.dryRun,
      changed: result.changed,
      changed_state: changedState,
      no_op: noOp,
      warnings: warningsToJson(warnings, repoRoot),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (noOp) {
    process.stdout.write(
      `${formatNote("No change")} ${formatId(id)} already in ${formatState("done")}.\n`,
    );
    printWarningsHuman(warnings, repoRoot);
    return;
  }

  if (result.dryRun) {
    const toRelative = path.relative(repoRoot, result.toPath) || result.toPath;
    process.stdout.write(
      `${colors.yellow("dry-run")}: complete ${formatId(id)} -> ${formatPath(toRelative)}\n`,
    );
    printWarningsHuman(warnings, repoRoot);
    return;
  }

  const toRelative = path.relative(repoRoot, result.toPath) || result.toPath;
  process.stdout.write(
    `${colors.green("completed")} ${formatId(id)} -> ${formatPath(toRelative)}\n`,
  );
  printWarningsHuman(warnings, repoRoot);
}

async function handleList(options: {
  state?: string;
  priority?: string;
  parent?: string;
  search?: string;
  label?: string;
  size?: string;
  ambiguity?: string;
  executor?: string;
  isolation?: string;
  blocked?: boolean;
  unblocked?: boolean;
  open?: boolean;
  states?: string;
  output?: string;
}): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { taskService } = await getTaskCommandContext();
  const query = await taskService.query();

  if (options.blocked && options.unblocked) {
    throw new Error("--blocked cannot be combined with --unblocked");
  }

  if (options.state && !allStates.includes(options.state as State)) {
    throw new Error(`Invalid state '${options.state}'. Expected one of: ${allStates.join(", ")}`);
  }

  if (!options.open && options.states) {
    throw new Error("--states can only be used together with --open");
  }

  if (options.open && (options.blocked || options.unblocked)) {
    throw new Error("--blocked/--unblocked cannot be combined with --open");
  }

  const priorityFilter = parsePriorityOption(options.priority);
  const sizeFilter = parseEnumListOption(options.size, sizeOrder, "--size");
  const ambiguityFilter = parseEnumListOption(options.ambiguity, ambiguityOrder, "--ambiguity");
  const executorFilter = parseEnumListOption(options.executor, executorOrder, "--executor");
  const isolationFilter = parseEnumListOption(options.isolation, isolationOrder, "--isolation");
  const blockedFilter =
    options.blocked === true ? true : options.unblocked === true ? false : undefined;
  const openOnly = blockedFilter !== undefined && !options.state;

  if (options.open) {
    const states = parseOpenStates(options.states);
    const allowed = new Set<State>(states);
    const openItems = query
      .list({
        priority: priorityFilter,
        parent: options.parent,
        search: options.search,
        label: options.label,
        size: sizeFilter,
        ambiguity: ambiguityFilter,
        executor: executorFilter,
        isolation: isolationFilter,
      })
      .filter((item) => allowed.has(item.state));

    if (outputFormat === "json") {
      process.stdout.write(`${JSON.stringify({ items: openItems }, null, 2)}\n`);
      return;
    }

    return renderListTable(openItems);
  }

  const items = query.list({
    state: options.state as State | undefined,
    priority: priorityFilter,
    parent: options.parent,
    search: options.search,
    label: options.label,
    size: sizeFilter,
    ambiguity: ambiguityFilter,
    executor: executorFilter,
    isolation: isolationFilter,
    blocked: blockedFilter,
    openStatesOnly: openOnly,
  });

  if (outputFormat === "json") {
    process.stdout.write(`${JSON.stringify({ items }, null, 2)}\n`);
    return;
  }

  if (items.length === 0) {
    process.stdout.write(`${formatNote("No tasks match the provided filters.")}\n`);
    return;
  }

  renderListTable(items);
}

// --- Web server deterministic port allocation helpers ---
function hashProjectPath(projectPath: string): number {
  // 32-bit FNV-1a hash
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectPath.length; i++) {
    hash ^= projectPath.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0xffffffff;
}

function basePortForProject(projectPath: string): number {
  const base = 8000;
  const span = 1000; // 8000-8999
  const hash = hashProjectPath(projectPath);
  return base + (hash % span);
}

async function fetchServerInfo(port: number): Promise<{ projectPath: string } | null> {
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { projectPath?: unknown };
    if (typeof json.projectPath === "string") {
      return { projectPath: json.projectPath };
    }
    return null;
  } catch {
    return null;
  }
}

async function isPortListening(port: number): Promise<boolean> {
  const net = await import("node:net");
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(250);
    const finish = (value: boolean) => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        finish(false);
      } else {
        finish(true);
      }
    });
    socket.connect({ port, host: "127.0.0.1" });
  });
}

async function decidePortAction(
  repoRoot: string,
  userPort?: number,
): Promise<{ action: "reuse" | "start"; port: number }> {
  const maxAttempts = 100;

  const sameProject = (info: { projectPath: string } | null): boolean =>
    Boolean(info && path.resolve(info.projectPath) === path.resolve(repoRoot));

  // Seed with user-specified port or hashed base port
  const base = basePortForProject(repoRoot);
  const startPort = userPort ?? base;

  // Probe starting at startPort and increment on collisions
  let port = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    const info = await fetchServerInfo(port);
    if (sameProject(info)) {
      return { action: "reuse", port };
    }
    if (info === null) {
      // Not a Taskplain server; check if something is listening
      const busy = await isPortListening(port);
      if (!busy) {
        return { action: "start", port };
      }
      // Busy by non-Taskplain process → increment
    }
    port += 1;
  }
  // Fallback: if we somehow didn't find a slot, use the last probed port for start
  return { action: "start", port };
}

async function handleWeb(options: { port?: string; open?: boolean }): Promise<void> {
  const repoRoot = process.cwd();
  const userPort = options.port ? parseOptionalPositiveInteger(options.port, "--port") : undefined;
  const { taskService } = await setupTaskService(repoRoot);
  const webService = new WebServerService({
    repoRoot,
    taskService,
    onWarnings: (warnings) => printWarningsHuman(warnings, repoRoot),
  });

  const decision = await decidePortAction(repoRoot, userPort);

  if (decision.action === "reuse") {
    const url = `http://127.0.0.1:${decision.port}/`;
    process.stdout.write(`Reusing existing Taskplain web server at ${url}\n`);
    if (options.open === true) {
      try {
        await open(url);
      } catch (error) {
        process.stderr.write(`Failed to open browser: ${(error as Error).message}\n`);
      }
    }
    return;
  }

  try {
    await webService.run({
      port: decision.port,
      openBrowser: options.open === true,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") {
      if (userPort) {
        throw new Error(`Port ${userPort} is already in use. Choose a different port with --port.`);
      }
      throw new Error(
        `Port ${decision.port} is already in use. Try again or specify a different port with --port.`,
      );
    }
    throw error;
  }
}

async function handleNext(
  options: {
    count?: string;
    parallelize?: string;
    kinds?: string;
    executor?: string;
    maxSize?: string;
    ambiguity?: string;
    isolation?: string;
    parent?: string;
    output?: string;
    includeBlocked?: boolean;
  },
  command?: Command,
): Promise<void> {
  const count = parsePositiveInteger(options.count ?? "1", "--count");
  const parallelize = parseOptionalPositiveInteger(options.parallelize, "--parallelize");
  const kindSource = command?.getOptionValueSource?.("kinds") ?? null;
  const userProvidedKinds = kindSource === "cli";
  const rawKinds = options.kinds ?? (userProvidedKinds ? undefined : "task");
  const kindValues: Kind[] = rawKinds
    ? (parseEnumListOption<Kind>(rawKinds, kindOrder, "--kinds") ?? (["task"] as Kind[]))
    : (["task"] as Kind[]);
  const kinds = new Set<Kind>(kindValues);
  if (kinds.size === 0) {
    kinds.add("task");
  }

  const executorPreference = parseSingleEnumOption<Executor>(
    options.executor,
    executorOrder,
    "--executor",
  );
  const maxSize = parseSingleEnumOption<Size>(options.maxSize, sizeOrder, "--max-size");
  const ambiguityValues = parseEnumListOption<Ambiguity>(
    options.ambiguity,
    ambiguityOrder,
    "--ambiguity",
  );
  const ambiguityFilter =
    ambiguityValues && ambiguityValues.length > 0 ? new Set<Ambiguity>(ambiguityValues) : undefined;
  const isolationValues = parseEnumListOption<Isolation>(
    options.isolation,
    isolationOrder,
    "--isolation",
  );
  const isolationFilter =
    isolationValues && isolationValues.length > 0 ? new Set<Isolation>(isolationValues) : undefined;
  const parentFilter = options.parent ? options.parent.trim() : undefined;
  const outputMode =
    parseSingleEnumOption<"ids" | "json" | "human">(
      options.output,
      ["ids", "json", "human"],
      "--output",
    ) ?? "ids";

  if (parallelize !== undefined && parallelize < 1) {
    throw new Error("--parallelize must be a positive integer");
  }

  const includeBlocked = options.includeBlocked === true;

  const { taskService } = await getTaskCommandContext();
  const tasks = await taskService.listAllTasks();
  const nextService = new NextService(tasks);
  const result = nextService.evaluate({
    count,
    kinds,
    executorPreference,
    maxSize,
    ambiguityFilter,
    isolationFilter,
    parent: parentFilter,
    parallelize,
    includeRootWithoutKind: !userProvidedKinds,
    includeBlocked,
  });

  const rankedIds = result.candidates.map((candidate) => candidate.doc.meta.id);
  const rankById = new Map<string, number>();
  rankedIds.forEach((id, index) => {
    rankById.set(id, index + 1);
  });

  if (outputMode === "ids") {
    if (result.selected.length === 0) {
      return;
    }
    const ids = result.selected.map((candidate) => candidate.doc.meta.id).join("\n");
    process.stdout.write(`${ids}\n`);
    return;
  }

  const formatCandidate = (candidate: RankedCandidate, rank: number) => {
    const { doc, score, rootEpicId, epicInFlight, touches } = candidate;
    return {
      rank,
      id: doc.meta.id,
      title: doc.meta.title,
      kind: doc.meta.kind,
      state: doc.meta.state,
      priority: doc.meta.priority,
      size: doc.meta.size,
      executor: doc.meta.executor,
      ambiguity: doc.meta.ambiguity,
      isolation: doc.meta.isolation,
      epic_root: rootEpicId ?? null,
      epic_in_flight: epicInFlight,
      touches,
      blocked: doc.meta.blocked ?? null,
      score_breakdown: score,
    };
  };

  if (outputMode === "json") {
    const parameters = {
      count,
      parallelize: parallelize ?? null,
      kinds: Array.from(kinds),
      executor: executorPreference ?? null,
      max_size: maxSize ?? null,
      ambiguity: ambiguityFilter ? Array.from(ambiguityFilter) : null,
      isolation: isolationFilter ? Array.from(isolationFilter) : null,
      parent: parentFilter ?? null,
      include_blocked: includeBlocked,
    };
    const candidates = result.candidates.map((candidate, index) =>
      formatCandidate(candidate, index + 1),
    );
    const selected = result.selected.map((candidate) => {
      const rank = rankById.get(candidate.doc.meta.id) ?? null;
      return {
        ...formatCandidate(candidate, rank ?? 0),
        rank,
      };
    });
    const skipped = result.skippedDueToConflicts.map(({ candidate, conflictsWith }) => ({
      id: candidate.doc.meta.id,
      rank: rankById.get(candidate.doc.meta.id) ?? null,
      conflicts_with: conflictsWith,
    }));

    const payload = {
      rules_version: "v1",
      parameters,
      rationale:
        "priority → epic_in_flight → size → executor_fit → ambiguity → isolation → updated_at",
      candidates,
      selected,
      skipped_due_to_conflicts: skipped,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const rows: TableCell[][] = [];
  const selectedIds = new Set(result.selected.map((candidate) => candidate.doc.meta.id));
  for (const [index, candidate] of result.candidates.entries()) {
    const doc = candidate.doc;
    const rank = index + 1;
    const touches = candidate.touches.length > 0 ? candidate.touches.join(", ") : "-";
    const epicLabel = candidate.rootEpicId ?? "-";
    const blockedCell: TableCell =
      doc.meta.blocked !== undefined
        ? { text: formatBlockedBadge(doc.meta.blocked) }
        : { text: "-", color: formatNote };
    rows.push([
      { text: String(rank), color: formatNote },
      { text: doc.meta.id, color: formatId },
      {
        text: doc.meta.priority.toUpperCase(),
        color: (value) => formatPriority(doc.meta.priority, value),
      },
      { text: (doc.meta.size ?? "medium").toUpperCase(), color: formatNote },
      {
        text: (doc.meta.executor ?? "standard").toUpperCase(),
        color: formatNote,
      },
      { text: (doc.meta.ambiguity ?? "low").toUpperCase(), color: formatNote },
      {
        text: (doc.meta.isolation ?? "module").toUpperCase(),
        color: formatNote,
      },
      { text: epicLabel, color: formatNote },
      blockedCell,
      { text: touches, color: formatNote },
      selectedIds.has(doc.meta.id)
        ? { text: "✓", color: colors.green }
        : { text: "", color: formatNote },
    ]);
  }

  const headers: TableCell[] = [
    { text: "RANK", color: colors.bold },
    { text: "ID", color: colors.bold },
    { text: "PRIO", color: colors.bold },
    { text: "SIZE", color: colors.bold },
    { text: "EXEC", color: colors.bold },
    { text: "AMB", color: colors.bold },
    { text: "ISO", color: colors.bold },
    { text: "EPIC", color: colors.bold },
    { text: "BLOCKED", color: colors.bold },
    { text: "TOUCHES", color: colors.bold },
    { text: "SEL", color: colors.bold },
  ];

  if (rows.length === 0) {
    process.stdout.write(`${formatNote("No ready tasks match the provided filters.")}\n`);
  } else {
    const table = renderTable(headers, rows, {
      flexColumns: [1, 8, 9],
      minWidths: [4, 20, 6, 6, 6, 6, 6, 12, 12, 18, 3],
      maxWidths: [6, 32, 6, 6, 8, 6, 6, 18, 24, 24, 3],
    });
    process.stdout.write(table);
  }

  if (result.skippedDueToConflicts.length > 0) {
    process.stdout.write(`\n${formatHeading("Conflicts")}\n`);
    for (const entry of result.skippedDueToConflicts) {
      const conflictList = entry.conflictsWith.join(", ");
      process.stdout.write(
        `  ${formatId(entry.candidate.doc.meta.id)} ${formatNote(`conflicts with [${conflictList}]`)}\n`,
      );
    }
  }
}

function renderListTable(items: TaskListItem[]): void {
  const headers: TableCell[] = [
    { text: "ID", color: colors.bold },
    { text: "TITLE", color: colors.bold },
    { text: "KIND", color: colors.bold },
    { text: "STATE", color: colors.bold },
    { text: "PRIO", color: colors.bold },
  ];

  const rows: TableCell[][] = items.map((item) => [
    { text: item.id, color: formatId },
    buildTitleCell(item),
    buildKindCell(item.kind),
    {
      text: item.state.toUpperCase(),
      color: (value) => formatState(item.state, value),
    },
    {
      text: item.priority.toUpperCase(),
      color: (value) => formatPriority(item.priority, value),
    },
  ]);

  const table = renderTable(headers, rows, {
    flexColumns: [1],
    minWidths: [8, 24, 8, 10, 5],
  });
  process.stdout.write(table);
}

function buildTitleCell(item: TaskListItem): TableCell {
  if (item.blocked === undefined) {
    return { text: item.title };
  }

  const note = (item.blocked ?? "").trim();
  const plainBadge = note.length > 0 ? `[BLOCKED] ${note}` : "[BLOCKED]";
  const plainText = `${item.title} ${plainBadge}`;

  return {
    text: plainText,
    color: (value) => value.replace(` ${plainBadge}`, ` ${formatBlockedBadge(item.blocked)}`),
  };
}

function buildKindCell(kind: Kind): TableCell {
  const badge = getKindBadge(kind);
  return {
    text: badge,
    color: (value) => formatKindTagWithDisplay(kind, value),
  };
}

async function handlePickup(
  id: string,
  options: { dryRun?: boolean; includeBlocked?: boolean; output?: string },
): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const dryRun = options.dryRun === true;
  const includeBlocked = options.includeBlocked === true;

  const { repoRoot, taskService } = await getTaskCommandContext();
  const pickupService = new PickupService(taskService);
  const result = await pickupService.execute({
    id,
    dryRun,
    includeBlockedChildren: includeBlocked,
  });
  const warnings = taskService.drainWarnings();

  if (outputFormat === "json") {
    const moves = result.moves.map((move) => ({
      id: move.id,
      from_state: move.fromState,
      to_state: move.toState,
      changed: move.changed,
      reason: move.reason ?? null,
      from_path: toRelativePath(repoRoot, move.fromPath),
      to_path: toRelativePath(repoRoot, move.toPath),
    }));

    const ancestors = result.ancestors.map((doc) => ({
      id: doc.meta.id,
      path: toRelativePath(repoRoot, doc.path),
      meta: doc.meta,
      body: doc.body,
    }));

    const target = {
      id: result.target.meta.id,
      path: toRelativePath(repoRoot, result.target.path),
      meta: result.target.meta,
      body: result.target.body,
    };

    const candidates = result.children.candidates.map((candidate, index) =>
      pickupCandidateToJson(candidate, index + 1),
    );
    const rankById = new Map(candidates.map((entry) => [entry.id, entry.rank]));
    const selected = result.children.selected.map((candidate) => {
      const rank = rankById.get(candidate.doc.meta.id) ?? null;
      return pickupCandidateToJson(candidate, rank === null ? null : Number(rank));
    });

    const notReady = result.children.notReady.map((entry) => ({
      id: entry.doc.meta.id,
      title: entry.doc.meta.title,
      kind: entry.doc.meta.kind,
      state: entry.doc.meta.state,
      priority: entry.doc.meta.priority,
      reason: entry.reason,
    }));

    const payload = {
      id,
      dry_run: result.dryRun,
      moves,
      context: {
        target,
        ancestors,
        children: {
          include_blocked: result.children.includeBlocked,
          total_direct_children: result.children.totalDirectChildren,
          candidates,
          selected,
          not_ready: notReady,
        },
      },
      warnings: warningsToJson(warnings, repoRoot),
    };

    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const target = result.target;
  process.stdout.write(
    `${formatHeading("Pickup")} ${formatId(target.meta.id)} ${formatKindTag(target.meta.kind)} ${formatNote(
      target.meta.title,
    )}\n`,
  );
  process.stdout.write(
    `state: ${formatState(target.meta.state)}   priority: ${formatPriorityBadge(
      target.meta.priority,
    )}\n`,
  );
  process.stdout.write(`dry-run: ${formatNote(dryRun ? "yes" : "no")}\n\n`);

  process.stdout.write(`${formatHeading("Moves")}\n`);
  for (const move of result.moves) {
    const arrow = `${formatState(move.fromState)} → ${formatState(move.toState)}`;
    const status = move.changed
      ? dryRun
        ? formatNote("preview")
        : colors.green("applied")
      : formatNote(describeMoveReason(move.reason));
    const pathSummary =
      move.fromPath === move.toPath
        ? formatPath(move.fromPath, repoRoot)
        : `${formatPath(move.fromPath, repoRoot)} → ${formatPath(move.toPath, repoRoot)}`;
    process.stdout.write(`- ${formatId(move.id)} ${arrow} ${status} ${pathSummary}\n`);
  }

  if (result.ancestors.length > 0) {
    process.stdout.write(`\n${formatHeading("Ancestor Chain")}\n`);
    for (const ancestor of result.ancestors) {
      process.stdout.write("\n");
      renderPickupDoc("Ancestor", ancestor, repoRoot);
    }
  }

  process.stdout.write(`\n${formatHeading("Target")}\n`);
  renderPickupDoc("Target", target, repoRoot);

  const candidateRows = result.children.candidates;
  const selectedIds = new Set(result.children.selected.map((candidate) => candidate.doc.meta.id));

  process.stdout.write(`\n${formatHeading("Ready Child Candidates")}\n`);
  process.stdout.write(
    `${formatNote("include-blocked:")} ${formatNote(result.children.includeBlocked ? "yes" : "no")}\n`,
  );

  if (candidateRows.length === 0) {
    process.stdout.write(`${formatNote("No ready direct children.")}\n`);
  } else {
    const headers: TableCell[] = [
      { text: "RANK", color: colors.bold },
      { text: "ID", color: colors.bold },
      { text: "KIND", color: colors.bold },
      { text: "STATE", color: colors.bold },
      { text: "PRIO", color: colors.bold },
      { text: "BLOCKED", color: colors.bold },
      { text: "TOUCHES", color: colors.bold },
      { text: "SEL", color: colors.bold },
    ];
    const rows: TableCell[][] = candidateRows.map((candidate, index) => {
      const doc = candidate.doc;
      const rank = index + 1;
      const blockedCell: TableCell =
        doc.meta.blocked !== undefined
          ? {
              text: doc.meta.blocked ?? "",
              color: () => formatBlockedBadge(doc.meta.blocked),
            }
          : { text: "-", color: formatNote };
      return [
        { text: String(rank), color: formatNote },
        { text: doc.meta.id, color: formatId },
        { text: doc.meta.kind.toUpperCase(), color: formatNote },
        {
          text: doc.meta.state.toUpperCase(),
          color: (value) => formatState(doc.meta.state, value),
        },
        {
          text: doc.meta.priority.toUpperCase(),
          color: (value) => formatPriority(doc.meta.priority, value),
        },
        blockedCell,
        {
          text: candidate.touches.length > 0 ? candidate.touches.join(", ") : "-",
          color: formatNote,
        },
        selectedIds.has(doc.meta.id)
          ? { text: "✓", color: colors.green }
          : { text: "", color: formatNote },
      ];
    });

    const table = renderTable(headers, rows, {
      flexColumns: [1, 6],
      minWidths: [4, 20, 6, 10, 8, 14, 18, 3],
      maxWidths: [6, 30, 8, 12, 10, 24, 28, 3],
    });
    process.stdout.write(table);
  }

  if (result.children.notReady.length > 0) {
    process.stdout.write(`\n${formatHeading("Not Ready Children")}\n`);
    for (const entry of result.children.notReady) {
      const doc = entry.doc;
      const reason = describeNotReadyReason(entry.reason);
      process.stdout.write(
        `- ${formatId(doc.meta.id)} ${formatKindTag(doc.meta.kind)} ${formatState(doc.meta.state)} ${formatNote(
          reason,
        )}\n`,
      );
    }
  }

  process.stdout.write(
    `\n${formatNote("direct children:")} ${result.children.totalDirectChildren}\n`,
  );

  printWarningsHuman(warnings, repoRoot);
}

function renderPickupDoc(label: string, doc: TaskDoc, repoRoot: string): void {
  process.stdout.write(
    `${colors.bold(label)} ${formatId(doc.meta.id)} ${formatKindTag(doc.meta.kind)} ${formatNote(
      doc.meta.title,
    )}\n`,
  );
  process.stdout.write(`${formatNote("path")}: ${formatPath(doc.path, repoRoot)}\n`);
  for (const [key, value] of Object.entries(doc.meta)) {
    if (key === "id") continue;
    process.stdout.write(`${formatHeading(key)}: ${formatValue(value)}\n`);
  }
  process.stdout.write(`${formatNote("\n---\n")}`);
  if (doc.body.trim().length > 0) {
    process.stdout.write(`${doc.body.trimEnd()}\n`);
  }
  process.stdout.write("\n");
}

function pickupCandidateToJson(
  candidate: RankedCandidate,
  rank: number | null,
): Record<string, unknown> {
  const doc = candidate.doc;
  return {
    rank,
    id: doc.meta.id,
    title: doc.meta.title,
    kind: doc.meta.kind,
    state: doc.meta.state,
    priority: doc.meta.priority,
    size: doc.meta.size,
    executor: doc.meta.executor,
    ambiguity: doc.meta.ambiguity,
    isolation: doc.meta.isolation,
    touches: candidate.touches,
    blocked: doc.meta.blocked ?? null,
    score_breakdown: candidate.score,
  };
}

function describeMoveReason(reason?: string): string {
  switch (reason) {
    case "terminal_state":
      return "terminal state";
    case "already_active":
      return "already active";
    default:
      return reason ?? "no change";
  }
}

function describeNotReadyReason(reason: string): string {
  if (reason.startsWith("blocked:")) {
    return reason.replace("blocked:", "blocked ");
  }
  return reason.replace(/_/g, " ");
}

function toRelativePath(repoRoot: string, absolutePath: string): string {
  const relative = path.relative(repoRoot, absolutePath);
  return relative.length === 0 ? absolutePath : relative;
}

async function handleShow(id: string, options: { output?: string; lines?: string }): Promise<void> {
  const outputFormat = parseHumanJsonOutput(options.output);
  const { taskService } = await getTaskCommandContext();
  const query = await taskService.query();
  const doc = query.getTask(id);
  if (!doc) {
    throw new Error(`Task with id '${id}' not found`);
  }

  const lines = options.lines ? Math.max(parseInt(options.lines, 10), 0) : 20;

  if (outputFormat === "json") {
    process.stdout.write(`${JSON.stringify({ meta: doc.meta, body: doc.body }, null, 2)}\n`);
    return;
  }

  const metaEntries = Object.entries(doc.meta);
  for (const [key, value] of metaEntries) {
    process.stdout.write(`${formatHeading(key)}: ${formatValue(value)}\n`);
  }

  process.stdout.write(`${formatNote("\n---\n")}`);
  const bodyLines = doc.body.split(/\r?\n/).slice(0, lines);
  for (const line of bodyLines) {
    process.stdout.write(`${line}\n`);
  }
}

async function handleTree(
  id: string | undefined,
  options: {
    output?: string;
    open?: boolean;
    states?: string;
    priority?: string;
    label?: string;
    search?: string;
    readyOnly?: boolean;
    showId?: boolean;
    showPath?: boolean;
    relativePath?: boolean;
    compact?: boolean;
    noColor?: boolean;
  },
): Promise<void> {
  const previousColorMode = getColorMode();
  const enforceNoColor = options.noColor === true;
  if (enforceNoColor) {
    setColorMode("never");
  }

  try {
    const { repoRoot, taskService } = await getTaskCommandContext();
    const query = await taskService.query();
    const outputFormat = parseHumanJsonOutput(options.output);

    if (!options.open && options.states) {
      throw new Error("--states can only be used together with --open");
    }

    if (!options.open && (options.priority || options.label || options.search)) {
      throw new Error("Filters (--priority, --label, --search) require --open");
    }

    if (options.readyOnly && !options.open) {
      throw new Error("--ready-only is only supported with --open");
    }

    const priorityFilter = parsePriorityOption(options.priority);
    const showId = options.showId === true;
    const showPath = options.showPath === true;
    const relativePath = options.relativePath === true;
    const compact = options.compact === true;

    if (relativePath && !showPath) {
      throw new Error("--relative-path requires --show-path");
    }

    if (options.open) {
      if (id) {
        throw new Error("--open cannot be combined with an explicit id");
      }
      const states = parseOpenStates(options.states);
      const openTree = query.buildOpenTree(states, {
        priority: priorityFilter,
        label: options.label,
        search: options.search,
        readyOnly: options.readyOnly === true,
      });
      if (outputFormat === "json") {
        process.stdout.write(`${JSON.stringify({ states: openTree }, null, 2)}\n`);
        return;
      }
      printOpenTree(openTree, {
        showId,
        showPath,
        relativePath,
        compact,
        repoRoot,
      });
      return;
    }

    const tree = query.buildTree(id);

    if (outputFormat === "json") {
      process.stdout.write(`${JSON.stringify({ tree }, null, 2)}\n`);
      return;
    }

    for (const node of tree) {
      printTreeNode(node, 0);
    }
  } finally {
    if (enforceNoColor) {
      setColorMode(previousColorMode);
    }
  }
}

function parseOpenStates(statesOption: string | undefined): State[] {
  if (!statesOption || statesOption.trim() === "") {
    return [...openStateDefaults];
  }
  const segments = statesOption
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (segments.length === 0) {
    return [...openStateDefaults];
  }
  const seen = new Set<string>();
  const result: State[] = [];
  for (const segment of segments) {
    if (!openStateSet.has(segment as State)) {
      throw new Error(
        `Invalid state '${segment}'. Expected one of: ${openStateDefaults.join(", ")}`,
      );
    }
    if (!seen.has(segment)) {
      seen.add(segment);
      result.push(segment as State);
    }
  }
  return result;
}

async function handleInject(
  target: string,
  options: { stdout?: boolean; check?: boolean },
): Promise<void> {
  const normalizedTarget = target.trim();
  if (normalizedTarget.length === 0) {
    throw new Error("Target file path is required");
  }

  const repoRoot = process.cwd();

  if (options.check) {
    const result = await checkManagedSnippet(repoRoot, normalizedTarget);
    if (result.ok) {
      process.stdout.write(`Snippet is current in ${result.path}.\n`);
      return;
    }

    const reason =
      result.reason === "file-missing"
        ? "File not found"
        : result.reason === "marker-missing"
          ? "Managed snippet markers not found"
          : "Snippet is stale";
    process.stderr.write(`${reason}: ${result.path}\n`);
    process.exitCode = 4;
    return;
  }

  try {
    const result = await writeManagedSnippet(repoRoot, normalizedTarget);
    const message = result.changed ? "Snippet updated." : "Snippet already up to date.";
    process.stdout.write(`${message}\n`);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.stdout) {
    const snippet = await generateHandbook("overview", "md");
    process.stdout.write(snippet);
  }
}

async function handleHelpCommand(
  target: string | undefined,
  options: { playbook?: boolean; reference?: boolean; contract?: boolean; snippet?: boolean },
  command: Command,
): Promise<void> {
  const root = command.parent ?? command;

  // Count how many flags are set
  const flagsSet = [options.playbook, options.reference, options.contract, options.snippet].filter(
    Boolean,
  ).length;

  // Validate flag combinations
  if (flagsSet > 1) {
    process.stderr.write("Cannot combine multiple documentation flags\n");
    process.exitCode = 1;
    return;
  }

  if (flagsSet > 0 && target) {
    process.stderr.write("Cannot combine documentation flags with a specific command\n");
    process.exitCode = 1;
    return;
  }

  // Handle documentation flags
  if (options.contract) {
    try {
      const payload = renderDescribe("json");
      process.stdout.write(payload);
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 3;
    }
    return;
  }

  if (options.reference) {
    const dump = renderAggregatedHelp(root);
    process.stdout.write(dump);
    return;
  }

  if (options.playbook) {
    const content = await generateHandbook("all", "md");
    process.stdout.write(content);
    return;
  }

  if (options.snippet) {
    const content = await generateHandbook("overview", "md");
    process.stdout.write(content);
    return;
  }

  // Handle command-specific help
  if (target) {
    const resolved =
      root.commands.find((cmd) => cmd.name() === target || cmd.aliases().includes(target)) ?? null;
    if (!resolved) {
      process.stderr.write(`Unknown command '${target}'\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(resolved.helpInformation());
    return;
  }

  // Default: show root help
  process.stdout.write(command.helpInformation());
}

function printTreeNode(node: TaskTreeNode, depth: number): void {
  const indent = "  ".repeat(depth);
  const badge = formatState(node.state, `[${node.state.toUpperCase()}]`);
  const priorityDisplay = formatPriority(node.priority, `<${node.priority}>`);
  const blockedBadge = node.blocked !== undefined ? ` ${formatBlockedBadge(node.blocked)}` : "";
  process.stdout.write(
    `${indent}- ${badge} ${colors.bold(node.title)}${blockedBadge} (${formatId(node.id)}) ${priorityDisplay}\n`,
  );
  for (const child of node.children) {
    printTreeNode(child, depth + 1);
  }
}

type OpenRenderOptions = {
  showId: boolean;
  showPath: boolean;
  relativePath: boolean;
  compact: boolean;
  repoRoot: string;
};

function renderOpenGroups(groups: OpenTreeStateGroup[], options: OpenRenderOptions): string {
  const nonEmpty = groups.filter(
    (group) =>
      group.by_epic.length > 0 ||
      group.ungrouped.stories.length > 0 ||
      group.ungrouped.tasks.length > 0,
  );

  if (nonEmpty.length === 0) {
    return `${formatNote("No open tasks in the selected states.")}\n`;
  }

  const _indent = (depth: number) => "  ".repeat(depth);
  const width = Math.max(20, Math.min(process.stdout?.columns ?? 80, 120));
  const lines: string[] = [];
  const addGap = () => {
    if (!options.compact && lines.length > 0) {
      lines.push("");
    }
  };

  nonEmpty.forEach((group, index) => {
    if (index > 0) {
      addGap();
    }
    lines.push(colors.bold(group.state.toUpperCase()));
    lines.push(formatNote("-".repeat(width)));

    const orphanStories = group.ungrouped.stories;
    const orphanStoryIds = new Set(orphanStories.map((story) => story.id));
    const tasksByParent = new Map<string, OpenTreeItem[]>();
    const orphanTasks: OpenTreeItem[] = [];

    for (const task of group.ungrouped.tasks) {
      const parentId = task.parent;
      if (parentId && orphanStoryIds.has(parentId)) {
        const bucket = tasksByParent.get(parentId) ?? [];
        bucket.push(task);
        tasksByParent.set(parentId, bucket);
      } else {
        orphanTasks.push(task);
      }
    }

    if (group.by_epic.length > 0) {
      for (const epic of group.by_epic) {
        appendOpenItemLines(lines, epic.epic, options, 1);
        for (const story of epic.children) {
          renderStoryLines(lines, story.story, story.tasks, options, 2);
        }
      }
    }

    if (orphanStories.length > 0) {
      if (group.by_epic.length > 0) {
        addGap();
      }
      for (const story of orphanStories) {
        const tasks = tasksByParent.get(story.id) ?? [];
        renderStoryLines(lines, story, tasks, options, 1);
      }
    }

    if (orphanTasks.length > 0) {
      if (group.by_epic.length > 0 || orphanStories.length > 0) {
        addGap();
      }
      for (const task of orphanTasks) {
        appendOpenItemLines(lines, task, options, 1);
      }
    }
  });

  return `${lines.join("\n")}\n`;
}

function printOpenTree(groups: OpenTreeStateGroup[], options: OpenRenderOptions): void {
  process.stdout.write(renderOpenGroups(groups, options));
}

function renderStoryLines(
  lines: string[],
  story: OpenTreeItem,
  tasks: OpenTreeItem[],
  options: OpenRenderOptions,
  baseIndent: number,
): void {
  appendOpenItemLines(lines, story, options, baseIndent);
  for (const task of tasks) {
    appendOpenItemLines(lines, task, options, baseIndent + 1);
  }
}

function appendOpenItemLines(
  lines: string[],
  item: OpenTreeItem,
  options: OpenRenderOptions,
  indentLevel: number,
): void {
  const indent = "  ".repeat(indentLevel);
  lines.push(`${indent}${renderOpenItemHeader(item, options.showId)}`);
  if (options.showPath) {
    lines.push(`${indent}${formatOpenItemPath(item, options)}`);
  }
}

function renderOpenItemHeader(item: OpenTreeItem, showId: boolean): string {
  const kindTag = formatKindTag(item.kind);
  const priorityTag = formatPriorityBadge(item.priority);
  const title = colors.bold(item.title);
  const blockedNote = item.blocked !== undefined ? ` ${formatBlockedBadge(item.blocked)}` : "";
  const idDisplay = showId ? ` ${formatNote("(id: ")}${formatId(item.id)}${formatNote(")")}` : "";
  return `${kindTag}${priorityTag} ${title}${blockedNote}${idDisplay}`;
}

function formatOpenItemPath(item: OpenTreeItem, options: OpenRenderOptions): string {
  if (!fs.existsSync(item.path)) {
    return formatNote("<missing>");
  }
  if (options.relativePath) {
    const cwd = process.cwd();
    let relative = path.relative(cwd, item.path);
    if (relative === "") {
      relative = ".";
    }
    if (!relative.startsWith("../") && relative !== ".") {
      relative = `.${path.sep}${relative}`;
    }
    return formatPath(relative);
  }
  return formatPath(item.path);
}

function formatKindTag(kind: Kind): string {
  return formatKindTagWithDisplay(kind, getKindBadge(kind));
}

function formatKindTagWithDisplay(kind: Kind, display: string): string {
  switch (kind) {
    case "epic":
      return colors.magenta(display);
    case "story":
      return colors.cyan(display);
    default:
      return colors.green(display);
  }
}

function getKindBadge(kind: Kind): string {
  switch (kind) {
    case "epic":
      return "[EPIC]";
    case "story":
      return "[STORY]";
    default:
      return "[TASK]";
  }
}

function formatPriorityBadge(priority: TaskMeta["priority"]): string {
  return formatPriority(priority, `[${priority}]`);
}

function formatBlockedBadge(message?: string): string {
  const note = (message ?? "").trim();
  return note.length > 0 ? colors.red(`[BLOCKED] ${note}`) : colors.red("[BLOCKED]");
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? formatNote("-") : value.join(", ");
  }
  if (value === null || value === undefined) {
    return formatNote("-");
  }
  if (value instanceof Date) {
    return formatNote(value.toISOString());
  }
  return String(value);
}

interface HelpSection {
  title: string;
  commands: string[];
}

function isCommandHidden(command: Command): boolean {
  return Boolean((command as Command & { _hidden?: boolean })._hidden);
}

function renderHelpSections(root: Command, sections: HelpSection[]): string {
  const commandMap = new Map(root.commands.map((cmd) => [cmd.name(), cmd]));
  const lines: string[] = [];
  lines.push(formatHeading("Command Groups"));
  for (const section of sections) {
    lines.push(`  ${colors.bold(section.title)}`);
    for (const commandName of section.commands) {
      const command = commandMap.get(commandName);
      if (!command) continue;
      const term = command.name();
      const padded = term.padEnd(18);
      lines.push(`    ${colors.cyan(padded)} ${command.description()}`);
    }
  }
  return `\n${lines.join("\n")}\n`;
}

function renderAggregatedHelp(root: Command): string {
  const segments: string[] = [];
  const appendHelp = (command: Command) => {
    const block = command.helpInformation().trimEnd();
    if (block.length > 0) {
      segments.push(block);
    }
  };

  appendHelp(root);
  for (const child of root.commands) {
    if (isCommandHidden(child) || child.name() === "help") {
      continue;
    }
    appendHelp(child);
  }
  const width = Math.max(20, Math.min(process.stdout?.columns ?? 80, 120));
  const separator = `\n\n${formatNote("-".repeat(width))}\n\n`;
  return `${segments.join(separator)}\n`;
}

const program = new Command();
program
  .name("taskplain")
  .description("Taskplain CLI for repository-native task management")
  .version("0.1.0");

program.helpCommand(false);

// Warn about stale or missing managed agent snippet and mismatched README marker
program.hook("preAction", async (_thisCommand, actionCommand) => {
  if (actionCommand?.name && actionCommand.name() === "inject") {
    // Suppress snippet freshness warnings during the inject command itself
    return;
  }
  const repoRoot = process.cwd();
  try {
    // Check managed snippet in AGENTS.md
    const result = await checkManagedSnippet(repoRoot, "AGENTS.md");
    if (!result.ok) {
      const reason =
        result.reason === "file-missing"
          ? "file missing"
          : result.reason === "marker-missing"
            ? "managed markers not found"
            : "snippet is stale";
      process.stderr.write(
        `${colors.yellow("warn")} ${formatPath("AGENTS.md", repoRoot)} ${reason}. Run ` +
          "`taskplain inject AGENTS.md` to refresh.\n",
      );
    }
  } catch {
    // best-effort: never block commands
  }

  try {
    // Compare README sample snippet marker version
    const readmePath = path.join(repoRoot, "README.md");
    const content = await fs.readFile(readmePath, "utf8").catch(() => null);
    if (content) {
      const m = content.match(/<!--\s*taskplain:start\s+v([^\s>]+)\s*-->/);
      if (m?.[1] && `v${m[1]}` !== SNIPPET_VERSION) {
        process.stderr.write(
          `${colors.yellow("warn")} README.md snippet marker version v${m[1]} does not match CLI ${SNIPPET_VERSION}. Update the README example.\n`,
        );
      }
    }
  } catch {
    // ignore
  }
});

program.option("--color <when>", "color output: auto|always|never", "auto");

program.hook("preAction", (_, actionCommand) => {
  const { color } = actionCommand.optsWithGlobals();
  const normalized = (color ?? "auto").toLowerCase();
  if (!colorModes.has(normalized as ColorMode)) {
    throw new Error("--color must be one of: auto, always, never");
  }
  setColorMode(normalized as ColorMode);
});

program
  .command("init")
  .description("Create the required tasks directory structure")
  .option("--sample", "create a sample task", false)
  .action((options) => {
    handleInit(options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("new")
  .description("Create a new task file")
  .requiredOption("--title <title>", "human readable title")
  .option("--kind <kind>", "epic | story | task (defaults to an inferred kind)")
  .option("--parent <parent>", "parent task id")
  .option("--state <state>", "idea | ready | in-progress | done | canceled")
  .option("--priority <priority>", "none | low | normal | high | urgent")
  .option("--output <format>", "human|json", "human")
  .action((cmd) => {
    handleNewTask(cmd).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("update")
  .description("Update metadata fields or replace section content on a task")
  .argument("<id>", "task id to update")
  .option("--meta <pair>", "apply metadata patch (key=value)", collectMetaOption, [])
  .option(
    "--field <section...>",
    "replace section content using inline text or @file",
    collectFieldOption,
    [],
  )
  .option("--unset <key>", "remove metadata field", collectUnsetOption, [])
  .option("--dry-run", "print planned changes without writing", false)
  .option("--output <format>", "human|json", "human")
  .action((id, options) => {
    handleUpdate(id, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = process.exitCode ?? 1;
    });
  });

program
  .command("set")
  .description("Removed. Use 'taskplain update' instead.")
  .argument("<id>")
  .argument("[pairs...]")
  .option("--output <format>", "human|json", "human")
  .action(() => {
    process.stderr.write(
      "taskplain: 'set' is removed. Use: taskplain update <id> --meta key=value [--field section value]\\n",
    );
    process.exitCode = 5;
  });

program
  .command("validate")
  .description("Validate all task files under tasks/ directory")
  .option("--output <format>", "human|json", "human")
  .option("--concurrency <workers>", "maximum number of parallel workers")
  .option("--min-parallel <count>", "minimum files required before enabling parallel validation")
  .option("--fix", "apply automatic repairs before validating", false)
  .option("--rename-files", "rename mismatched task filenames when combined with --fix", false)
  .option("--strict", "treat warnings as errors for CI", false)
  .action((options) => {
    handleValidate(options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("help")
  .description("Show help for commands or access reference documentation")
  .argument("[command]", "command name to show help for")
  .option("--playbook", "show complete CLI playbook with workflows and examples")
  .option("--reference", "show aggregated reference for all commands")
  .option("--contract", "show machine-readable CLI contract (JSON)")
  .option("--snippet", "show agent instructions snippet for AGENTS.md")
  .action((target, options, cmd) => {
    handleHelpCommand(target, options, cmd).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  })
  .addHelpText(
    "afterAll",
    () =>
      `\nExamples:\n  taskplain help                    # Show root help\n  taskplain help new                # Show help for 'new' command\n  taskplain help --playbook         # Complete CLI playbook\n  taskplain help --reference        # All commands aggregated\n  taskplain help --contract         # Machine-readable JSON\n  taskplain help --snippet          # Agent instructions\n`,
  );

program
  .command("inject")
  .description("Inject the managed AGENTS.md snippet into a target file")
  .argument("[file]", "target file to update between managed snippet markers", "AGENTS.md")
  .option("--stdout", "also print the injected snippet to stdout", false)
  .option("--check", "exit with non-zero status when snippet in file is stale", false)
  .action((file, options) => {
    handleInject(file, options).catch((error) => {
      if (process.exitCode === undefined) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
      }
    });
  });

program
  .command("web")
  .description("Launch a local web board for the current repository")
  .option("--port <port>", "port to listen on (defaults to any available port)")
  .option("--open", "open the board in the default browser", false)
  .action((options) => {
    handleWeb(options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("list")
  .description("List tasks with optional filters")
  .option("--state <state>", "filter by state")
  .option("--priority <priority>", "filter by priority")
  .option("--parent <id>", "filter by parent id")
  .option("--search <query>", "search by id/title/body substring")
  .option("--label <label>", "filter by label")
  .option("--size <values>", "filter by size (comma-separated)")
  .option("--ambiguity <values>", "filter by ambiguity (comma-separated)")
  .option("--executor <values>", "filter by executor tier (comma-separated)")
  .option("--isolation <values>", "filter by isolation scope (comma-separated)")
  .option("--blocked", "only show blocked open tasks")
  .option("--unblocked", "only show open tasks without a block")
  .option("--open", "show open tasks grouped by state")
  .option("--states <states>", "comma-separated state order for --open")
  .option("--output <format>", "human|json", "human")
  .action((options) => {
    handleList(options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("show")
  .description("Show task metadata and a body preview")
  .argument("<id>", "task id to display")
  .option("--lines <n>", "number of body lines to preview", "20")
  .option("--output <format>", "human|json", "human")
  .action((id, options) => {
    handleShow(id, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("tree")
  .description("Render task hierarchy or open-state summary")
  .argument("[id]", "optional root id (defaults to top-level)")
  .option("--open", "show open tasks grouped by state")
  .option("--states <states>", "comma-separated state order for --open")
  .option("--priority <priority>", "filter by priority (with --open)")
  .option("--label <label>", "filter by label (with --open)")
  .option("--search <query>", "search by id/title/body (with --open)")
  .option("--ready-only", "hide blocked or dependency-pending items (with --open)")
  .option("--show-id", "display canonical ids")
  .option("--show-path", "display file paths (use with --relative-path)")
  .option("--relative-path", "show repo-relative paths")
  .option("--compact", "compact layout (fewer blank lines)")
  .option("--no-color", "disable color output")
  .option("--output <format>", "human|json", "human")
  .action((id, options) => {
    handleTree(id, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("move")
  .description("Move a task to a different state directory")
  .argument("<id>", "task id to move")
  .argument("<state>", "target state")
  .option("--dry-run", "print planned move without writing")
  .option("--cascade <mode>", "none|ready|cancel", "none")
  .option("--include-blocked", "include blocked descendants during cascade")
  .option("--force", "override block on the parent task")
  .option("--output <format>", "human|json", "human")
  .action((id, state, options) => {
    handleMove(id, state, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      if (process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("adopt")
  .description("Assign a child task to a parent")
  .argument("<parent>", "parent task id")
  .argument("<child>", "child task id to adopt")
  .option("--before <id>", "insert before an existing child id")
  .option("--after <id>", "insert after an existing child id")
  .option("--dry-run", "preview adoption without writing changes")
  .option("--output <format>", "human|json", "human")
  .action((parentId, childId, options) => {
    handleAdopt(parentId, childId, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      if (process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("delete")
  .description("Delete a task and remove parent references")
  .argument("<id>", "task id to delete")
  .option("--dry-run", "preview deletion without writing changes")
  .option("--output <format>", "human|json", "human")
  .action((id, options) => {
    handleDelete(id, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      if (process.exitCode === undefined) {
        process.exitCode = 1;
      }
    });
  });

program
  .command("complete")
  .description("Mark a task as done")
  .argument("<id>", "task id to complete")
  .option("--dry-run", "print planned completion without writing")
  .option("--output <format>", "human|json", "human")
  .addOption(new Option("--commit <message>").hideHelp())
  .addOption(new Option("--close-gh [number]").hideHelp())
  .action((id, options) => {
    handleComplete(id, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("cleanup")
  .description("Remove old completed tasks and emit change summaries")
  .requiredOption("--older-than <age>", "Remove tasks older than (e.g., 90d, 6m)")
  .option("--dry-run", "Preview without deleting tasks")
  .option("--output <format>", "human|json", "human")
  .action((options) => {
    handleCleanup(options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("next")
  .description("Suggest ready-state tasks for agents using dispatch metadata")
  .option("--count <n>", "number of tasks to select", "1")
  .option("--parallelize <n>", "greedily choose non-conflicting tasks")
  .option("--kinds <kinds>", "comma-separated kinds (task,story,epic)", "task")
  .option("--executor <tier>", "preferred executor (simple|standard|expert|human_review)")
  .option("--max-size <size>", "maximum size (tiny|small|medium|large|xl)")
  .option("--ambiguity <levels>", "filter by ambiguity levels (low,medium,high)")
  .option("--isolation <scopes>", "filter by isolation scopes (isolated,module,shared,global)")
  .option("--parent <id>", "limit to a specific parent (epic or story)")
  .option("--output <mode>", "ids|json|human", "ids")
  .option("--include-blocked", "include blocked tasks in the candidate pool")
  .action((options, command) => {
    handleNext(options, command).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

program
  .command("pickup")
  .description("Bundle task context, suggest next children, and move idea work to ready")
  .argument("<id>", "task id to pick up")
  .option("--dry-run", "preview state transitions without writing changes")
  .option("--include-blocked", "include blocked children when ranking suggestions")
  .option("--output <format>", "human|json", "human")
  .action((taskId, options) => {
    handlePickup(taskId, options).catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
  });

const helpSections: HelpSection[] = [
  {
    title: "Setup",
    commands: ["init", "inject", "help", "validate"],
  },
  {
    title: "Work On Tasks",
    commands: ["new", "update", "move", "adopt", "delete", "pickup", "complete", "cleanup"],
  },
  {
    title: "Explore Tasks",
    commands: ["list", "next", "show", "tree", "web"],
  },
];

const defaultHelpRenderer = program.createHelp();

program.configureHelp({
  visibleCommands(cmd) {
    if (!cmd.parent) {
      return [];
    }
    return defaultHelpRenderer.visibleCommands(cmd);
  },
});

program.addHelpText("afterAll", ({ command }) =>
  command === program ? renderHelpSections(program, helpSections) : "",
);

program.parseAsync(process.argv);
