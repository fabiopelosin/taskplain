import { nowUtc } from "../utils/time";
import {
  ambiguityOrder,
  defaultAmbiguity,
  defaultExecutor,
  defaultIsolation,
  defaultSize,
  executorOrder,
  isolationOrder,
  priorityOrder,
  sizeOrder,
  stateOrder,
  TASK_ID_REGEX,
} from "./types";

export interface NormalizationWarning {
  code: string;
  message: string;
  field?: string;
}

export interface NormalizeMetaResult {
  meta: Record<string, unknown>;
  warnings: NormalizationWarning[];
}

const PRIORITY_BY_INDEX = new Map<number, string>(
  priorityOrder.map((priority, index) => [index, priority]),
);

const STATE_ALIASES = new Map<string, string>([
  ["in_progress", "in-progress"],
  ["inprogress", "in-progress"],
  ["in progress", "in-progress"],
  ["cancelled", "canceled"],
]);

const KNOWN_KEYS = new Set<string>([
  "id",
  "title",
  "kind",
  "parent",
  "children",
  "state",
  "priority",
  "blocked",
  "commit_message",
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
]);

export function normalizeMetaInput(data: Record<string, unknown>): NormalizeMetaResult {
  const warnings: NormalizationWarning[] = [];
  const next: Record<string, unknown> = { ...data };

  migrateLegacyDispatchFields(next, warnings);

  if (next.parent === null || next.parent === "") {
    delete next.parent;
    warnings.push({
      code: "parent_removed",
      message: "parent was null → treated as absent",
      field: "parent",
    });
  }

  if (typeof next.state === "string") {
    const normalized = normalizeState(next.state);
    if (normalized && normalized !== next.state) {
      next.state = normalized;
      warnings.push({
        code: "state_normalized",
        message: `state '${next.state}' normalized from '${data.state}'`,
        field: "state",
      });
    }
  }

  if (typeof next.priority === "string" || typeof next.priority === "number") {
    const normalized = normalizePriority(next.priority);
    if (normalized && normalized !== next.priority) {
      next.priority = normalized;
      warnings.push({
        code: "priority_normalized",
        message: `priority normalized to '${normalized}'`,
        field: "priority",
      });
    }
  }

  normalizeBlocked(next, warnings);
  normalizeCommitMessage(next, warnings);

  if (typeof next.labels === "string") {
    const trimmed = (next.labels as string).trim();
    if (trimmed.length > 0) {
      next.labels = [trimmed];
      warnings.push({
        code: "labels_coerced",
        message: "labels string coerced into array",
        field: "labels",
      });
    }
  } else if (Array.isArray(next.labels)) {
    const coerced = next.labels
      .map((value) => (typeof value === "string" ? value.trim() : String(value)))
      .filter((value) => value.length > 0);
    const unique = Array.from(new Set(coerced));
    if (
      unique.length !== coerced.length ||
      coerced.some((value, index) => value !== (next.labels as unknown[])[index])
    ) {
      next.labels = unique;
      warnings.push({
        code: "labels_normalized",
        message: "labels normalized (trimmed, deduped)",
        field: "labels",
      });
    }
  }

  if (typeof next.assignees === "string") {
    const trimmed = (next.assignees as string).trim();
    if (trimmed.length > 0) {
      next.assignees = [trimmed];
      warnings.push({
        code: "assignees_coerced",
        message: "assignees string coerced into array",
        field: "assignees",
      });
    }
  }

  if (Array.isArray(next.links)) {
    next.links = normalizeLinks(next.links, warnings);
  } else if (next.links && typeof next.links === "object") {
    next.links = normalizeLinks([next.links], warnings);
    warnings.push({
      code: "links_coerced",
      message: "links object coerced into array",
      field: "links",
    });
  }

  normalizeDispatchFields(next, warnings);

  const timestampNow = nowUtc();
  if (!next.created_at) {
    next.created_at = timestampNow;
    warnings.push({
      code: "created_at_missing",
      message: "created_at missing → defaulted to now",
      field: "created_at",
    });
  }
  if (!next.updated_at) {
    next.updated_at = next.created_at ?? timestampNow;
    warnings.push({
      code: "updated_at_missing",
      message: "updated_at missing → defaulted to created_at",
      field: "updated_at",
    });
  }
  if (!next.last_activity_at) {
    next.last_activity_at = next.updated_at;
    warnings.push({
      code: "last_activity_missing",
      message: "last_activity_at missing → defaulted to updated_at",
      field: "last_activity_at",
    });
  }

  for (const key of Object.keys(next)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push({
        code: "unknown_meta_key",
        message: `Unknown metadata key '${key}' preserved`,
        field: key,
      });
    }
  }

  if (typeof next.blocked === "string") {
    const state =
      typeof next.state === "string" ? (normalizeState(next.state) ?? next.state) : undefined;
    if (state === "done" || state === "canceled") {
      warnings.push({
        code: "blocked_terminal_state",
        message: "blocked present while state is done/canceled",
        field: "blocked",
      });
    }
  }

  return { meta: next, warnings };
}

function normalizeBlocked(meta: Record<string, unknown>, warnings: NormalizationWarning[]): void {
  if (!Object.hasOwn(meta, "blocked")) {
    return;
  }
  const value = meta.blocked;
  if (value === undefined) {
    delete meta.blocked;
    return;
  }

  if (value === null || value === true || value === false) {
    meta.blocked = "";
    warnings.push({
      code: "blocked_coerced",
      message:
        "blocked true/null coerced to empty string (run taskplain update <id> --unset blocked)",
      field: "blocked",
    });
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trimEnd();
    if (trimmed !== value) {
      meta.blocked = trimmed;
      warnings.push({
        code: "blocked_trimmed",
        message: "blocked message had trailing whitespace removed",
        field: "blocked",
      });
    }
    return;
  }

  // Leave value as is to trigger schema validation error downstream.
}

function normalizeCommitMessage(
  meta: Record<string, unknown>,
  warnings: NormalizationWarning[],
): void {
  if (!Object.hasOwn(meta, "commit_message")) {
    return;
  }

  const value = meta.commit_message;
  if (value === undefined) {
    delete meta.commit_message;
    return;
  }

  if (value === null) {
    delete meta.commit_message;
    warnings.push({
      code: "commit_message_null",
      message: "commit_message was null → treated as absent",
      field: "commit_message",
    });
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    delete meta.commit_message;
    warnings.push({
      code: "commit_message_empty",
      message: "commit_message was blank and removed",
      field: "commit_message",
    });
    return;
  }

  meta.commit_message = trimmed;
  if (trimmed !== value) {
    warnings.push({
      code: "commit_message_trimmed",
      message: "commit_message had surrounding whitespace removed",
      field: "commit_message",
    });
    return;
  }
}

function migrateLegacyDispatchFields(
  meta: Record<string, unknown>,
  warnings: NormalizationWarning[],
): void {
  if (typeof meta.decision_readiness === "string") {
    const normalized = normalizeEnum(meta.decision_readiness, ambiguityOrder);
    if (normalized) {
      if (!meta.ambiguity) {
        meta.ambiguity = normalized;
      }
      warnings.push({
        code: "decision_readiness_migrated",
        message: `decision_readiness → ambiguity (${normalized})`,
        field: "decision_readiness",
      });
    } else {
      warnings.push({
        code: "decision_readiness_unmapped",
        message: `decision_readiness '${meta.decision_readiness}' not recognized`,
        field: "decision_readiness",
      });
    }
    delete meta.decision_readiness;
  }

  if (typeof meta.agent_fit === "string") {
    const normalized = normalizeEnum(meta.agent_fit, executorOrder);
    if (normalized) {
      if (!meta.executor) {
        meta.executor = normalized;
      }
      warnings.push({
        code: "agent_fit_migrated",
        message: `agent_fit → executor (${normalized})`,
        field: "agent_fit",
      });
    } else {
      warnings.push({
        code: "agent_fit_unmapped",
        message: `agent_fit '${meta.agent_fit}' not recognized`,
        field: "agent_fit",
      });
    }
    delete meta.agent_fit;
  }

  if (typeof meta.autonomy_risk === "string") {
    const normalized = normalizeEnum(meta.autonomy_risk, ["low", "medium", "high"]);
    if (normalized === "high") {
      const current = typeof meta.ambiguity === "string" ? meta.ambiguity : undefined;
      if (current !== "high") {
        meta.ambiguity = "high";
      }
      warnings.push({
        code: "autonomy_risk_migrated",
        message: "autonomy_risk: high → ambiguity: high",
        field: "autonomy_risk",
      });
    } else {
      warnings.push({
        code: "autonomy_risk_ignored",
        message: `autonomy_risk '${meta.autonomy_risk}' not mapped (only 'high' supported)`,
        field: "autonomy_risk",
      });
    }
    delete meta.autonomy_risk;
  }
}

function normalizeDispatchFields(
  meta: Record<string, unknown>,
  warnings: NormalizationWarning[],
): void {
  meta.size = normalizeOrDefaultEnum(meta.size, sizeOrder, defaultSize, "size", warnings);
  meta.ambiguity = normalizeOrDefaultEnum(
    meta.ambiguity,
    ambiguityOrder,
    defaultAmbiguity,
    "ambiguity",
    warnings,
  );
  meta.executor = normalizeOrDefaultEnum(
    meta.executor,
    executorOrder,
    defaultExecutor,
    "executor",
    warnings,
  );
  meta.isolation = normalizeOrDefaultEnum(
    meta.isolation,
    isolationOrder,
    defaultIsolation,
    "isolation",
    warnings,
  );

  meta.touches = normalizeStringArray(meta.touches, "touches", warnings);
  meta.depends_on = normalizeIdArray(meta.depends_on, "depends_on", warnings);
  meta.blocks = normalizeIdArray(meta.blocks, "blocks", warnings);

  collectDispatchWarnings(meta, warnings);
}

function normalizeEnum(value: unknown, allowed: readonly string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (allowed.includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function normalizeOrDefaultEnum(
  value: unknown,
  allowed: readonly string[],
  fallback: string,
  field: string,
  warnings: NormalizationWarning[],
): string {
  if (typeof value === "string") {
    const normalized = normalizeEnum(value, allowed);
    if (normalized) {
      return normalized;
    }
    warnings.push({
      code: `${field}_invalid`,
      message: `${field} '${value}' not recognized → defaulted to ${fallback}`,
      field,
    });
  } else if (value !== undefined) {
    warnings.push({
      code: `${field}_invalid_type`,
      message: `${field} expected string → defaulted to ${fallback}`,
      field,
    });
  }
  return fallback;
}

function normalizeStringArray(
  value: unknown,
  field: string,
  warnings: NormalizationWarning[],
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = coerceArray(value, field, warnings);
  if (!values) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      values
        .map((item, index) => {
          if (typeof item !== "string") {
            warnings.push({
              code: `${field}_coerced`,
              message: `${field}[${index}] was not a string and was dropped`,
              field,
            });
            return null;
          }
          const trimmed = item.trim();
          if (trimmed.length === 0) {
            warnings.push({
              code: `${field}_empty_entry`,
              message: `${field}[${index}] was empty and removed`,
              field,
            });
            return null;
          }
          return trimmed;
        })
        .filter((entry): entry is string => entry !== null),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIdArray(
  value: unknown,
  field: string,
  warnings: NormalizationWarning[],
): string[] | undefined {
  const normalized = normalizeStringArray(value, field, warnings);
  if (!normalized) {
    return undefined;
  }
  const lowered = Array.from(new Set(normalized.map((entry) => entry.toLowerCase())));
  const invalid = lowered.filter((entry) => !TASK_ID_REGEX.test(entry));
  if (invalid.length > 0) {
    warnings.push({
      code: `${field}_invalid_id`,
      message: `${field} contains invalid ids: ${invalid.join(", ")}`,
      field,
    });
  }
  return lowered;
}

function coerceArray(
  value: unknown,
  field: string,
  warnings: NormalizationWarning[],
): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const raw = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (raw.length === 0) {
      return undefined;
    }
    warnings.push({
      code: `${field}_coerced`,
      message: `${field} string coerced into array`,
      field,
    });
    return raw;
  }
  warnings.push({
    code: `${field}_invalid_type`,
    message: `${field} expected array or comma string`,
    field,
  });
  return undefined;
}

function collectDispatchWarnings(
  meta: Record<string, unknown>,
  warnings: NormalizationWarning[],
): void {
  if (meta.size === "xl" && (meta.isolation === "isolated" || meta.isolation === "module")) {
    warnings.push({
      code: "size_isolation_mismatch",
      message: "size 'xl' rarely stays isolated/module. Double-check isolation",
      field: "size",
    });
  }
  if (meta.executor === "simple" && meta.ambiguity === "high") {
    warnings.push({
      code: "executor_ambiguity_mismatch",
      message: "executor 'simple' with ambiguity 'high' may need escalation",
      field: "executor",
    });
  }
}

function normalizeState(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (STATE_ALIASES.has(trimmed)) {
    return STATE_ALIASES.get(trimmed);
  }
  const canonical = trimmed.replace(/_/g, "-").replace(/\s+/g, "-");
  if (STATE_ALIASES.has(canonical)) {
    return STATE_ALIASES.get(canonical);
  }
  if (stateOrder.includes(trimmed as (typeof stateOrder)[number])) {
    return trimmed;
  }
  return value;
}

function normalizePriority(value: string | number): string | undefined {
  if (typeof value === "number" && PRIORITY_BY_INDEX.has(value)) {
    return PRIORITY_BY_INDEX.get(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (priorityOrder.includes(trimmed as (typeof priorityOrder)[number])) {
      return trimmed;
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isInteger(numeric) && PRIORITY_BY_INDEX.has(numeric)) {
      return PRIORITY_BY_INDEX.get(numeric);
    }
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeLinks(links: unknown[], warnings: NormalizationWarning[]): unknown[] {
  return links.map((link, index) => {
    if (typeof link !== "object" || link === null) {
      warnings.push({
        code: "link_not_object",
        message: `links[${index}] was not an object and was preserved as-is`,
        field: "links",
      });
      return link;
    }
    const copy: Record<string, unknown> = {
      ...(link as Record<string, unknown>),
    };
    if (copy.number && typeof copy.number === "string") {
      const parsed = Number.parseInt(copy.number, 10);
      if (Number.isFinite(parsed)) {
        copy.number = parsed;
        warnings.push({
          code: "link_number_normalized",
          message: `links[${index}].number coerced to integer`,
          field: "links",
        });
      }
    }
    return copy;
  });
}
