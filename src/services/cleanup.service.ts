import { resolveSectionHeading } from "../domain/sections";
import type { TaskDoc } from "../domain/types";
import { parseRelativeAgeToMs } from "../utils/relativeTime";
import { buildHierarchyIndex } from "./hierarchy";
import type { TaskService } from "./taskService";

export interface CleanupOptions {
  olderThan: string; // e.g., "90d", "6m"
  dryRun: boolean;
}

export interface ExtractedInsights {
  changelog: string[];
  decisions: string[];
  technicalChanges: string[];
}

export interface CleanupResult {
  cleanedTasks: string[]; // task IDs
  summaries: ExtractedInsights;
  errors: Array<{ id: string; error: string }>;
}

export class CleanupService {
  constructor(private readonly taskService: TaskService) {}

  async cleanupTasks(options: CleanupOptions): Promise<CleanupResult> {
    const ageMs = parseRelativeAgeToMs(options.olderThan);
    const cutoffDate = new Date(Date.now() - ageMs);

    // Load all tasks
    const allTasks = await this.taskService.listAllTasks();

    // Filter done tasks older than cutoff
    const candidateTasks = allTasks.filter((task) => {
      if (task.meta.state !== "done") return false;
      if (!task.meta.completed_at) return false;

      const completedDate = new Date(task.meta.completed_at);
      return completedDate < cutoffDate;
    });

    // Validate dependencies
    const validationErrors = this.validateDependencies(candidateTasks, allTasks);
    if (validationErrors.length > 0) {
      return {
        cleanedTasks: [],
        summaries: { changelog: [], decisions: [], technicalChanges: [] },
        errors: validationErrors.map((err) => ({ id: err.taskId, error: err.message })),
      };
    }

    const cleanedIds: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];
    const allInsights: ExtractedInsights = {
      changelog: [],
      decisions: [],
      technicalChanges: [],
    };

    // Process each candidate task
    for (const task of candidateTasks) {
      try {
        const insights = this.extractInsights(task);

        // Only Changelog is required; Decisions and Technical Changes are optional
        if (insights.changelog.length === 0) {
          // Emit warning to stderr for missing changelog
          process.stderr.write(
            `\u001b[33m⚠️  Warning: Task ${task.meta.id} has no Changelog entries in Post-Implementation Insights\u001b[0m\n`,
          );
        }

        // Accumulate insights (even if some sections are empty)
        allInsights.changelog.push(...insights.changelog);
        allInsights.decisions.push(...insights.decisions);
        allInsights.technicalChanges.push(...insights.technicalChanges);

        // Delete the task file (unless dry-run)
        if (!options.dryRun) {
          await this.taskService.deleteTask(task.meta.id, { dryRun: false, cascade: false });
        }

        cleanedIds.push(task.meta.id);
      } catch (error) {
        errors.push({
          id: task.meta.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      cleanedTasks: cleanedIds,
      summaries: allInsights,
      errors,
    };
  }

  private extractInsights(doc: TaskDoc): ExtractedInsights {
    const insightsHeading = resolveSectionHeading("post_implementation_insights");
    const insightsContent = this.extractSectionContent(doc.body, insightsHeading);

    const result: ExtractedInsights = {
      changelog: [],
      decisions: [],
      technicalChanges: [],
    };

    if (!insightsContent) {
      return result;
    }

    // Extract each subsection
    result.changelog = this.extractSubsection(insightsContent, "Changelog", doc.meta.id);
    result.decisions = this.extractSubsection(insightsContent, "Decisions", doc.meta.id);
    const technicalChanges = this.extractSubsection(
      insightsContent,
      "Technical Changes",
      doc.meta.id,
    );
    const legacyArchitecture = this.extractSubsection(insightsContent, "Architecture", doc.meta.id);
    result.technicalChanges = technicalChanges.length > 0 ? technicalChanges : legacyArchitecture;

    return result;
  }

  private extractSubsection(content: string, subsectionName: string, _taskId: string): string[] {
    const pattern = new RegExp(`###\\s+${subsectionName}\\s*\\n([\\s\\S]*?)(?=###\\s+|\\Z)`, "i");
    const match = content.match(pattern);
    if (!match) {
      return [];
    }

    const subsectionContent = match[1].trim();

    // Extract bullet points (without task ID prefix)
    const bulletPattern = /^- (.+)$/gm;
    const bullets: string[] = [];
    let bulletMatch: RegExpExecArray | null = null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Standard pattern for regex iteration
    while ((bulletMatch = bulletPattern.exec(subsectionContent)) !== null) {
      const bullet = bulletMatch[1].trim();
      if (bullet && bullet !== "" && bullet !== "-") {
        bullets.push(bullet);
      }
    }

    return bullets;
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

  private validateDependencies(
    candidateTasks: TaskDoc[],
    allTasks: TaskDoc[],
  ): Array<{ taskId: string; message: string }> {
    const candidateIds = new Set(candidateTasks.map((t) => t.meta.id));
    const errors: Array<{ taskId: string; message: string }> = [];

    // Check if any active task depends on or blocks a candidate task
    const activeTasks = allTasks.filter(
      (t) => t.meta.state !== "done" && t.meta.state !== "canceled",
    );

    for (const activeTask of activeTasks) {
      const dependsOn = activeTask.meta.depends_on ?? [];
      const blocks = activeTask.meta.blocks ?? [];

      for (const depId of dependsOn) {
        if (candidateIds.has(depId)) {
          errors.push({
            taskId: depId,
            message: `Cannot clean up ${depId}: active task ${activeTask.meta.id} depends on it`,
          });
        }
      }

      for (const blockId of blocks) {
        if (candidateIds.has(blockId)) {
          errors.push({
            taskId: blockId,
            message: `Cannot clean up ${blockId}: active task ${activeTask.meta.id} is blocked by it`,
          });
        }
      }
    }

    // Check if any candidate task is a parent of an active task
    const { index } = buildHierarchyIndex(allTasks);

    for (const candidate of candidateTasks) {
      const children = index.childrenById.get(candidate.meta.id) ?? [];
      const activeChildren = children.filter(
        (child) => child.meta.state !== "done" && child.meta.state !== "canceled",
      );

      if (activeChildren.length > 0) {
        errors.push({
          taskId: candidate.meta.id,
          message: `Cannot clean up ${candidate.meta.id}: has active children (${activeChildren.map((c) => c.meta.id).join(", ")})`,
        });
      }
    }

    return errors;
  }
}
