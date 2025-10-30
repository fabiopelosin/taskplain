import {
  ambiguityOrder,
  defaultAmbiguity,
  defaultExecutor,
  defaultIsolation,
  defaultSize,
  executorOrder,
  isolationOrder,
  type Kind,
  priorityOrder,
  sizeOrder,
  type TaskDoc,
  type TaskMeta,
} from "../domain/types";
import { buildHierarchyIndex } from "./hierarchy";

const PRIORITY_WEIGHT = new Map(priorityOrder.map((priority, index) => [priority, index]));

const SIZE_WEIGHT = new Map(sizeOrder.map((size, index) => [size, index]));
const AMBIGUITY_WEIGHT = new Map(ambiguityOrder.map((level, index) => [level, index]));
const ISOLATION_WEIGHT = new Map(
  isolationOrder.map((scope, index) => [scope, isolationOrder.length - 1 - index]),
);
const KIND_WEIGHT = new Map<Kind, number>([
  ["task", 0],
  ["story", 1],
  ["epic", 2],
]);
const READY_STATES = new Set<TaskMeta["state"]>(["ready"]);
const READY_STATES_WITH_IDEA = new Set<TaskMeta["state"]>(["idea", "ready"]);

export interface TaskRankingContext {
  byId: Map<string, TaskDoc>;
  parentById: Map<string, string | undefined>;
  rootEpicById: Map<string, string | undefined>;
  epicInFlight: Set<string>;
  childOrderIndex: Map<string, Map<string, number>>;
}

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
}

export interface ReadinessOptions {
  allowBlocked?: boolean;
  includeIdea?: boolean;
}

export interface ScoreBreakdown {
  priority: number;
  epic_in_flight: boolean;
  size: number;
  executor_index: number;
  executor_distance: number;
  ambiguity: number;
  isolation: number;
  updated_at_ms: number;
}

export interface RankingOptions {
  executorPreference?: TaskMeta["executor"];
}

export function buildRankingContext(tasks: TaskDoc[]): TaskRankingContext {
  const byId = new Map<string, TaskDoc>();
  const rootEpicById = new Map<string, string | undefined>();
  const epicInFlight = new Set<string>();

  const { index } = buildHierarchyIndex(tasks);
  const parentById = new Map<string, string | undefined>();

  for (const doc of tasks) {
    byId.set(doc.meta.id, doc);
    parentById.set(doc.meta.id, index.parentById.get(doc.meta.id));
  }

  const resolveRootEpic = (id: string): string | undefined => {
    if (rootEpicById.has(id)) {
      return rootEpicById.get(id);
    }
    const doc = byId.get(id);
    if (!doc) {
      rootEpicById.set(id, undefined);
      return undefined;
    }
    if (doc.meta.kind === "epic") {
      rootEpicById.set(id, doc.meta.id);
      return doc.meta.id;
    }
    const parentId = parentById.get(id);
    if (!parentId) {
      rootEpicById.set(id, undefined);
      return undefined;
    }
    const root = resolveRootEpic(parentId);
    rootEpicById.set(id, root);
    return root;
  };

  for (const doc of tasks) {
    resolveRootEpic(doc.meta.id);
  }

  for (const doc of tasks) {
    if (doc.meta.state === "in-progress") {
      const root = rootEpicById.get(doc.meta.id);
      if (root) {
        epicInFlight.add(root);
      }
    }
  }

  return {
    byId,
    parentById,
    rootEpicById,
    epicInFlight,
    childOrderIndex: index.orderIndex,
  };
}

export function getRootEpicId(id: string, context: TaskRankingContext): string | undefined {
  return context.rootEpicById.get(id);
}

export function isTaskReady(
  doc: TaskDoc,
  context: TaskRankingContext,
  options: ReadinessOptions = {},
): ReadinessResult {
  const allowedStates = options.includeIdea === true ? READY_STATES_WITH_IDEA : READY_STATES;

  if (!allowedStates.has(doc.meta.state)) {
    return { ready: false, reason: `state=${doc.meta.state}` };
  }

  if (options.allowBlocked !== true && typeof doc.meta.blocked === "string") {
    const message = doc.meta.blocked.trim();
    return {
      ready: false,
      reason: message.length > 0 ? `blocked:${message}` : "blocked",
    };
  }

  const dependencies = doc.meta.depends_on ?? [];
  for (const depId of dependencies) {
    const dependency = context.byId.get(depId);
    if (!dependency) {
      return { ready: false, reason: `missing dependency ${depId}` };
    }
    if (dependency.meta.state !== "done") {
      return {
        ready: false,
        reason: `dependency ${depId} is ${dependency.meta.state}`,
      };
    }
  }

  return { ready: true };
}

export function computeScoreBreakdown(
  doc: TaskDoc,
  context: TaskRankingContext,
  options: RankingOptions = {},
): ScoreBreakdown {
  const priority = PRIORITY_WEIGHT.get(doc.meta.priority) ?? 0;
  const rootEpic = context.rootEpicById.get(doc.meta.id);
  const epicInFlight = rootEpic ? context.epicInFlight.has(rootEpic) : false;

  const size = SIZE_WEIGHT.get(doc.meta.size ?? defaultSize) ?? 0;
  const executorIndex = executorOrder.indexOf(doc.meta.executor ?? defaultExecutor);
  const ambiguity = AMBIGUITY_WEIGHT.get(doc.meta.ambiguity ?? defaultAmbiguity) ?? 0;
  const isolation = ISOLATION_WEIGHT.get(doc.meta.isolation ?? defaultIsolation) ?? 0;
  const updated_at_ms = Date.parse(doc.meta.updated_at ?? "");

  const preference = options.executorPreference;
  const preferenceIndex = preference ? executorOrder.indexOf(preference) : undefined;
  const executor_distance =
    preferenceIndex === undefined || executorIndex < 0
      ? Math.max(0, executorIndex)
      : Math.abs(executorIndex - preferenceIndex);

  return {
    priority,
    epic_in_flight: epicInFlight,
    size,
    executor_index: executorIndex < 0 ? executorOrder.length : executorIndex,
    executor_distance,
    ambiguity,
    isolation,
    updated_at_ms: Number.isFinite(updated_at_ms) ? updated_at_ms : 0,
  };
}

export function compareTasks(
  a: TaskDoc,
  b: TaskDoc,
  context: TaskRankingContext,
  options: RankingOptions = {},
): number {
  const parentA = context.parentById.get(a.meta.id);
  const parentB = context.parentById.get(b.meta.id);
  if (parentA && parentA === parentB) {
    const orderMap = context.childOrderIndex.get(parentA);
    if (orderMap) {
      const indexA = orderMap.get(a.meta.id);
      const indexB = orderMap.get(b.meta.id);
      if (indexA !== undefined || indexB !== undefined) {
        const safeA = indexA ?? Number.MAX_SAFE_INTEGER;
        const safeB = indexB ?? Number.MAX_SAFE_INTEGER;
        if (safeA !== safeB) {
          return safeA - safeB;
        }
      }
    }
  }

  const scoreA = computeScoreBreakdown(a, context, options);
  const scoreB = computeScoreBreakdown(b, context, options);

  if (options.executorPreference) {
    if (scoreA.executor_distance !== scoreB.executor_distance) {
      return scoreA.executor_distance - scoreB.executor_distance;
    }
  }

  if (scoreA.priority !== scoreB.priority) {
    const isolationGap = scoreA.isolation - scoreB.isolation;
    const priorityGap = scoreA.priority - scoreB.priority;
    if (
      isolationGap !== 0 &&
      Math.sign(isolationGap) !== Math.sign(priorityGap) &&
      Math.abs(isolationGap) >= Math.abs(priorityGap)
    ) {
      return scoreB.isolation - scoreA.isolation;
    }
    return scoreB.priority - scoreA.priority;
  }

  if (scoreA.epic_in_flight !== scoreB.epic_in_flight) {
    return scoreA.epic_in_flight ? -1 : 1;
  }

  if (scoreA.size !== scoreB.size) {
    return scoreA.size - scoreB.size;
  }

  const kindWeightA = KIND_WEIGHT.get(a.meta.kind as Kind) ?? 0;
  const kindWeightB = KIND_WEIGHT.get(b.meta.kind as Kind) ?? 0;
  if (kindWeightA !== kindWeightB) {
    return kindWeightA - kindWeightB;
  }

  if (scoreA.isolation !== scoreB.isolation) {
    return scoreB.isolation - scoreA.isolation;
  }

  if (scoreA.executor_distance !== scoreB.executor_distance) {
    return scoreA.executor_distance - scoreB.executor_distance;
  }

  if (scoreA.executor_index !== scoreB.executor_index) {
    return scoreA.executor_index - scoreB.executor_index;
  }

  if (scoreA.ambiguity !== scoreB.ambiguity) {
    return scoreA.ambiguity - scoreB.ambiguity;
  }

  if (scoreA.isolation !== scoreB.isolation) {
    return scoreB.isolation - scoreA.isolation;
  }

  if (scoreA.updated_at_ms !== scoreB.updated_at_ms) {
    return scoreA.updated_at_ms - scoreB.updated_at_ms;
  }

  const titleA = a.meta.title.toLowerCase();
  const titleB = b.meta.title.toLowerCase();
  if (titleA !== titleB) {
    return titleA.localeCompare(titleB);
  }

  return a.meta.id.localeCompare(b.meta.id);
}
