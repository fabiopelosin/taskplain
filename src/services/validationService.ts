import path from "node:path";

import { stateDir } from "../domain/paths";
import { resolveSectionHeading } from "../domain/sections";
import {
  requiredHeadingsForState,
  TASK_ID_REGEX,
  type TaskDoc,
  taskDocSchema,
} from "../domain/types";
import { buildHierarchyIndex } from "./hierarchy";

export interface ValidationError {
  code: string;
  message: string;
  file: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export type ValidateCollectionOptions = Record<string, never>;

export class ValidationService {
  validate(doc: TaskDoc): ValidationResult {
    const errors = this.validateDocument(doc);
    return {
      ok: errors.length === 0,
      errors,
    };
  }

  validateAll(docs: TaskDoc[], _options: ValidateCollectionOptions = {}): ValidationResult {
    const documentErrors: ValidationError[] = [];
    for (const doc of docs) {
      documentErrors.push(...this.validateDocument(doc));
    }

    const crossErrors = this.validateCrossDocument(docs);
    const errors = [...documentErrors, ...crossErrors];
    return {
      ok: errors.length === 0,
      errors,
    };
  }

  validateDocument(doc: TaskDoc): ValidationError[] {
    const errors: ValidationError[] = [];

    const parse = taskDocSchema.safeParse(doc);
    if (!parse.success) {
      errors.push({
        code: "schema",
        message: parse.error.message,
        file: doc.path,
      });
    }

    const bodyWithoutComments = doc.body.replace(/<!--[\s\S]*?-->/g, "");
    const normalizedBody = bodyWithoutComments.replace(/\r\n/g, "\n");
    const stateSpecificHeadings = requiredHeadingsForState(doc.meta.state);
    for (const heading of stateSpecificHeadings) {
      const headingPattern = new RegExp(`^${escapeForRegExp(heading)}\\s*$`, "m");
      if (!headingPattern.test(normalizedBody)) {
        errors.push({
          code: "heading",
          message: `Missing required heading: ${heading}`,
          file: doc.path,
        });
      }
    }

    const acceptanceContent = extractSectionContent(doc.body, ACCEPTANCE_CRITERIA_HEADING);
    if (acceptanceContent !== null) {
      const acceptanceWithoutComments = acceptanceContent.replace(/<!--[\s\S]*?-->/g, "");
      const trimmedLines = acceptanceWithoutComments
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const checkboxLines = trimmedLines.filter((line) => !/^[-*]\s+\[(?: |x|X)\]\s*$/.test(line));
      if (checkboxLines.length === 0) {
        errors.push({
          code: "acceptance_criteria_empty",
          message: "Acceptance Criteria must include at least one checkbox item.",
          file: doc.path,
        });
      } else {
        const invalidLine = checkboxLines.find((line) => !/^[-*]\s+\[(?: |x|X)\]\s+.+$/.test(line));
        if (invalidLine) {
          errors.push({
            code: "acceptance_criteria_format",
            message:
              "Acceptance Criteria must be a list of checkbox bullet points (e.g., '- [ ] Description').",
            file: doc.path,
          });
        }

        // Check if all checkboxes are completed but task is not done
        if (doc.meta.state !== "done" && doc.meta.state !== "canceled") {
          const allCompleted = checkboxLines.every((line) => /^[-*]\s+\[x|X\]\s+.+$/.test(line));
          if (allCompleted && checkboxLines.length > 0) {
            errors.push({
              code: "all_acceptance_criteria_completed",
              message:
                "All acceptance criteria checkboxes are completed. Task should be marked as done using 'taskplain complete'.",
              file: doc.path,
            });
          }
        }
      }
    }

    const dirName = path.basename(path.dirname(doc.path));
    const expectedDir = stateDir(doc.meta.state).split("/").pop();
    if (expectedDir && dirName !== expectedDir) {
      errors.push({
        code: "path",
        message: `File resides in '${dirName}' but state '${doc.meta.state}' expects '${expectedDir}'`,
        file: doc.path,
      });
    }

    const fileName = path.basename(doc.path);
    if (doc.meta.state === "done") {
      const expectedSuffix = `${doc.meta.kind}-${doc.meta.id}.md`;
      if (!fileName.endsWith(expectedSuffix) || !/^\d{4}-\d{2}-\d{2} /.test(fileName)) {
        errors.push({
          code: "filename",
          message: "Done tasks must be prefixed with completion date (YYYY-MM-DD)",
          file: doc.path,
        });
      }
    } else {
      const expected = `${doc.meta.kind}-${doc.meta.id}.md`;
      if (fileName !== expected) {
        errors.push({
          code: "filename",
          message: `Expected filename '${expected}' for state '${doc.meta.state}'`,
          file: doc.path,
        });
      }
    }

    return errors;
  }

  validateCrossDocument(docs: TaskDoc[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const idMap = new Map<string, TaskDoc>();

    for (const doc of docs) {
      if (idMap.has(doc.meta.id)) {
        errors.push({
          code: "duplicate_id",
          message: `Duplicate task id '${doc.meta.id}' detected`,
          file: doc.path,
        });
      } else {
        idMap.set(doc.meta.id, doc);
      }
    }

    const { index, issues } = buildHierarchyIndex(docs);

    for (const doc of docs) {
      if (doc.meta.parent) {
        errors.push({
          code: "legacy_parent_metadata",
          message: `Task '${doc.meta.id}' still declares legacy parent '${doc.meta.parent}'. Run 'taskplain validate --fix' to migrate to parent-owned children.`,
          file: doc.path,
        });
      }

      if (doc.meta.children && doc.meta.kind === "task") {
        errors.push({
          code: "invalid_children_kind",
          message: `Task '${doc.meta.id}' cannot declare children`,
          file: doc.path,
        });
      }
    }

    for (const issue of issues.missingChildren) {
      const parentDoc = idMap.get(issue.parentId);
      errors.push({
        code: "missing_child_reference",
        message: `Parent '${issue.parentId}' references missing child '${issue.childId}'`,
        file: parentDoc ? parentDoc.path : (idMap.get(issue.childId)?.path ?? ""),
      });
    }

    for (const issue of issues.duplicateChildren) {
      const parentDoc = idMap.get(issue.parentId);
      if (!parentDoc) {
        continue;
      }
      errors.push({
        code: "duplicate_child_reference",
        message: `Parent '${issue.parentId}' lists child '${issue.childId}' more than once`,
        file: parentDoc.path,
      });
    }

    for (const issue of issues.legacyOnlyChildren) {
      const parentDoc = idMap.get(issue.parentId);
      const childDoc = idMap.get(issue.childId);
      errors.push({
        code: "child_not_listed",
        message: `Child '${issue.childId}' is missing from parent '${issue.parentId}' children list`,
        file: parentDoc ? parentDoc.path : (childDoc?.path ?? ""),
      });
    }

    for (const issue of issues.conflictingParents) {
      const childDoc = idMap.get(issue.childId);
      errors.push({
        code: "conflicting_parent",
        message: `Child '${issue.childId}' is declared under '${issue.declaredParentId}' but also linked to '${issue.legacyParentId}'`,
        file: childDoc ? childDoc.path : "",
      });
    }

    const parentChildren = index.childrenById;

    for (const [parentId, childDocs] of parentChildren) {
      const parentDoc = idMap.get(parentId);
      if (!parentDoc) {
        continue;
      }
      for (const child of childDocs) {
        if (parentDoc.meta.kind === "epic" && child.meta.kind !== "story") {
          errors.push({
            code: "invalid_child_kind",
            message: `Epic '${parentId}' can only list stories as children; found '${child.meta.id}' (${child.meta.kind})`,
            file: parentDoc.path,
          });
        }
        if (parentDoc.meta.kind === "story" && child.meta.kind !== "task") {
          errors.push({
            code: "invalid_child_kind",
            message: `Story '${parentId}' can only list tasks as children; found '${child.meta.id}' (${child.meta.kind})`,
            file: parentDoc.path,
          });
        }
      }
    }

    for (const doc of docs) {
      const parentId = index.parentById.get(doc.meta.id);

      if (!parentId) {
        continue;
      }

      const parentDoc = idMap.get(parentId);
      if (!parentDoc) {
        errors.push({
          code: "missing_parent",
          message: `Parent '${parentId}' not found for task '${doc.meta.id}'`,
          file: doc.path,
        });
        continue;
      }

      if (doc.meta.kind === "story" && parentDoc.meta.kind !== "epic") {
        errors.push({
          code: "invalid_parent_kind",
          message: `Story '${doc.meta.id}' must have an epic parent`,
          file: doc.path,
        });
      }
      if (doc.meta.kind === "task" && parentDoc.meta.kind !== "story") {
        errors.push({
          code: "invalid_parent_kind",
          message: `Task '${doc.meta.id}' must have a story parent`,
          file: doc.path,
        });
      }
      if (doc.meta.kind === "epic") {
        errors.push({
          code: "invalid_parent_kind",
          message: `Epic '${doc.meta.id}' cannot have a parent`,
          file: doc.path,
        });
      }

      const { depth, cycleDetected } = this.computeDepthAndCycles(doc, index.parentById);
      if (cycleDetected) {
        errors.push({
          code: "cycle",
          message: `Parent cycle detected starting at '${doc.meta.id}'`,
          file: doc.path,
        });
      }
      if (depth > 3) {
        errors.push({
          code: "depth_exceeded",
          message: `Hierarchy depth for '${doc.meta.id}' exceeds allowed maximum`,
          file: doc.path,
        });
      }
    }

    for (const doc of docs) {
      if (doc.meta.state !== "done") {
        continue;
      }
      if (doc.meta.kind === "epic" || doc.meta.kind === "story") {
        const children = parentChildren.get(doc.meta.id) ?? [];
        const queue = [...children];
        while (queue.length > 0) {
          const child = queue.shift();
          if (!child) continue;
          if (child.meta.state !== "done" && child.meta.state !== "canceled") {
            errors.push({
              code: "incomplete_descendant",
              message: `Cannot mark '${doc.meta.id}' done while descendant '${child.meta.id}' is ${child.meta.state}`,
              file: doc.path,
            });
            break;
          }
          const grandChildren = parentChildren.get(child.meta.id);
          if (grandChildren) {
            queue.push(...grandChildren);
          }
        }
      }
    }

    for (const doc of docs) {
      this.validateReferenceField(doc, idMap, errors, "depends_on", "missing_dependency");
      this.validateReferenceField(doc, idMap, errors, "blocks", "missing_block_target");
    }

    return errors;
  }

  /**
   * Detect non-fatal parent/child state anomalies and return them as warnings.
   * These are heuristics intended to surface likely-drift situations without blocking.
   */
  detectParentChildStateWarnings(
    docs: TaskDoc[],
  ): Array<{ code: string; message: string; file: string; field?: string }> {
    const warnings: Array<{ code: string; message: string; file: string; field?: string }> = [];
    if (docs.length === 0) {
      return warnings;
    }
    const { index } = buildHierarchyIndex(docs);
    const idMap = new Map<string, TaskDoc>(docs.map((d) => [d.meta.id, d]));

    for (const [parentId, children] of index.childrenById) {
      const parent = idMap.get(parentId);
      if (!parent) continue;
      if (children.length === 0) continue;

      const parentState = parent.meta.state;
      const childStates = children.map((c) => ({ id: c.meta.id, state: c.meta.state }));

      // idea parent + done children → parent may be stale
      if (parentState === "idea" && childStates.some((c) => c.state === "done")) {
        const doneChildren = childStates.filter((c) => c.state === "done").map((c) => c.id);
        const hint =
          "Hint: Consider promoting the parent or adjusting children. " +
          "Use `taskplain move <id> ready` or `taskplain move <id> in-progress`.";
        warnings.push({
          code: "state_anomaly",
          message: `Parent '${parentId}' is in idea but has completed children (${doneChildren.join(", ")}).\n    ${hint}`,
          file: parent.path,
        });
      }

      // idea parent + in-progress children → progression anomaly
      if (parentState === "idea" && childStates.some((c) => c.state === "in-progress")) {
        const ipChildren = childStates.filter((c) => c.state === "in-progress").map((c) => c.id);
        const hint =
          "Hint: Consider promoting the parent to reflect active work. " +
          "Use `taskplain move <id> ready`.";
        warnings.push({
          code: "state_progression",
          message: `Parent '${parentId}' is in idea but child ${ipChildren.join(", ")} is in-progress.\n    ${hint}`,
          file: parent.path,
        });
      }

      // canceled parent + active children (ready/in-progress) → inconsistent intent
      if (
        parentState === "canceled" &&
        childStates.some((c) => c.state === "ready" || c.state === "in-progress")
      ) {
        const active = childStates
          .filter((c) => c.state === "ready" || c.state === "in-progress")
          .map((c) => `${c.id}:${c.state}`);
        const hint =
          "Hint: Consider canceling children or restoring the parent. " +
          "Use `taskplain move <parent> canceled --cascade cancel` or move children individually.";
        warnings.push({
          code: "inconsistent_cancellation",
          message: `Parent '${parentId}' is canceled but has active children (${active.join(", ")}).\n    ${hint}`,
          file: parent.path,
        });
      }

      // done parent + canceled children → incomplete closure (allowed but noteworthy)
      if (parentState === "done" && childStates.some((c) => c.state === "canceled")) {
        const canceled = childStates.filter((c) => c.state === "canceled").map((c) => c.id);
        const hint =
          "Hint: If cancellation is expected, ignore. Otherwise, revisit scope alignment.";
        warnings.push({
          code: "incomplete_closure",
          message: `Parent '${parentId}' is done but has canceled children (${canceled.join(", ")}).\n    ${hint}`,
          file: parent.path,
        });
      }
    }

    return warnings;
  }

  private computeDepthAndCycles(
    doc: TaskDoc,
    parentById: Map<string, string | undefined>,
  ): { depth: number; cycleDetected: boolean } {
    let depth = 1;
    let cycleDetected = false;
    const seen = new Set<string>([doc.meta.id]);
    let currentId: string | undefined = doc.meta.id;

    while (currentId) {
      const parentId = parentById.get(currentId);
      if (!parentId) {
        break;
      }
      if (seen.has(parentId)) {
        cycleDetected = true;
        break;
      }
      seen.add(parentId);
      depth += 1;
      currentId = parentId;
    }

    return { depth, cycleDetected };
  }

  private validateReferenceField(
    doc: TaskDoc,
    idMap: Map<string, TaskDoc>,
    errors: ValidationError[],
    field: "depends_on" | "blocks",
    missingCode: string,
  ): void {
    const values = doc.meta[field];
    if (!values || values.length === 0) {
      return;
    }
    const seen = new Set<string>();
    for (const target of values) {
      if (!TASK_ID_REGEX.test(target)) {
        errors.push({
          code: `${field}_invalid_id`,
          message: `${field} entry '${target}' is not a valid task id`,
          file: doc.path,
        });
        continue;
      }
      if (target === doc.meta.id) {
        errors.push({
          code: `${field}_self_reference`,
          message: `${field} cannot include the task itself (${target})`,
          file: doc.path,
        });
        continue;
      }
      if (!idMap.has(target)) {
        errors.push({
          code: missingCode,
          message: `${field} references missing task '${target}'`,
          file: doc.path,
        });
      }
      if (seen.has(target)) {
        errors.push({
          code: `${field}_duplicate`,
          message: `${field} contains duplicate reference '${target}'`,
          file: doc.path,
        });
      }
      seen.add(target);
    }
  }
}

const ACCEPTANCE_CRITERIA_HEADING = resolveSectionHeading("acceptance_criteria");

function extractSectionContent(body: string, heading: string): string | null {
  const escapedHeading = escapeForRegExp(heading);
  const pattern = new RegExp(`^${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
  const match = body.match(pattern);
  if (!match) {
    return null;
  }
  return match[1].trimEnd();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
