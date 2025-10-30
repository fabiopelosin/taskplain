import type { Kind, State, TaskDoc } from "../domain/types";
import { NextService, type RankedCandidate } from "./nextService";
import { TaskQueryService } from "./taskQueryService";
import { buildRankingContext, isTaskReady, type TaskRankingContext } from "./taskRanking";
import type { TaskMoveResult, TaskService } from "./taskService";

export interface PickupOptions {
  id: string;
  dryRun?: boolean;
  includeBlockedChildren?: boolean;
  childSuggestionLimit?: number;
}

export interface PickupMoveSummary {
  id: string;
  fromState: State;
  toState: State;
  changed: boolean;
  fromPath: string;
  toPath: string;
  reason?: string;
}

export interface PickupChildNotReady {
  doc: TaskDoc;
  reason: string;
}

export interface PickupChildContext {
  candidates: RankedCandidate[];
  selected: RankedCandidate[];
  notReady: PickupChildNotReady[];
  includeBlocked: boolean;
  totalDirectChildren: number;
}

export interface PickupResult {
  dryRun: boolean;
  target: TaskDoc;
  ancestors: TaskDoc[];
  moves: PickupMoveSummary[];
  children: PickupChildContext;
}

const DEFAULT_CHILD_SUGGEST_LIMIT = 3;

export class PickupService {
  constructor(private readonly taskService: TaskService) {}

  async execute(options: PickupOptions): Promise<PickupResult> {
    const dryRun = options.dryRun === true;
    const includeBlockedChildren = options.includeBlockedChildren === true;
    const childLimit = Math.max(options.childSuggestionLimit ?? DEFAULT_CHILD_SUGGEST_LIMIT, 0);

    const tasks = await this.taskService.listAllTasks();
    const query = new TaskQueryService(tasks);
    const target = query.getTask(options.id);
    if (!target) {
      throw new Error(`Task with id '${options.id}' not found`);
    }

    if (target.meta.state === "done" || target.meta.state === "canceled") {
      throw new Error(`Cannot pick up task '${options.id}' because it is ${target.meta.state}`);
    }

    const ancestors = query.getAncestors(options.id);

    const updatedDocs = new Map<string, TaskDoc>(
      tasks.map((doc) => [
        doc.meta.id,
        {
          ...doc,
          meta: { ...doc.meta },
        },
      ]),
    );

    const moves: PickupMoveSummary[] = [];

    const recordMove = (id: string, result: TaskMoveResult, reason?: string) => {
      moves.push({
        id,
        fromState: result.fromState,
        toState: result.toState,
        changed: result.changed,
        fromPath: result.fromPath,
        toPath: result.toPath,
        reason,
      });

      const existing = updatedDocs.get(id);
      if (existing) {
        updatedDocs.set(id, {
          ...existing,
          meta: { ...result.meta },
          path: result.toPath,
        });
      }
    };

    const recordNoOp = (doc: TaskDoc, reason: string) => {
      moves.push({
        id: doc.meta.id,
        fromState: doc.meta.state,
        toState: doc.meta.state,
        changed: false,
        fromPath: doc.path,
        toPath: doc.path,
        reason,
      });
    };

    // Promote idea ancestors to ready.
    for (const ancestor of ancestors) {
      if (ancestor.meta.state === "done" || ancestor.meta.state === "canceled") {
        recordNoOp(ancestor, "terminal_state");
        continue;
      }
      if (ancestor.meta.state !== "idea") {
        recordNoOp(ancestor, "already_active");
        continue;
      }
      const result = await this.taskService.move(ancestor.meta.id, "ready", {
        dryRun,
      });
      recordMove(ancestor.meta.id, result);
    }

    // Promote the target into in-progress when not already active there.
    if (target.meta.state === "in-progress") {
      recordNoOp(target, "already_active");
    } else if (target.meta.state === "idea" || target.meta.state === "ready") {
      const result = await this.taskService.move(target.meta.id, "in-progress", { dryRun });
      recordMove(target.meta.id, result);
    } else {
      recordNoOp(target, "already_active");
    }

    const finalDocs = Array.from(updatedDocs.values());
    const finalQuery = new TaskQueryService(finalDocs);
    const finalTarget = finalQuery.getTask(options.id);
    if (!finalTarget) {
      throw new Error(`Failed to load task '${options.id}' after pickup operations`);
    }
    const finalAncestors = finalQuery.getAncestors(options.id);

    const directChildren = finalQuery.getChildren(options.id);
    const childIdSet = new Set(directChildren.map((doc) => doc.meta.id));

    const childContext = this.buildChildContext({
      tasks: finalDocs,
      directChildren,
      childLimit,
      parentId: options.id,
      includeBlocked: includeBlockedChildren,
    });

    const candidates = childContext.candidates.filter((candidate) =>
      childIdSet.has(candidate.doc.meta.id),
    );

    const limit = Math.max(childLimit, childContext.selected.length);
    const limitedCandidates = limit > 0 ? candidates.slice(0, limit) : [];
    const limitedCandidateIds = new Set(
      limitedCandidates.map((candidate) => candidate.doc.meta.id),
    );
    const limitedSelected = childContext.selected.filter((candidate) =>
      limitedCandidateIds.has(candidate.doc.meta.id),
    );

    const notReady = this.collectNotReadyChildren({
      tasks: finalDocs,
      directChildren,
      includeBlocked: includeBlockedChildren,
    });

    return {
      dryRun,
      target: finalTarget,
      ancestors: finalAncestors,
      moves,
      children: {
        candidates: limitedCandidates,
        selected: limitedSelected,
        notReady,
        includeBlocked: includeBlockedChildren,
        totalDirectChildren: childContext.totalDirectChildren,
      },
    };
  }

  private buildChildContext(args: {
    tasks: TaskDoc[];
    directChildren: TaskDoc[];
    childLimit: number;
    parentId: string;
    includeBlocked: boolean;
  }): PickupChildContext {
    const { tasks, childLimit, parentId, includeBlocked } = args;

    if (args.directChildren.length === 0 || childLimit === 0) {
      return {
        candidates: [],
        selected: [],
        notReady: [],
        includeBlocked,
        totalDirectChildren: args.directChildren.length,
      };
    }

    const kinds: Kind[] = ["task", "story"];
    const nextService = new NextService(tasks);
    const evaluation = nextService.evaluate({
      count: Math.max(childLimit, 1),
      kinds: new Set<Kind>(kinds),
      parent: parentId,
      includeBlocked,
      includeRootWithoutKind: false,
    });

    return {
      candidates: evaluation.candidates,
      selected: evaluation.selected,
      notReady: [],
      includeBlocked,
      totalDirectChildren: args.directChildren.length,
    };
  }

  private collectNotReadyChildren(args: {
    tasks: TaskDoc[];
    directChildren: TaskDoc[];
    includeBlocked: boolean;
  }): PickupChildNotReady[] {
    if (args.directChildren.length === 0) {
      return [];
    }

    const context: TaskRankingContext = buildRankingContext(args.tasks);
    const results: PickupChildNotReady[] = [];
    for (const child of args.directChildren) {
      const readiness = isTaskReady(child, context, {
        allowBlocked: args.includeBlocked,
      });
      if (!readiness.ready) {
        results.push({
          doc: child,
          reason: readiness.reason ?? "not_ready",
        });
      }
    }
    return results;
  }
}
