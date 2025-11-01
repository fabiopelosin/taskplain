import path from "node:path";
import fs from "fs-extra";

import type { GitAdapter } from "../adapters/gitAdapter";
import { readTaskFile, type TaskFileReadResult, writeTaskFile } from "../adapters/taskFile";
import { readDocsSource } from "../domain/content";
import type { NormalizationWarning } from "../domain/normalization";
import { activeName, doneName, stateDir } from "../domain/paths";
import { resolveSectionHeading, type SectionId } from "../domain/sections";
import { canTransition } from "../domain/stateMachine";
import {
  defaultAmbiguity,
  defaultExecutor,
  defaultIsolation,
  defaultSize,
  type Kind,
  type Priority,
  type State,
  type TaskDoc,
  type TaskMeta,
  taskMetaSchema,
} from "../domain/types";
import { slugify } from "../utils/slug";
import { nowUtc } from "../utils/time";
import { buildHierarchyIndex } from "./hierarchy";
import { TaskQueryService } from "./taskQueryService";

export interface NewTaskOptions {
  title: string;
  kind: Kind;
  parent?: string;
  state?: State;
  priority?: Priority;
  assignees?: string[];
  labels?: string[];
  commit_message?: string;
}

export interface TaskServiceDeps {
  repoRoot: string;
  git?: GitAdapter;
}

const UPDATE_META_FIELDS = [
  "title",
  "priority",
  "parent",
  "assignees",
  "labels",
  "state",
  "blocked",
  "commit_message",
  "links",
  "size",
  "ambiguity",
  "executor",
  "isolation",
  "touches",
  "depends_on",
  "blocks",
] as const;

export type UpdateMetaField = (typeof UPDATE_META_FIELDS)[number];

const CASCADE_MODES = ["none", "ready", "cancel"] as const;

const UNSETTABLE_FIELDS: UpdateMetaField[] = [
  "parent",
  "assignees",
  "labels",
  "links",
  "blocked",
  "commit_message",
  "touches",
  "depends_on",
  "blocks",
];

export interface TaskUpdateOptions {
  id: string;
  metaPatch: Partial<Pick<TaskMeta, UpdateMetaField>>;
  unset: UpdateMetaField[];
  sections: Partial<Record<SectionId, string>>;
  rawBody?: string;
  dryRun?: boolean;
}

export interface SectionChange {
  id: SectionId;
  changed: boolean;
  added: boolean;
}

export interface TaskUpdateResult {
  dryRun: boolean;
  changed: boolean;
  meta: TaskMeta;
  fromPath: string;
  toPath: string;
  metaChanges: string[];
  sectionChanges: SectionChange[];
}

export class TaskService {
  private readonly warnings: TaskWarning[] = [];
  private static readonly taskTemplate = (() => {
    const content = readDocsSource("task-template.md").replace(/\r\n/g, "\n");
    return content.endsWith("\n") ? content : `${content}\n`;
  })();

  constructor(private readonly deps: TaskServiceDeps) {}

  async loadTaskById(id: string): Promise<TaskDoc> {
    const all = await this.listAllTaskFiles();
    for (const filePath of all) {
      const { doc, warnings } = await this.readTaskFileWithWarnings(filePath);
      if (doc.meta.id === id) {
        this.recordWarnings(warnings, doc.path);
        return doc;
      }
      this.recordWarnings(warnings, doc.path);
    }
    throw new Error(`Task with id ${id} not found`);
  }

  async listAllTaskFiles(): Promise<string[]> {
    const tasksRoot = path.join(this.deps.repoRoot, "tasks");
    const files: string[] = [];
    try {
      const stateDirs = await fs.readdir(tasksRoot, { withFileTypes: true });
      for (const stateDirent of stateDirs) {
        if (!stateDirent.isDirectory()) continue;
        const dirPath = path.join(tasksRoot, stateDirent.name);
        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
          if (entry.endsWith(".md")) {
            files.push(path.join(dirPath, entry));
          }
        }
      }
    } catch (error) {
      // If tasks directory missing, treat as empty set.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    files.sort();
    return files;
  }

  async listAllTasks(): Promise<TaskDoc[]> {
    const files = await this.listAllTaskFiles();
    const docs: TaskDoc[] = [];
    for (const filePath of files) {
      const { doc, warnings } = await this.readTaskFileWithWarnings(filePath);
      docs.push(doc);
      this.recordWarnings(warnings, doc.path);
    }
    return docs;
  }

  async query(): Promise<TaskQueryService> {
    const tasks = await this.listAllTasks();
    return new TaskQueryService(tasks);
  }

  async newTask(options: NewTaskOptions): Promise<TaskDoc> {
    const id = slugify(options.title);
    const state = options.state ?? "idea";
    const priority = options.priority ?? "normal";
    const parentId = options.parent?.trim();
    const rawCommitMessage = options.commit_message?.trim();

    const timestamp = nowUtc();
    const completionDate = timestamp.slice(0, 10);

    const dir = path.join(this.deps.repoRoot, stateDir(state));
    await fs.ensureDir(dir);

    const fileName =
      state === "done" ? doneName(completionDate, options.kind, id) : activeName(options.kind, id);
    const filePath = path.join(dir, fileName);

    if (await fs.pathExists(filePath)) {
      throw new Error(`Task with id ${id} already exists at ${filePath}`);
    }

    if (parentId && options.kind === "epic") {
      throw new Error("Epics cannot declare a parent");
    }

    const meta: TaskMeta = {
      id,
      title: options.title,
      kind: options.kind,
      state,
      priority,
      assignees: options.assignees,
      labels: options.labels,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: state === "done" ? timestamp : null,
      links: [],
      last_activity_at: timestamp,
      size: defaultSize,
      ambiguity: defaultAmbiguity,
      executor: defaultExecutor,
      isolation: defaultIsolation,
    };

    if (rawCommitMessage) {
      meta.commit_message = rawCommitMessage;
    }

    const doc: TaskDoc = {
      meta,
      body: this.createDefaultBody(),
      path: filePath,
    };

    await writeTaskFile(filePath, doc);

    if (parentId) {
      const parentDoc = await this.loadTaskById(parentId);

      const expectedParentKind =
        options.kind === "task" ? "story" : options.kind === "story" ? "epic" : undefined;
      if (expectedParentKind && parentDoc.meta.kind !== expectedParentKind) {
        throw new Error(
          `${options.kind} '${id}' must have a ${expectedParentKind} parent but '${parentDoc.meta.kind}' was provided`,
        );
      }

      const existingChildren = parentDoc.meta.children ?? [];
      if (!existingChildren.includes(id)) {
        const nextChildren = [...existingChildren, id];
        const updatedParent: TaskDoc = {
          ...parentDoc,
          meta: {
            ...parentDoc.meta,
            children: nextChildren,
            updated_at: timestamp,
            last_activity_at: timestamp,
          },
        };
        await writeTaskFile(parentDoc.path, updatedParent);
      }
    }

    return doc;
  }

  async getTask(filePath: string): Promise<TaskDoc> {
    const { doc, warnings } = await this.readTaskFileWithWarnings(filePath);
    this.recordWarnings(warnings, doc.path);
    return doc;
  }

  async update(options: TaskUpdateOptions): Promise<TaskUpdateResult> {
    const current = await this.loadTaskById(options.id);
    const dryRun = options.dryRun === true;

    const metaPatchEntries = Object.entries(options.metaPatch ?? {}) as [
      UpdateMetaField,
      unknown,
    ][];
    const unsetKeys = Array.from(new Set(options.unset ?? []));
    const hasRawBody = options.rawBody !== undefined;

    if (
      metaPatchEntries.length === 0 &&
      unsetKeys.length === 0 &&
      Object.keys(options.sections ?? {}).length === 0 &&
      !hasRawBody
    ) {
      throw new Error("Provide at least one --meta, --field, or --unset option");
    }

    for (const [key] of metaPatchEntries) {
      if (!UPDATE_META_FIELDS.includes(key)) {
        throw new Error(`Field '${key}' cannot be updated via taskplain update`);
      }
    }

    for (const key of unsetKeys) {
      if (!UNSETTABLE_FIELDS.includes(key)) {
        throw new Error(`Field '${key}' cannot be unset via taskplain update`);
      }
    }

    const nextMeta: TaskMeta = { ...current.meta };
    const metaChanges = new Set<string>();

    for (const key of unsetKeys) {
      if ((nextMeta as Record<string, unknown>)[key] !== undefined) {
        delete (nextMeta as Record<string, unknown>)[key];
        metaChanges.add(key);
      }
    }

    for (const [key, value] of metaPatchEntries) {
      const prev = (nextMeta as Record<string, unknown>)[key];
      if (!deepEqual(prev, value)) {
        (nextMeta as Record<string, unknown>)[key] = value as unknown;
        metaChanges.add(key);
      }
    }

    const stateChanged = nextMeta.state !== current.meta.state;
    if (stateChanged && !canTransition(current.meta.state, nextMeta.state)) {
      throw new Error(`Invalid transition from ${current.meta.state} to ${nextMeta.state}`);
    }

    const sectionEntries = Object.entries(options.sections ?? {}) as [SectionId, string][];
    if (hasRawBody && sectionEntries.length > 0) {
      throw new Error("Cannot combine --field updates with raw body replacement");
    }
    let body = current.body.replace(/\r\n/g, "\n");
    const sectionChanges: SectionChange[] = [];
    let rawBodyChanged = false;

    if (hasRawBody) {
      const normalized = (options.rawBody as string).replace(/\r\n/g, "\n");
      if (normalized !== body) {
        body = normalized;
        rawBodyChanged = true;
      }
    } else {
      for (const [sectionId, value] of sectionEntries) {
        const heading = resolveSectionHeading(sectionId);
        const { body: nextBody, changed, added } = setSectionContent(body, heading, value);
        sectionChanges.push({ id: sectionId, changed, added });
        if (changed) {
          body = nextBody;
        }
      }
    }

    const sectionChanged = rawBodyChanged || sectionChanges.some((item) => item.changed);
    const hasChanges = metaChanges.size > 0 || sectionChanged || stateChanged;

    const timestamp = nowUtc();

    if (hasChanges) {
      nextMeta.updated_at = timestamp;
      nextMeta.last_activity_at = timestamp;
    }

    if (stateChanged) {
      if (nextMeta.state === "done") {
        if (!nextMeta.completed_at) {
          nextMeta.completed_at = timestamp;
          metaChanges.add("completed_at");
        }
      } else if (current.meta.state === "done" && nextMeta.completed_at !== null) {
        nextMeta.completed_at = null;
        metaChanges.add("completed_at");
      }
    }

    const validatedMeta = taskMetaSchema.parse(nextMeta);

    const repoRoot = this.deps.repoRoot;
    let destinationPath = current.path;

    if (stateChanged) {
      const destinationDir = path.join(repoRoot, stateDir(validatedMeta.state));
      const fileName = this.computeFileNameForState(
        { ...current, meta: validatedMeta },
        validatedMeta.state,
        timestamp,
      );
      destinationPath = path.join(destinationDir, fileName);
    }

    const normalizedBody = ensureTrailingNewline(body);
    const nextDoc: TaskDoc = {
      ...current,
      meta: validatedMeta,
      body: normalizedBody,
      path: stateChanged ? destinationPath : current.path,
    };

    if (dryRun) {
      return {
        dryRun: true,
        changed: hasChanges,
        meta: nextDoc.meta,
        fromPath: current.path,
        toPath: destinationPath,
        metaChanges: Array.from(metaChanges),
        sectionChanges,
      };
    }

    if (!hasChanges) {
      return {
        dryRun: false,
        changed: false,
        meta: current.meta,
        fromPath: current.path,
        toPath: current.path,
        metaChanges: [],
        sectionChanges: [],
      };
    }

    if (stateChanged && destinationPath !== current.path) {
      const destinationDir = path.dirname(destinationPath);
      await fs.ensureDir(destinationDir);
      if (await fs.pathExists(destinationPath)) {
        throw new Error(`Destination path already exists: ${destinationPath}`);
      }
      await this.performMove(current.path, destinationPath);
      nextDoc.path = destinationPath;
    }

    await writeTaskFile(nextDoc.path, nextDoc);

    return {
      dryRun: false,
      changed: true,
      meta: nextDoc.meta,
      fromPath: current.path,
      toPath: nextDoc.path,
      metaChanges: Array.from(metaChanges),
      sectionChanges,
    };
  }

  async block(id: string, message: string): Promise<TaskBlockResult> {
    const current = await this.loadTaskById(id);
    const timestamp = nowUtc();
    const trimmed = message.trim();
    const previous = typeof current.meta.blocked === "string" ? current.meta.blocked : undefined;
    const isTerminalState = current.meta.state === "done" || current.meta.state === "canceled";

    if (isTerminalState) {
      this.warnings.push({
        code: "blocked_terminal_state",
        message: "blocked present while task is done/canceled",
        field: "blocked",
        file: current.path,
      });
    }

    if (previous === trimmed) {
      return {
        changed: false,
        meta: current.meta,
        path: current.path,
        blocked: trimmed,
        previousBlocked: previous,
      };
    }

    const nextMeta: TaskMeta = {
      ...current.meta,
      blocked: trimmed,
      updated_at: timestamp,
      last_activity_at: timestamp,
    };

    const doc: TaskDoc = {
      ...current,
      meta: nextMeta,
    };

    await writeTaskFile(current.path, doc);

    return {
      changed: true,
      meta: nextMeta,
      path: current.path,
      blocked: trimmed,
      previousBlocked: previous,
    };
  }

  async unblock(id: string): Promise<TaskUnblockResult> {
    const current = await this.loadTaskById(id);
    const timestamp = nowUtc();
    const previous = typeof current.meta.blocked === "string" ? current.meta.blocked : undefined;

    if (previous === undefined) {
      return {
        changed: false,
        meta: current.meta,
        path: current.path,
        previousBlocked: undefined,
      };
    }

    const nextMeta = { ...current.meta } as TaskMeta & { blocked?: string };
    delete nextMeta.blocked;
    nextMeta.updated_at = timestamp;
    nextMeta.last_activity_at = timestamp;

    const doc: TaskDoc = {
      ...current,
      meta: nextMeta,
    };

    await writeTaskFile(current.path, doc);

    return {
      changed: true,
      meta: nextMeta,
      path: current.path,
      previousBlocked: previous,
    };
  }

  async move(id: string, nextState: State, options: TaskMoveOptions = {}): Promise<TaskMoveResult> {
    const cascadeMode: TaskCascadeMode = options.cascade ?? "none";
    if (!CASCADE_MODES.includes(cascadeMode)) {
      throw new Error(
        `Invalid cascade mode '${cascadeMode}'. Expected one of: ${CASCADE_MODES.join(", ")}`,
      );
    }

    const dryRun = options.dryRun === true;
    const includeBlocked = options.includeBlocked === true;
    const force = options.force === true;
    const timestamp = options.timestamp ?? nowUtc();

    const tasks = await this.listAllTasks();
    const current = tasks.find((task) => task.meta.id === id);
    if (!current) {
      throw new Error(`Task with id ${id} not found`);
    }

    if (!canTransition(current.meta.state, nextState)) {
      throw new Error(`Invalid transition from ${current.meta.state} to ${nextState}`);
    }

    const blockedMessage = this.getBlockedMessage(current);
    if (
      blockedMessage !== undefined &&
      current.meta.state !== nextState &&
      nextState !== "canceled" &&
      !force
    ) {
      const detail = blockedMessage.trim().length > 0 ? `: ${blockedMessage}` : "";
      throw new Error(
        `Task '${id}' is blocked${detail}. Unblock, move to canceled, or pass --force to override.`,
      );
    }

    const descendants =
      cascadeMode === "none" ? [] : this.collectDescendants(current.meta.id, tasks);

    const parentOutcome = await this.applySingleMove(current, nextState, {
      dryRun,
      timestamp,
    });

    let cascadeSummary: TaskCascadeSummary = {
      mode: cascadeMode,
      children: [],
      changedCount: 0,
    };

    if (cascadeMode !== "none") {
      cascadeSummary = await this.applyCascade(descendants, cascadeMode, {
        dryRun,
        includeBlocked,
        timestamp,
      });
    }

    return {
      dryRun,
      changed: parentOutcome.changed,
      fromPath: parentOutcome.fromPath,
      toPath: parentOutcome.toPath,
      fromState: parentOutcome.fromState,
      toState: parentOutcome.toState,
      meta: parentOutcome.meta,
      cascade: cascadeSummary,
    };
  }

  private async applySingleMove(
    current: TaskDoc,
    nextState: State,
    options: { dryRun: boolean; timestamp: string },
  ): Promise<SingleMoveResult> {
    if (current.meta.state === nextState) {
      return {
        changed: false,
        fromPath: current.path,
        toPath: current.path,
        fromState: current.meta.state,
        toState: current.meta.state,
        meta: current.meta,
        doc: current,
      };
    }

    const tasksRoot = path.join(this.deps.repoRoot, "tasks");
    await fs.ensureDir(tasksRoot);

    const destinationDir = path.join(this.deps.repoRoot, stateDir(nextState));
    await fs.ensureDir(destinationDir);

    const fileName = this.computeFileNameForState(current, nextState, options.timestamp);
    const destinationPath = path.join(destinationDir, fileName);

    if (destinationPath === current.path) {
      return {
        changed: false,
        fromPath: current.path,
        toPath: current.path,
        fromState: current.meta.state,
        toState: nextState,
        meta: current.meta,
        doc: current,
      };
    }

    if (options.dryRun) {
      const previewMeta: TaskMeta = {
        ...current.meta,
        state: nextState,
      };
      const previewDoc: TaskDoc = {
        ...current,
        meta: previewMeta,
        path: destinationPath,
      };
      return {
        changed: true,
        fromPath: current.path,
        toPath: destinationPath,
        fromState: current.meta.state,
        toState: nextState,
        meta: previewMeta,
        doc: previewDoc,
      };
    }

    if (await fs.pathExists(destinationPath)) {
      throw new Error(`Destination path already exists: ${destinationPath}`);
    }

    await this.performMove(current.path, destinationPath);

    const updatedMeta: TaskMeta = {
      ...current.meta,
      state: nextState,
      updated_at: options.timestamp,
      last_activity_at: options.timestamp,
      completed_at: nextState === "done" ? (current.meta.completed_at ?? options.timestamp) : null,
    };

    const updatedDoc: TaskDoc = {
      ...current,
      meta: updatedMeta,
      path: destinationPath,
    };

    await writeTaskFile(destinationPath, updatedDoc);

    return {
      changed: true,
      fromPath: current.path,
      toPath: destinationPath,
      fromState: current.meta.state,
      toState: nextState,
      meta: updatedMeta,
      doc: updatedDoc,
    };
  }

  private async applyCascade(
    descendants: TaskDoc[],
    mode: TaskCascadeMode,
    options: { dryRun: boolean; includeBlocked: boolean; timestamp: string },
  ): Promise<TaskCascadeSummary> {
    const summary: TaskCascadeSummary = {
      mode,
      children: [],
      changedCount: 0,
    };

    for (const descendant of descendants) {
      const id = descendant.meta.id;
      const currentState = descendant.meta.state;

      if (!options.includeBlocked && this.isTaskBlocked(descendant)) {
        summary.children.push({ id, skipped: true, reason: "blocked" });
        continue;
      }

      let targetState: State | undefined;

      if (mode === "ready") {
        if (currentState === "idea") {
          targetState = "ready";
        } else if (currentState === "ready") {
          summary.children.push({
            id,
            from: currentState,
            to: currentState,
            skipped: true,
            reason: "already_target_state",
          });
          continue;
        } else if (currentState === "done" || currentState === "canceled") {
          summary.children.push({
            id,
            skipped: true,
            reason: "terminal_state",
          });
          continue;
        } else {
          summary.children.push({
            id,
            skipped: true,
            reason: "state_excluded",
          });
          continue;
        }
      } else if (mode === "cancel") {
        if (currentState === "done" || currentState === "canceled") {
          summary.children.push({
            id,
            skipped: true,
            reason: "terminal_state",
          });
          continue;
        }
        targetState = "canceled";
      }

      if (!targetState) {
        continue;
      }

      if (currentState === targetState) {
        summary.children.push({
          id,
          from: currentState,
          to: targetState,
          skipped: true,
          reason: "already_target_state",
        });
        continue;
      }

      if (!canTransition(currentState, targetState)) {
        summary.children.push({
          id,
          from: currentState,
          to: targetState,
          skipped: true,
          reason: "invalid_transition",
        });
        continue;
      }

      const outcome = await this.applySingleMove(descendant, targetState, {
        dryRun: options.dryRun,
        timestamp: options.timestamp,
      });

      summary.children.push({
        id,
        from: currentState,
        to: targetState,
        changed: outcome.changed,
        reason: `cascade:${mode}`,
      });

      if (outcome.changed) {
        summary.changedCount += 1;
      }

      if (!options.dryRun) {
        descendant.meta = outcome.doc.meta;
        descendant.path = outcome.doc.path;
      }
    }

    return summary;
  }

  private getBlockedMessage(task: TaskDoc): string | undefined {
    if (typeof task.meta.blocked === "string") {
      return task.meta.blocked;
    }
    return undefined;
  }

  private isTaskBlocked(task: TaskDoc): boolean {
    return this.getBlockedMessage(task) !== undefined;
  }

  async deleteTask(id: string, options: TaskDeleteOptions = {}): Promise<TaskDeleteResult> {
    const dryRun = options.dryRun === true;
    const cascade = options.cascade === true;
    const tasks = await this.listAllTasks();
    const target = tasks.find((task) => task.meta.id === id);
    if (!target) {
      throw new Error(`Task with id ${id} not found`);
    }

    const descendants = this.collectDescendants(id, tasks);
    if (!cascade && descendants.length > 0) {
      const childList = descendants.map((doc) => doc.meta.id).join(", ");
      throw new Error(
        `Cannot delete '${id}' because it has descendant tasks. Delete or reassign them first: ${childList}`,
      );
    }

    const deleteDocs = cascade ? [target, ...descendants] : [target];
    const deleteIds = new Set(deleteDocs.map((doc) => doc.meta.id));

    const dependencyRefs = tasks
      .filter((doc) => !deleteIds.has(doc.meta.id))
      .map((doc) => {
        const refs: string[] = [];
        if (doc.meta.depends_on?.some((value) => deleteIds.has(value)) === true) {
          refs.push("depends_on");
        }
        if (doc.meta.blocks?.some((value) => deleteIds.has(value)) === true) {
          refs.push("blocks");
        }
        if (refs.length === 0) {
          return undefined;
        }
        return { doc, refs };
      })
      .filter((entry): entry is { doc: TaskDoc; refs: string[] } => entry !== undefined);

    if (dependencyRefs.length > 0) {
      const detail = dependencyRefs
        .map(({ doc, refs }) => `${doc.meta.id} (${refs.join(" & ")})`)
        .join(", ");
      throw new Error(
        `Cannot delete '${id}' because other tasks reference it or its descendants: ${detail}`,
      );
    }

    const timestamp = nowUtc();
    const updatedParents = new Map<
      string,
      {
        doc: TaskDoc;
        previous: string[];
        next: string[];
      }
    >();

    for (const doc of tasks) {
      if (deleteIds.has(doc.meta.id)) {
        continue;
      }
      const previous = [...(doc.meta.children ?? [])];
      if (previous.length === 0) {
        continue;
      }
      const next = previous.filter((childId) => !deleteIds.has(childId));
      if (deepEqual(previous, next)) {
        continue;
      }
      updatedParents.set(doc.meta.id, {
        doc,
        previous,
        next,
      });
    }

    if (!dryRun) {
      for (const entry of updatedParents.values()) {
        const nextMeta: TaskMeta = {
          ...entry.doc.meta,
          updated_at: timestamp,
          last_activity_at: timestamp,
        };
        if (entry.next.length > 0) {
          nextMeta.children = entry.next;
        } else {
          delete (nextMeta as Record<string, unknown>).children;
        }
        const nextDoc: TaskDoc = {
          ...entry.doc,
          meta: nextMeta,
        };
        await writeTaskFile(entry.doc.path, nextDoc);
      }
    }

    if (!dryRun) {
      const toDelete = [...deleteDocs].sort((a, b) => b.path.length - a.path.length);
      for (const doc of toDelete) {
        await this.performDelete(doc.path);
      }
    }

    const parentUpdates: ParentChildrenUpdate[] = Array.from(updatedParents.values()).map(
      (entry) => ({
        id: entry.doc.meta.id,
        path: entry.doc.path,
        previous: entry.previous,
        next: entry.next,
        role: "former",
      }),
    );

    parentUpdates.sort((a, b) => a.id.localeCompare(b.id));

    const descendantSummaries = deleteDocs
      .filter((doc) => doc.meta.id !== target.meta.id)
      .map((doc) => ({
        id: doc.meta.id,
        kind: doc.meta.kind,
        state: doc.meta.state,
        path: doc.path,
      }));

    return {
      dryRun,
      deleted: !dryRun,
      task: {
        id: target.meta.id,
        kind: target.meta.kind,
        state: target.meta.state,
        path: target.path,
      },
      descendants: descendantSummaries,
      parentUpdates,
    };
  }

  async adoptChild(
    parentId: string,
    childId: string,
    options: TaskAdoptOptions = {},
  ): Promise<TaskAdoptChildResult> {
    const dryRun = options.dryRun === true;
    const beforeId = options.before?.trim();
    const afterId = options.after?.trim();

    if (beforeId && afterId) {
      throw new Error("--before and --after cannot be used together");
    }

    if (parentId === childId) {
      throw new Error("Parent and child ids must differ");
    }

    const tasks = await this.listAllTasks();
    const byId = new Map(tasks.map((doc) => [doc.meta.id, doc]));
    const parent = byId.get(parentId);
    if (!parent) {
      throw new Error(`Parent task '${parentId}' not found`);
    }
    const child = byId.get(childId);
    if (!child) {
      throw new Error(`Child task '${childId}' not found`);
    }

    if (parent.meta.kind === "task") {
      throw new Error(`Task '${parentId}' cannot adopt children`);
    }

    if (child.meta.kind === "epic") {
      throw new Error(`Epic '${childId}' cannot be adopted as a child`);
    }

    const expectedParentKind = child.meta.kind === "story" ? "epic" : "story";
    if (parent.meta.kind !== expectedParentKind) {
      throw new Error(
        `Child '${childId}' (${child.meta.kind}) requires a ${expectedParentKind} parent, but '${parent.meta.kind}' was provided`,
      );
    }

    const descendants = this.collectDescendants(child.meta.id, tasks);
    if (descendants.some((doc) => doc.meta.id === parentId)) {
      throw new Error(
        `Cannot adopt '${childId}' under '${parentId}' because it would create a cycle`,
      );
    }

    if (beforeId === childId || afterId === childId) {
      throw new Error("--before/--after cannot reference the child being adopted");
    }

    const timestamp = nowUtc();
    const updatedParents = new Map<
      string,
      {
        doc: TaskDoc;
        previous: string[];
        next: string[];
        role: ParentUpdateRole;
      }
    >();

    for (const doc of tasks) {
      if (doc.meta.id === parentId) {
        continue;
      }
      const children = doc.meta.children ?? [];
      if (!children.includes(child.meta.id)) {
        continue;
      }
      const previous = [...children];
      const next = children.filter((value) => value !== child.meta.id);
      updatedParents.set(doc.meta.id, {
        doc,
        previous,
        next,
        role: "former",
      });
    }

    const rawParentChildren = parent.meta.children ?? [];
    const dedupedParentChildren = rawParentChildren.filter(
      (value, index, array) => array.indexOf(value) === index,
    );
    const withoutChild = dedupedParentChildren.filter((value) => value !== child.meta.id);

    let insertIndex = withoutChild.length;
    if (beforeId) {
      const idx = withoutChild.indexOf(beforeId);
      if (idx === -1) {
        throw new Error(`Parent '${parentId}' does not list child '${beforeId}'`);
      }
      insertIndex = idx;
    } else if (afterId) {
      const idx = withoutChild.indexOf(afterId);
      if (idx === -1) {
        throw new Error(`Parent '${parentId}' does not list child '${afterId}'`);
      }
      insertIndex = idx + 1;
    }

    const nextParentChildren = [...withoutChild];
    nextParentChildren.splice(insertIndex, 0, child.meta.id);

    updatedParents.set(parent.meta.id, {
      doc: parent,
      previous: [...rawParentChildren],
      next: nextParentChildren,
      role: "target",
    });

    const anyChanged = Array.from(updatedParents.values()).some(
      (entry) => !deepEqual(entry.previous, entry.next),
    );

    if (!dryRun) {
      for (const entry of updatedParents.values()) {
        if (deepEqual(entry.previous, entry.next)) {
          continue;
        }
        const nextMeta: TaskMeta = {
          ...entry.doc.meta,
          updated_at: timestamp,
          last_activity_at: timestamp,
        };
        if (entry.next.length > 0) {
          nextMeta.children = entry.next;
        } else {
          delete (nextMeta as Record<string, unknown>).children;
        }
        const nextDoc: TaskDoc = {
          ...entry.doc,
          meta: nextMeta,
        };
        await writeTaskFile(entry.doc.path, nextDoc);
      }
    }

    const updates: ParentChildrenUpdate[] = Array.from(updatedParents.values())
      .map((entry) => ({
        id: entry.doc.meta.id,
        path: entry.doc.path,
        previous: entry.previous,
        next: entry.next,
        role: entry.role,
      }))
      .sort((a, b) => {
        if (a.role === b.role) {
          return a.id.localeCompare(b.id);
        }
        return a.role === "target" ? -1 : 1;
      });

    return {
      dryRun,
      changed: anyChanged,
      parent: {
        id: parent.meta.id,
        kind: parent.meta.kind,
        path: parent.path,
      },
      child: {
        id: child.meta.id,
        kind: child.meta.kind,
        path: child.path,
      },
      updates,
    };
  }

  async complete(id: string, options: TaskCompleteOptions = {}): Promise<TaskCompleteResult> {
    const timestamp = nowUtc();
    const tasks = await this.listAllTasks();
    const current = tasks.find((task) => task.meta.id === id);
    if (!current) {
      throw new Error(`Task with id ${id} not found`);
    }

    if (current.meta.state === "done") {
      return {
        dryRun: options.dryRun ?? false,
        changed: false,
        fromPath: current.path,
        toPath: current.path,
        fromState: current.meta.state,
        toState: current.meta.state,
        meta: current.meta,
        cascade: {
          mode: "none",
          children: [],
          changedCount: 0,
        },
      };
    }

    this.assertCanComplete(current, tasks);

    // Warn if Post-Implementation Insights appears empty or placeholder-only
    this.warnIfInsightsEmpty(current);

    if (options.dryRun) {
      const preview = await this.move(id, "done", { dryRun: true, timestamp });
      return {
        ...preview,
        dryRun: true,
      };
    }

    const moveResult = await this.move(id, "done", { timestamp });

    return {
      ...moveResult,
      dryRun: false,
    };
  }

  private createDefaultBody(): string {
    return TaskService.taskTemplate;
  }

  private computeFileNameForState(task: TaskDoc, state: State, timestamp: string): string {
    if (state === "done") {
      const date = timestamp.slice(0, 10);
      return doneName(date, task.meta.kind, task.meta.id);
    }
    return activeName(task.meta.kind, task.meta.id);
  }

  private async performMove(source: string, destination: string): Promise<void> {
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

  private async performDelete(filePath: string): Promise<void> {
    const repoRoot = this.deps.repoRoot;
    const relativePath = path.relative(repoRoot, filePath);

    if (this.deps.git) {
      try {
        await this.deps.git.rm(relativePath);
        return;
      } catch (_error) {
        // fall back to filesystem delete when git rm fails (e.g., untracked files)
      }
    }

    await fs.remove(filePath);
  }

  private assertCanComplete(current: TaskDoc, tasks: TaskDoc[]): void {
    if (current.meta.kind === "task") {
      return;
    }

    const descendants = this.collectDescendants(current.meta.id, tasks);
    const blocking = descendants.filter((doc) => {
      if (doc.meta.state === "done" || doc.meta.state === "canceled") {
        return false;
      }
      return true;
    });

    if (blocking.length > 0) {
      const blockingIds = blocking.map((doc) => doc.meta.id).join(", ");
      throw new Error(`Cannot complete ${current.meta.id}. Blocking descendants: ${blockingIds}`);
    }
  }

  private collectDescendants(id: string, tasks: TaskDoc[]): TaskDoc[] {
    const { index } = buildHierarchyIndex(tasks);
    const result: TaskDoc[] = [];
    const queue: TaskDoc[] = [...(index.childrenById.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) continue;
      result.push(next);
      const children = index.childrenById.get(next.meta.id);
      if (children) {
        queue.push(...children);
      }
    }

    return result;
  }

  private warnIfInsightsEmpty(task: TaskDoc): void {
    const insightsHeading = resolveSectionHeading("post_implementation_insights");
    const insightsContent = this.extractSectionContent(task.body, insightsHeading);

    if (!insightsContent) {
      // Section completely missing (shouldn't happen with templates, but handle it)
      process.stderr.write(
        `\n⚠️  Warning: Post-Implementation Insights section is missing.\n` +
          `   Consider documenting what shipped, decisions made, and architectural changes.\n\n`,
      );
      return;
    }

    // Check if content looks like placeholder or is nearly empty
    const trimmed = insightsContent.trim();
    const withoutComments = trimmed.replace(/<!--[\s\S]*?-->/g, "").trim();
    const hasSubsections = /###\s+(Changelog|Decisions|Architecture)/i.test(withoutComments);
    const contentLines = withoutComments
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("-") && line.trim() !== "-");

    if (!hasSubsections || contentLines.length === 0) {
      process.stderr.write(
        `\n⚠️  Warning: Post-Implementation Insights section appears empty or incomplete.\n` +
          `   Fill out Changelog, Decisions, and Architecture subsections with concrete bullet points.\n` +
          `   This enables knowledge extraction during archival.\n\n`,
      );
    }
  }

  private extractSectionContent(body: string, heading: string): string | null {
    const escapedHeading = this.escapeForRegExp(heading);
    const pattern = new RegExp(`^${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
    const match = body.match(pattern);
    if (!match) {
      return null;
    }
    return match[1].trimEnd();
  }

  private escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async readTaskFileWithWarnings(filePath: string): Promise<TaskFileReadResult> {
    return readTaskFile(filePath);
  }

  private recordWarnings(warnings: NormalizationWarning[], filePath: string): void {
    if (warnings.length === 0) {
      return;
    }
    for (const warning of warnings) {
      this.warnings.push({ ...warning, file: filePath });
    }
  }

  drainWarnings(): TaskWarning[] {
    const pending = [...this.warnings];
    this.warnings.length = 0;
    return pending;
  }
}

export interface TaskWarning extends NormalizationWarning {
  file: string;
}

export interface TaskBlockResult {
  changed: boolean;
  meta: TaskMeta;
  path: string;
  blocked: string;
  previousBlocked?: string;
}

export interface TaskUnblockResult {
  changed: boolean;
  meta: TaskMeta;
  path: string;
  previousBlocked?: string;
}

export interface TaskDeleteOptions {
  dryRun?: boolean;
  cascade?: boolean;
}

export type ParentUpdateRole = "target" | "former";

export interface ParentChildrenUpdate {
  id: string;
  path: string;
  previous: string[];
  next: string[];
  role: ParentUpdateRole;
}

export interface TaskDeleteResult {
  dryRun: boolean;
  deleted: boolean;
  task: {
    id: string;
    kind: Kind;
    state: State;
    path: string;
  };
  descendants: Array<{
    id: string;
    kind: Kind;
    state: State;
    path: string;
  }>;
  parentUpdates: ParentChildrenUpdate[];
}

export interface TaskAdoptOptions {
  dryRun?: boolean;
  before?: string;
  after?: string;
}

export interface TaskAdoptChildResult {
  dryRun: boolean;
  changed: boolean;
  parent: {
    id: string;
    kind: Kind;
    path: string;
  };
  child: {
    id: string;
    kind: Kind;
    path: string;
  };
  updates: ParentChildrenUpdate[];
}

interface SingleMoveResult {
  changed: boolean;
  fromPath: string;
  toPath: string;
  fromState: State;
  toState: State;
  meta: TaskMeta;
  doc: TaskDoc;
}

export type TaskCascadeMode = (typeof CASCADE_MODES)[number];

export interface TaskMoveOptions {
  dryRun?: boolean;
  timestamp?: string;
  cascade?: TaskCascadeMode;
  includeBlocked?: boolean;
  force?: boolean;
}

export interface TaskCascadeChildResult {
  id: string;
  from?: State;
  to?: State;
  changed?: boolean;
  skipped?: boolean;
  reason: string;
}

export interface TaskCascadeSummary {
  mode: TaskCascadeMode;
  children: TaskCascadeChildResult[];
  changedCount: number;
}

export interface TaskMoveResult {
  dryRun: boolean;
  changed: boolean;
  fromPath: string;
  toPath: string;
  fromState: State;
  toState: State;
  meta: TaskMeta;
  cascade: TaskCascadeSummary;
}

export interface TaskCompleteOptions {
  dryRun?: boolean;
}

export interface TaskCompleteResult extends TaskMoveResult {}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function setSectionContent(
  body: string,
  heading: string,
  content: string,
): { body: string; changed: boolean; added: boolean } {
  const normalizedBody = ensureTrailingNewline(body.replace(/\r\n/g, "\n"));
  const sectionPattern = new RegExp(
    `(^${escapeRegExp(heading)}\\s*$\\n?)([\\s\\S]*?)(?=^##\\s+|\\Z)`,
    "m",
  );

  const desiredContent = normalizeSectionContent(content);
  const formattedBlock = formatSectionBlock(heading, desiredContent);

  const match = sectionPattern.exec(normalizedBody);
  if (!match) {
    const prefix = normalizedBody.trimEnd();
    const updated = prefix.length > 0 ? `${prefix}\n\n${formattedBlock}` : formattedBlock;
    return {
      body: ensureTrailingNewline(updated),
      changed: true,
      added: true,
    };
  }

  const existingContent = normalizeSectionContent(match[2]);
  if (deepEqual(existingContent, desiredContent)) {
    return { body: normalizedBody, changed: false, added: false };
  }

  const updatedBody = normalizedBody.replace(sectionPattern, formattedBlock);
  return {
    body: ensureTrailingNewline(updatedBody.trimEnd()),
    changed: true,
    added: false,
  };
}

function normalizeSectionContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function formatSectionBlock(heading: string, normalizedContent: string): string {
  if (normalizedContent.length === 0) {
    return `${heading}\n\n`;
  }
  return `${heading}\n\n${normalizedContent}\n\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
