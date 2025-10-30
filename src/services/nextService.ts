import {
  type Ambiguity,
  ambiguityOrder,
  type Executor,
  executorOrder,
  type Isolation,
  isolationOrder,
  type Kind,
  type Size,
  sizeOrder,
  type TaskDoc,
} from "../domain/types";
import {
  buildRankingContext,
  compareTasks,
  computeScoreBreakdown,
  getRootEpicId,
  isTaskReady,
  type ScoreBreakdown,
  type TaskRankingContext,
} from "./taskRanking";

const SIZE_INDEX = new Map<Size, number>();
const AMBIGUITY_INDEX = new Map<Ambiguity, number>();
const ISOLATION_INDEX = new Map<Isolation, number>();
const EXECUTOR_INDEX = new Map<Executor, number>();

export interface NextOptions {
  count: number;
  kinds: Set<Kind>;
  executorPreference?: Executor;
  maxSize?: Size;
  ambiguityFilter?: Set<Ambiguity>;
  isolationFilter?: Set<Isolation>;
  parent?: string;
  parallelize?: number;
  includeRootWithoutKind?: boolean;
  includeBlocked?: boolean;
}

export interface RankedCandidate {
  doc: TaskDoc;
  rootEpicId?: string;
  epicInFlight: boolean;
  score: ScoreBreakdown;
  touchTokens: string[];
  touches: string[];
}

export interface ConflictSkip {
  candidate: RankedCandidate;
  conflictsWith: string[];
}

export interface NextResult {
  candidates: RankedCandidate[];
  selected: RankedCandidate[];
  skippedDueToConflicts: ConflictSkip[];
}

const GLOBAL_TOKEN = "__GLOBAL__";

sizeEnumIndex();
ambiguityEnumIndex();
isolationEnumIndex();
executorEnumIndex();

function sizeEnumIndex(): void {
  if (SIZE_INDEX.size > 0) return;
  sizeOrder.forEach((value, index) => {
    SIZE_INDEX.set(value, index);
  });
}

function ambiguityEnumIndex(): void {
  if (AMBIGUITY_INDEX.size > 0) return;
  ambiguityOrder.forEach((value, index) => {
    AMBIGUITY_INDEX.set(value, index);
  });
}

function isolationEnumIndex(): void {
  if (ISOLATION_INDEX.size > 0) return;
  isolationOrder.forEach((value, index) => {
    ISOLATION_INDEX.set(value, index);
  });
}

function executorEnumIndex(): void {
  if (EXECUTOR_INDEX.size > 0) return;
  executorOrder.forEach((value, index) => {
    EXECUTOR_INDEX.set(value, index);
  });
}

export class NextService {
  private readonly context: TaskRankingContext;

  constructor(private readonly tasks: TaskDoc[]) {
    this.context = buildRankingContext(tasks);
  }

  evaluate(options: NextOptions): NextResult {
    const ranked = this.buildRankedCandidates(options);
    let selected: RankedCandidate[] = [];
    let skipped: ConflictSkip[] = [];

    if (options.parallelize && options.parallelize > 0) {
      const selection = this.selectParallelSafe(ranked, options.parallelize);
      selected = selection.selected;
      skipped = selection.skipped;
    } else {
      selected = ranked.slice(0, options.count);
    }

    const candidateLimit = Math.max(options.count, options.parallelize ?? 0);
    const limit = candidateLimit > 0 ? candidateLimit : options.count;
    const candidates = ranked.slice(0, Math.max(limit, selected.length));

    return {
      candidates,
      selected,
      skippedDueToConflicts: skipped,
    };
  }

  private buildRankedCandidates(options: NextOptions): RankedCandidate[] {
    const sizeThreshold = options.maxSize
      ? (SIZE_INDEX.get(options.maxSize) ?? Infinity)
      : Infinity;
    const ambiguityFilter = options.ambiguityFilter;
    const isolationFilter = options.isolationFilter;
    const executorPreference = options.executorPreference;
    const kinds = options.kinds;
    const includeRootWithoutKind = options.includeRootWithoutKind === true;
    const parentFilter = options.parent;
    const includeBlocked = options.includeBlocked === true;

    const readyDocs: TaskDoc[] = [];
    for (const doc of this.tasks) {
      const derivedParent = this.context.parentById.get(doc.meta.id);
      const hasParent = typeof derivedParent === "string" && derivedParent.length > 0;
      if (hasParent) {
        if (!kinds.has(doc.meta.kind)) {
          continue;
        }
      } else {
        if (!includeRootWithoutKind && !kinds.has(doc.meta.kind)) {
          continue;
        }
      }
      if (doc.meta.state !== "ready") {
        continue;
      }
      if (
        doc.meta.kind !== "task" &&
        doc.meta.kind !== "story" &&
        doc.meta.kind !== "epic" &&
        !kinds.has(doc.meta.kind)
      ) {
        continue;
      }
      const readiness = isTaskReady(doc, this.context, {
        allowBlocked: includeBlocked,
      });
      if (!readiness.ready) {
        continue;
      }

      const sizeIndex = SIZE_INDEX.get(doc.meta.size ?? "medium") ?? Infinity;
      if (sizeIndex > sizeThreshold) {
        continue;
      }

      if (ambiguityFilter && ambiguityFilter.size > 0) {
        if (!ambiguityFilter.has(doc.meta.ambiguity ?? "low")) {
          continue;
        }
      }

      if (isolationFilter && isolationFilter.size > 0) {
        if (!isolationFilter.has(doc.meta.isolation ?? "module")) {
          continue;
        }
      }

      if (parentFilter && !this.matchesParentFilter(doc, parentFilter)) {
        continue;
      }

      readyDocs.push(doc);
    }

    readyDocs.sort((a, b) => {
      const stateDiff = stateOrderIndex(a.meta.state) - stateOrderIndex(b.meta.state);
      if (stateDiff !== 0) {
        return stateDiff;
      }
      return compareTasks(a, b, this.context, { executorPreference });
    });

    return readyDocs.map((doc) => {
      const rootEpicId = getRootEpicId(doc.meta.id, this.context);
      const score = computeScoreBreakdown(doc, this.context, {
        executorPreference,
      });
      const touchTokens = buildTouchTokens(doc);
      return {
        doc,
        rootEpicId,
        epicInFlight: rootEpicId ? this.context.epicInFlight.has(rootEpicId) : false,
        score,
        touchTokens,
        touches: [...(doc.meta.touches ?? [])],
      };
    });
  }

  private selectParallelSafe(
    candidates: RankedCandidate[],
    selectionCount: number,
  ): { selected: RankedCandidate[]; skipped: ConflictSkip[] } {
    const selected: RankedCandidate[] = [];
    const skipped: ConflictSkip[] = [];

    for (const candidate of candidates) {
      const conflictsWith = findConflicts(candidate, selected);
      if (conflictsWith.length > 0) {
        skipped.push({ candidate, conflictsWith });
        continue;
      }
      if (selected.length < selectionCount) {
        selected.push(candidate);
        continue;
      }

      let lowestIndex = -1;
      let lowestPriority = Number.POSITIVE_INFINITY;
      for (let index = 0; index < selected.length; index += 1) {
        const current = selected[index];
        if (current.score.priority < lowestPriority) {
          lowestPriority = current.score.priority;
          lowestIndex = index;
        }
      }

      if (lowestIndex >= 0 && candidate.score.priority > lowestPriority) {
        selected[lowestIndex] = candidate;
      }
    }

    if (selected.length >= selectionCount) {
      return { selected, skipped };
    }

    for (const candidate of candidates) {
      if (selected.length >= selectionCount) {
        break;
      }
      if (selected.includes(candidate)) {
        continue;
      }
      selected.push(candidate);
    }

    return { selected, skipped };
  }

  private matchesParentFilter(doc: TaskDoc, parentId: string): boolean {
    if (!parentId) {
      return true;
    }
    if (doc.meta.id === parentId) {
      return true;
    }
    let current = this.context.parentById.get(doc.meta.id);
    while (current) {
      if (current === parentId) {
        return true;
      }
      current = this.context.parentById.get(current);
    }
    return false;
  }
}

function stateOrderIndex(state: TaskDoc["meta"]["state"]): number {
  switch (state) {
    case "ready":
      return 0;
    case "in-progress":
      return 1;
    case "idea":
      return 2;
    default:
      return 3;
  }
}

function buildTouchTokens(doc: TaskDoc): string[] {
  const raw = doc.meta.touches ?? [];
  if (raw.length === 0) {
    if (doc.meta.isolation === "shared" || doc.meta.isolation === "global") {
      return [GLOBAL_TOKEN];
    }
    return [];
  }

  const tokens = raw
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map(normalizePattern);

  if (tokens.length === 0) {
    return [GLOBAL_TOKEN];
  }
  return Array.from(new Set(tokens));
}

function normalizePattern(pattern: string): string {
  let normalized = pattern.replace(/\*\*/g, "*");
  normalized = normalized.replace(/\*+$/g, "");
  normalized = normalized.replace(/\/+/g, "/");
  normalized = normalized.replace(/\/$/, "");
  if (normalized.length === 0) {
    return GLOBAL_TOKEN;
  }
  return normalized;
}

function findConflicts(candidate: RankedCandidate, selected: RankedCandidate[]): string[] {
  if (candidate.touchTokens.length === 0) {
    return [];
  }
  const conflicts: string[] = [];
  for (const existing of selected) {
    if (patternsOverlap(candidate.touchTokens, existing.touchTokens)) {
      conflicts.push(existing.doc.meta.id);
    }
  }
  return conflicts;
}

function patternsOverlap(a: string[], b: string[]): boolean {
  for (const tokenA of a) {
    for (const tokenB of b) {
      if (tokenConflict(tokenA, tokenB)) {
        return true;
      }
    }
  }
  return false;
}

function tokenConflict(a: string, b: string): boolean {
  if (a === GLOBAL_TOKEN || b === GLOBAL_TOKEN) {
    return true;
  }
  if (a === b) {
    return true;
  }
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
    return true;
  }
  if (a.startsWith(b) || b.startsWith(a)) {
    return true;
  }
  return false;
}
