import { z } from "zod";

export const stateOrder = ["idea", "ready", "in-progress", "done", "canceled"] as const;

export const kindOrder = ["epic", "story", "task"] as const;

export const priorityOrder = ["none", "low", "normal", "high", "urgent"] as const;

export const sizeOrder = ["tiny", "small", "medium", "large", "xl"] as const;
export const ambiguityOrder = ["low", "medium", "high"] as const;
export const executorOrder = ["simple", "standard", "expert", "human_review"] as const;
export const isolationOrder = ["isolated", "module", "shared", "global"] as const;

export const defaultSize: (typeof sizeOrder)[number] = "medium";
export const defaultAmbiguity: (typeof ambiguityOrder)[number] = "low";
export const defaultExecutor: (typeof executorOrder)[number] = "standard";
export const defaultIsolation: (typeof isolationOrder)[number] = "module";

export const TASK_ID_REGEX = /^[a-z0-9-]+$/;

export type State = (typeof stateOrder)[number];
export type Kind = (typeof kindOrder)[number];
export type Priority = (typeof priorityOrder)[number];
export type Size = (typeof sizeOrder)[number];
export type Ambiguity = (typeof ambiguityOrder)[number];
export type Executor = (typeof executorOrder)[number];
export type Isolation = (typeof isolationOrder)[number];

export const linkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github_issue"),
    repo: z.string().min(1).optional(),
    number: z.number().int().positive(),
    key: z.never().optional(),
  }),
  z.object({
    type: z.literal("linear"),
    key: z.string().min(1),
    repo: z.never().optional(),
    number: z.never().optional(),
  }),
]);

export type Link = z.infer<typeof linkSchema>;

export const executionStatusSchema = z.enum(["completed", "failed", "abandoned"]);

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const executionExecutorSchema = z.object({
  tool: z.string().min(1),
  model: z.string().min(1).optional(),
  planner: z
    .object({
      tool: z.string().min(1),
      model: z.string().min(1).optional(),
    })
    .optional(),
});

export type ExecutionExecutor = z.infer<typeof executionExecutorSchema>;

export const executionReviewerSchema = z.object({
  name: z.string().min(1),
  approved: z.boolean(),
  reviewed_at: z.string().datetime(),
  notes: z.string().min(1).optional(),
});

export type ExecutionReviewer = z.infer<typeof executionReviewerSchema>;

export const executionAttemptSchema = z
  .object({
    started_at: z.string().datetime(),
    ended_at: z.string().datetime(),
    duration_seconds: z.number().int().min(0),
    status: executionStatusSchema,
    error_reason: z.string().min(1).optional(),
    executor: executionExecutorSchema,
    reviewer: executionReviewerSchema.optional(),
    notes: z.string().min(1).optional(),
  })
  .refine((data) => new Date(data.started_at) <= new Date(data.ended_at), {
    message: "started_at must be less than or equal to ended_at",
    path: ["ended_at"],
  });

export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;

export const taskExecutionSchema = z.object({
  attempts: z.array(executionAttemptSchema).min(1),
});

export type TaskExecution = z.infer<typeof taskExecutionSchema>;

const COMMIT_MESSAGE_CUTOFF_MS = Date.parse("2025-11-01T00:00:00Z");

export const taskMetaSchema = z
  .object({
    id: z.string().min(1).regex(TASK_ID_REGEX),
    title: z.string().min(1),
    kind: z.enum(kindOrder),
    parent: z.string().min(1).optional(),
    children: z.array(z.string().min(1)).optional(),
    state: z.enum(stateOrder),
    priority: z.enum(priorityOrder),
    assignees: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable().optional(),
    links: z.array(linkSchema).optional(),
    last_activity_at: z.string().datetime().optional(),
    size: z.enum(sizeOrder).default(defaultSize),
    ambiguity: z.enum(ambiguityOrder).default(defaultAmbiguity),
    executor: z.enum(executorOrder).default(defaultExecutor),
    isolation: z.enum(isolationOrder).default(defaultIsolation),
    blocked: z.string().optional(),
    commit_message: z.string().min(1).optional(),
    touches: z.array(z.string().min(1)).optional(),
    depends_on: z.array(z.string().min(1)).optional(),
    blocks: z.array(z.string().min(1)).optional(),
    execution: taskExecutionSchema.optional(),
  })
  .superRefine((meta, ctx) => {
    if (meta.state !== "done") {
      return;
    }

    const completionSource =
      (typeof meta.completed_at === "string" && meta.completed_at.length > 0
        ? meta.completed_at
        : undefined) ??
      (typeof meta.updated_at === "string" && meta.updated_at.length > 0
        ? meta.updated_at
        : undefined);

    const completionTime = completionSource ? Date.parse(completionSource) : Number.NaN;
    const enforceCommitMessage =
      Number.isNaN(completionTime) || completionTime >= COMMIT_MESSAGE_CUTOFF_MS;

    if (!enforceCommitMessage) {
      return;
    }

    const raw = typeof meta.commit_message === "string" ? meta.commit_message.trim() : undefined;
    if (!raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "commit_message is required when state is done",
        path: ["commit_message"],
      });
    }
  });

export type TaskMeta = z.infer<typeof taskMetaSchema>;

export const taskDocSchema = z.object({
  meta: taskMetaSchema,
  body: z.string(),
  path: z.string(),
});

export type TaskDoc = z.infer<typeof taskDocSchema>;

export const postImplementationInsightsHeading = "## Post-Implementation Insights" as const;

export const postImplementationSubsectionHeadings = [
  "### Changelog",
  "### Decisions",
  "### Technical Changes",
] as const;

export const legacyPostImplementationSubsectionHeadings = ["### Architecture"] as const;

export const recognizedPostImplementationSubsectionHeadings: readonly string[] = [
  ...postImplementationSubsectionHeadings,
  ...legacyPostImplementationSubsectionHeadings,
];

export const postImplementationInsightsScaffold =
  `${postImplementationInsightsHeading}\n\n` +
  `${postImplementationSubsectionHeadings[0]}\n\n` +
  `${postImplementationSubsectionHeadings[1]}\n\n` +
  postImplementationSubsectionHeadings[2];

export const requiredHeadings = [
  "## Overview",
  "## Acceptance Criteria",
  "## Technical Approach",
] as const;

export function requiredHeadingsForState(state: State): string[] {
  if (state === "done") {
    return [...requiredHeadings, postImplementationInsightsHeading];
  }
  return [...requiredHeadings];
}
