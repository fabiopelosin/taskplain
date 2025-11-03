import fs from "node:fs/promises";
import matter from "gray-matter";
import YAML from "yaml";
import { type NormalizationWarning, normalizeMetaInput } from "../domain/normalization";
import {
  requiredHeadingsForState,
  type TaskDoc,
  type TaskMeta,
  taskDocSchema,
  taskMetaSchema,
} from "../domain/types";

export const META_KEY_ORDER: (keyof TaskMeta)[] = [
  "id",
  "title",
  "kind",
  "parent",
  "children",
  "state",
  "blocked",
  "commit_message",
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
  "execution",
];

export function orderTaskMeta(meta: TaskMeta): TaskMeta {
  const entries: [keyof TaskMeta, TaskMeta[keyof TaskMeta]][] = [];
  const seen = new Set<keyof TaskMeta>();

  for (const key of META_KEY_ORDER) {
    const value = meta[key];
    if (value !== undefined) {
      entries.push([key, value]);
      seen.add(key);
    }
  }

  for (const key of Object.keys(meta) as (keyof TaskMeta)[]) {
    if (seen.has(key)) {
      continue;
    }
    const value = meta[key];
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }

  return Object.fromEntries(entries) as TaskMeta;
}

export interface TaskFileReadResult {
  doc: TaskDoc;
  warnings: NormalizationWarning[];
}

export async function readTaskFile(filePath: string): Promise<TaskFileReadResult> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const normalized = normalizeMetaInput(normalizeMeta(parsed.data));
  const meta = taskMetaSchema.parse(normalized.meta);
  const doc = taskDocSchema.parse({
    meta,
    body: parsed.content.trimEnd(),
    path: filePath,
  });
  const warnings = collectBodyWarnings(doc, normalized.warnings);
  return { doc, warnings };
}

function collectBodyWarnings(
  doc: TaskDoc,
  existing: NormalizationWarning[],
): NormalizationWarning[] {
  const warnings = [...existing];
  const bodyWithoutComments = doc.body.replace(/<!--[\s\S]*?-->/g, "");
  const normalizedBody = bodyWithoutComments.replace(/\r\n/g, "\n");
  const stateSpecificHeadings = requiredHeadingsForState(doc.meta.state);
  for (const heading of stateSpecificHeadings) {
    const headingRegex = new RegExp(`^${escapeForRegExp(heading)}\\s*$`, "m");
    if (!headingRegex.test(normalizedBody)) {
      warnings.push({
        code: "missing_heading",
        message: `Missing required heading: ${heading}`,
        field: "body",
      });
    }
  }
  return warnings;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMeta(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  const timestampKeys = ["created_at", "updated_at", "last_activity_at", "completed_at"];
  for (const key of timestampKeys) {
    if (key in copy) {
      const value = copy[key];
      if (value instanceof Date) {
        copy[key] = value.toISOString();
      }
      if (value === null && key === "completed_at") {
        copy[key] = null;
      }
    }
  }

  const execution = copy.execution;
  if (execution && typeof execution === "object" && Array.isArray((execution as any).attempts)) {
    const attempts = (execution as any).attempts as Array<Record<string, unknown>>;
    for (const attempt of attempts) {
      if (attempt && typeof attempt === "object") {
        for (const field of ["started_at", "ended_at"]) {
          const value = attempt[field];
          if (value instanceof Date) {
            attempt[field] = value.toISOString();
          }
        }
        const reviewer = attempt.reviewer;
        if (reviewer && typeof reviewer === "object") {
          const reviewedAt = (reviewer as Record<string, unknown>).reviewed_at;
          if (reviewedAt instanceof Date) {
            (reviewer as Record<string, unknown>).reviewed_at = reviewedAt.toISOString();
          }
        }
      }
    }
  }
  return copy;
}

export function serializeTaskDoc(doc: TaskDoc): string {
  const normalizedMeta = normalizeMeta(doc.meta);
  const meta = taskMetaSchema.parse(normalizedMeta);
  const validated = { meta, body: doc.body, path: doc.path } as TaskDoc;
  const orderedMeta = orderTaskMeta(validated.meta);
  const yamlDoc = new YAML.Document(orderedMeta);
  const frontMatter = `---\n${yamlDoc.toString({ lineWidth: 0 }).trim()}\n---\n`;
  const body = validated.body.endsWith("\n") ? validated.body : `${validated.body}\n`;
  const separator = validated.body.startsWith("\n") ? "" : "\n";
  return `${frontMatter}${separator}${body}`;
}

export async function writeTaskFile(filePath: string, doc: TaskDoc): Promise<void> {
  const content = serializeTaskDoc(doc);
  await fs.writeFile(filePath, content, "utf8");
}
