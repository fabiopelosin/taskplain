import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import lockfile from "proper-lockfile";
import type { GitAdapter } from "../adapters/gitAdapter";
import { orderTaskMeta, serializeTaskDoc, writeTaskFile } from "../adapters/taskFile";
import { activeName, doneName, stateDir } from "../domain/paths";
import { resolveSectionHeading } from "../domain/sections";
import { requiredHeadingsForState, type State, type TaskDoc, type TaskMeta } from "../domain/types";
import { nowUtc } from "../utils/time";
import { buildRankingContext, compareTasks } from "./taskRanking";
import type { TaskService, TaskWarning } from "./taskService";

const STALE_TOLERANCE_MS = 5000;
const LOCK_FILE_NAME = "fix.lock";
const CANONICAL_META_KEYS: (keyof TaskMeta)[] = [
  "id",
  "title",
  "kind",
  "parent",
  "children",
  "state",
  "priority",
  "size",
  "ambiguity",
  "executor",
  "isolation",
  "touches",
  "depends_on",
  "blocks",
  "assignees",
  "labels",
  "created_at",
  "updated_at",
  "completed_at",
  "links",
  "last_activity_at",
];

export interface FixResult {
  id: string;
  path: string;
  changes: string[];
  changed: boolean;
  rename?: FixRenameResult;
}

export interface FixSkip {
  id: string;
  reason: string;
  path?: string;
}

export interface FixSummary {
  items: FixResult[];
  skipped: FixSkip[];
}

export interface FixRenameResult {
  from: string;
  to: string;
  ok: boolean;
  reason?: string;
}

export interface FixOptions {
  renameFiles?: boolean;
}

export interface FixServiceDeps {
  repoRoot: string;
  taskService: TaskService;
  git?: GitAdapter;
}

export class FixService {
  constructor(private readonly deps: FixServiceDeps) {}

  async fixAll(options: FixOptions = {}): Promise<FixSummary> {
    return this.withLock(async () => {
      const files = await this.deps.taskService.listAllTaskFiles();
      await this.migrateLegacyParents();
      const items: FixResult[] = [];
      const skipped: FixSkip[] = [];
      const changedFiles = await this.snapshotChangedFiles();

      for (const filePath of files) {
        try {
          this.deps.taskService.drainWarnings();
          const doc = await this.deps.taskService.getTask(filePath);
          const warnings = this.deps.taskService.drainWarnings();
          const stats = await fs.stat(filePath);
          const result = await this.applyFix(doc, stats.mtimeMs, warnings, options, changedFiles);
          items.push(result);
        } catch (error) {
          skipped.push({
            id: path.basename(filePath),
            path: filePath,
            reason: (error as Error).message,
          });
        }
      }

      return { items, skipped };
    });
  }

  async fixIds(ids: string[], options: FixOptions = {}): Promise<FixSummary> {
    const uniqueIds = Array.from(new Set(ids));
    return this.withLock(async () => {
      await this.migrateLegacyParents();
      const items: FixResult[] = [];
      const skipped: FixSkip[] = [];
      const changedFiles = await this.snapshotChangedFiles();

      for (const id of uniqueIds) {
        try {
          this.deps.taskService.drainWarnings();
          const doc = await this.deps.taskService.loadTaskById(id);
          const warnings = this.deps.taskService.drainWarnings();
          const stats = await fs.stat(doc.path);
          const result = await this.applyFix(doc, stats.mtimeMs, warnings, options, changedFiles);
          items.push(result);
        } catch (error) {
          skipped.push({ id, reason: (error as Error).message });
        }
      }

      return { items, skipped };
    });
  }

  private async applyFix(
    doc: TaskDoc,
    mtimeMs: number,
    warnings: TaskWarning[],
    options: FixOptions,
    changedFiles?: Set<string>,
  ): Promise<FixResult> {
    const originalContent = await fs.readFile(doc.path, "utf8");
    const normalizedContent = originalContent.replace(/\r\n/g, "\n");
    const { normalized, changes, changed } = this.normalizeDoc(
      doc,
      mtimeMs,
      normalizedContent,
      warnings,
      changedFiles,
    );
    if (changed) {
      await writeTaskFile(doc.path, normalized);
    }
    const changeDescriptions = [...changes];
    let resultPath = doc.path;
    let renameResult: FixRenameResult | undefined;

    if (options.renameFiles === true) {
      renameResult = await this.renameIfNeeded(doc.path, normalized);
      if (renameResult?.ok) {
        resultPath = renameResult.to;
        changeDescriptions.push(`renamed file to ${this.relativeTaskPath(renameResult.to)}`);
      }
    }

    const netChanged = changed || (renameResult?.ok ?? false);

    return {
      id: normalized.meta.id,
      path: resultPath,
      changes: netChanged ? changeDescriptions : [],
      changed: netChanged,
      rename: renameResult,
    };
  }

  private normalizeDoc(
    doc: TaskDoc,
    mtimeMs: number,
    originalContent: string,
    warnings: TaskWarning[],
    changedFiles?: Set<string>,
  ): { normalized: TaskDoc; changes: string[]; changed: boolean } {
    const changes: string[] = [];
    const frontMatterMatch = originalContent.match(/^---\n([\s\S]*?)\n---/);
    const originalKeys = frontMatterMatch
      ? frontMatterMatch[1]
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => line.split(":")[0])
      : [];

    const orderedKnownKeys = CANONICAL_META_KEYS.filter((key) => originalKeys.includes(key));
    const unknownKeys = originalKeys.filter(
      (key) => !CANONICAL_META_KEYS.includes(key as keyof TaskMeta),
    );
    const expectedKeyOrder = [...orderedKnownKeys, ...unknownKeys];
    const metaOrderChanged =
      originalKeys.length !== expectedKeyOrder.length ||
      originalKeys.some((key, index) => expectedKeyOrder[index] !== key);

    if (metaOrderChanged) {
      changes.push("normalized front matter order");
    }

    const { body: normalizedHeadings, added } = this.ensureRequiredHeadings(
      doc.body,
      doc.meta.state,
    );
    for (const heading of added) {
      changes.push(`added heading ${heading}`);
    }

    const { body: normalizedBody, changed: acceptanceChanged } =
      this.ensureAcceptanceCriteriaChecklist(normalizedHeadings);
    if (acceptanceChanged) {
      changes.push("seeded acceptance criteria checklist");
    }

    // Check if all acceptance criteria are completed and auto-complete the task
    const autoCompleted =
      doc.meta.state !== "done" &&
      doc.meta.state !== "canceled" &&
      this.allAcceptanceCriteriaCompleted(normalizedBody);

    let updatedMeta = doc.meta;
    if (autoCompleted) {
      const timestamp = nowUtc();
      updatedMeta = {
        ...doc.meta,
        state: "done",
        completed_at: timestamp,
      };
      changes.push("auto-completed task (all acceptance criteria checked)");
    }

    const canonicalMeta = orderTaskMeta(updatedMeta);
    const baseDoc: TaskDoc = {
      ...doc,
      meta: canonicalMeta,
      body: normalizedBody,
    };
    const baseSerialized = serializeTaskDoc(baseDoc);
    const structuralChanged = baseSerialized !== originalContent;

    const updatedAtMs = Date.parse(doc.meta.updated_at);
    const stale = !Number.isNaN(updatedAtMs) && mtimeMs - updatedAtMs > STALE_TOLERANCE_MS;

    const syncForStale = stale && this.shouldSyncStale(doc.path, changedFiles);
    const willRewrite = structuralChanged || syncForStale || autoCompleted;

    let finalDoc = baseDoc;

    if (willRewrite) {
      const nextTimestamp = nowUtc();
      finalDoc = {
        ...baseDoc,
        meta: {
          ...canonicalMeta,
          updated_at: nextTimestamp,
          last_activity_at: nextTimestamp,
        },
      };
      if (!changes.includes("synchronized timestamps")) {
        changes.push("synchronized timestamps");
      }
    }

    const migrationNotes = collectDispatchWarningChanges(warnings);
    for (const note of migrationNotes) {
      if (!changes.includes(note)) {
        changes.push(note);
      }
    }

    if (!willRewrite) {
      return {
        normalized: finalDoc,
        changes: [],
        changed: false,
      };
    }

    return {
      normalized: finalDoc,
      changes,
      changed: true,
    };
  }

  private async renameIfNeeded(
    currentPath: string,
    doc: TaskDoc,
  ): Promise<FixRenameResult | undefined> {
    const expectedPath = this.computeExpectedPath(doc);
    const currentRelative = path.relative(this.deps.repoRoot, currentPath);
    const expectedRelative = path.relative(this.deps.repoRoot, expectedPath);
    const normalizedCurrent = this.normalizeComparisonPath(currentRelative);
    const normalizedExpected = this.normalizeComparisonPath(expectedRelative);

    if (normalizedCurrent === normalizedExpected) {
      return undefined;
    }

    if (await fs.pathExists(expectedPath)) {
      return {
        from: currentPath,
        to: expectedPath,
        ok: false,
        reason: "target already exists",
      };
    }

    await fs.ensureDir(path.dirname(expectedPath));

    try {
      await this.performRename(currentPath, expectedPath);
      return {
        from: currentPath,
        to: expectedPath,
        ok: true,
      };
    } catch (error) {
      const reason = (error as Error).message;
      return {
        from: currentPath,
        to: expectedPath,
        ok: false,
        reason,
      };
    }
  }

  private computeExpectedPath(doc: TaskDoc): string {
    const dir = path.join(this.deps.repoRoot, stateDir(doc.meta.state));
    const fileName =
      doc.meta.state === "done"
        ? doneName(this.resolveDoneDate(doc), doc.meta.kind, doc.meta.id)
        : activeName(doc.meta.kind, doc.meta.id);
    return path.join(dir, fileName);
  }

  private resolveDoneDate(doc: TaskDoc): string {
    const candidate = doc.meta.completed_at ?? doc.meta.updated_at ?? nowUtc();
    return candidate.slice(0, 10);
  }

  private async performRename(source: string, destination: string): Promise<void> {
    const repoRoot = this.deps.repoRoot;
    const relativeSource = path.relative(repoRoot, source);
    const relativeDestination = path.relative(repoRoot, destination);

    if (this.deps.git) {
      try {
        await this.deps.git.mv(relativeSource, relativeDestination);
        return;
      } catch (_error) {
        // fall back to filesystem move when git mv fails (e.g., untracked files)
      }
    }

    await fs.move(source, destination, { overwrite: false });
  }

  private relativeTaskPath(value: string): string {
    const relative = path.relative(this.deps.repoRoot, value);
    return this.normalizeComparisonPath(relative);
  }

  private async snapshotChangedFiles(): Promise<Set<string> | undefined> {
    if (!this.deps.git) {
      return undefined;
    }
    try {
      return await this.deps.git.listChangedFiles();
    } catch (_error) {
      return undefined;
    }
  }

  private shouldSyncStale(docPath: string, changedFiles?: Set<string>): boolean {
    if (!changedFiles || changedFiles.size === 0) {
      return true;
    }
    const relative = path.relative(this.deps.repoRoot, docPath);
    const normalized = this.normalizeComparisonPath(relative);
    return changedFiles.has(normalized);
  }

  private normalizeComparisonPath(value: string): string {
    if (!value) {
      return ".";
    }
    return value.split(path.sep).join("/");
  }

  private async migrateLegacyParents(): Promise<void> {
    let tasks: TaskDoc[];
    try {
      tasks = await this.deps.taskService.listAllTasks();
    } catch {
      return;
    }
    const legacyChildren = tasks.filter((doc) => typeof doc.meta.parent === "string");
    if (legacyChildren.length === 0) {
      return;
    }

    const timestamp = nowUtc();
    const byId = new Map<string, TaskDoc>();
    for (const doc of tasks) {
      byId.set(doc.meta.id, doc);
    }

    const rankingContext = buildRankingContext(tasks);
    const additionsByParent = new Map<string, TaskDoc[]>();

    for (const child of legacyChildren) {
      const parentId = child.meta.parent;
      if (!parentId) {
        continue;
      }
      const parentDoc = byId.get(parentId);
      if (!parentDoc) {
        continue;
      }
      const list = additionsByParent.get(parentId) ?? [];
      list.push(child);
      additionsByParent.set(parentId, list);
    }

    const arraysEqual = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((value, index) => value === b[index]);

    for (const child of legacyChildren) {
      const parentId = child.meta.parent;
      if (!parentId) {
        continue;
      }

      const nextMeta: TaskMeta = { ...child.meta };
      delete nextMeta.parent;

      const updatedChild: TaskDoc = {
        ...child,
        meta: {
          ...nextMeta,
          updated_at: timestamp,
          last_activity_at: timestamp,
        },
      };

      await writeTaskFile(child.path, updatedChild);
      byId.set(updatedChild.meta.id, updatedChild);
    }

    for (const [parentId, additions] of additionsByParent) {
      const parentDoc = byId.get(parentId);
      if (!parentDoc) {
        continue;
      }

      const existingChildrenIds = parentDoc.meta.children ?? [];
      const preservedChildren = existingChildrenIds
        .map((childId) => byId.get(childId))
        .filter((child): child is TaskDoc => Boolean(child));
      const existingSet = new Set(existingChildrenIds);

      const additionDocs = additions
        .map((child) => byId.get(child.meta.id))
        .filter((child): child is TaskDoc => Boolean(child));
      const newChildren = additionDocs.filter((child) => !existingSet.has(child.meta.id));
      const sortedNewChildren = newChildren
        .slice()
        .sort((a, b) => compareTasks(a, b, rankingContext));
      const nextChildrenDocs = [...preservedChildren, ...sortedNewChildren];
      const nextChildrenIds = nextChildrenDocs.map((child) => child.meta.id);

      if (!arraysEqual(nextChildrenIds, existingChildrenIds)) {
        const updatedParent: TaskDoc = {
          ...parentDoc,
          meta: {
            ...parentDoc.meta,
            children: nextChildrenIds,
            updated_at: timestamp,
            last_activity_at: timestamp,
          },
        };
        await writeTaskFile(parentDoc.path, updatedParent);
        byId.set(parentId, updatedParent);
      }
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const tmpRoot = path.join(os.tmpdir(), "taskplain-locks");
    const repoHash = crypto
      .createHash("sha256")
      .update(this.deps.repoRoot)
      .digest("hex")
      .slice(0, 16);
    await fs.ensureDir(tmpRoot);
    const lockPath = path.join(tmpRoot, `${repoHash}-${LOCK_FILE_NAME}`);
    await fs.ensureFile(lockPath);

    const release = await lockfile.lock(lockPath, {
      retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 400 },
      stale: 30_000,
      realpath: false,
    });

    try {
      return await fn();
    } finally {
      await release();
    }
  }

  private ensureRequiredHeadings(
    body: string,
    state: State,
  ): {
    body: string;
    added: string[];
  } {
    const normalized = body.replace(/\r\n/g, "\n");
    let next = normalized.trimStart().trimEnd();
    next = `\n${next}`;
    const added: string[] = [];

    const stateSpecificHeadings = requiredHeadingsForState(state);
    for (const heading of stateSpecificHeadings) {
      const headingRegex = new RegExp(`^${this.escapeRegExp(heading)}\\s*$`, "m");
      if (headingRegex.test(next)) {
        continue;
      }

      if (next.length > 0) {
        if (!next.endsWith("\n")) {
          next += "\n";
        }
        if (!next.endsWith("\n\n")) {
          next += "\n";
        }
      }

      next += `${heading}\n\n`;
      added.push(heading);
    }

    return { body: next.trimEnd(), added };
  }

  private ensureAcceptanceCriteriaChecklist(body: string): {
    body: string;
    changed: boolean;
  } {
    const heading = resolveSectionHeading("acceptance_criteria");
    const escapedHeading = this.escapeRegExp(heading);
    const pattern = new RegExp(`(${escapedHeading}\\s*\\n)([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
    const match = body.match(pattern);
    if (!match) {
      return { body, changed: false };
    }

    const rawSection = match[2];
    const lines = rawSection.split(/\r?\n/);
    const transformed: string[] = [];
    let mutated = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      if (/^[-*]\s+\[(?: |x|X)\]\s+.+$/.test(trimmed)) {
        transformed.push(trimmed);
        continue;
      }
      const stripped = trimmed
        .replace(/^[-*]\s+/, "")
        .replace(/^\[(?: |x|X)\]\s+/, "")
        .trim();
      if (stripped.length === 0 || /^<!--[\s\S]*-->$/.test(stripped)) {
        continue;
      }
      transformed.push(`- [ ] ${stripped}`);
      mutated = true;
    }

    if (transformed.length === 0) {
      transformed.push("- [ ] Describe the expected outcome");
      mutated = true;
    }

    if (!mutated && transformed.join("\n") === rawSection.trim()) {
      return { body, changed: false };
    }

    const replacementLines = transformed.join("\n");
    const placeholder = `${replacementLines}\n`;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const replacement = `${heading}\n\n${placeholder}`;
    const needsNewline = after.length > 0 && !after.startsWith("\n");
    const updatedBody = `${before}${replacement}${needsNewline ? "\n" : ""}${after}`;
    return { body: updatedBody, changed: true };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private allAcceptanceCriteriaCompleted(body: string): boolean {
    const heading = resolveSectionHeading("acceptance_criteria");
    const escapedHeading = this.escapeRegExp(heading);
    const pattern = new RegExp(`${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
    const match = body.match(pattern);
    if (!match) {
      return false;
    }

    const acceptanceContent = match[1].trimEnd();
    const lines = acceptanceContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return false;
    }

    // Check if all lines are checkbox items and all are checked
    return lines.every((line) => /^[-*]\s+\[x|X\]\s+.+$/.test(line));
  }
}

function collectDispatchWarningChanges(warnings: TaskWarning[]): string[] {
  const relevant = new Set([
    "size",
    "ambiguity",
    "executor",
    "isolation",
    "decision_readiness",
    "agent_fit",
    "autonomy_risk",
  ]);
  const unique = new Set<string>();
  for (const warning of warnings) {
    if (!warning.field || !relevant.has(warning.field)) {
      continue;
    }
    unique.add(warning.message);
  }
  return Array.from(unique);
}
