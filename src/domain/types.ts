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

export const taskMetaSchema = z.object({
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
  touches: z.array(z.string().min(1)).optional(),
  depends_on: z.array(z.string().min(1)).optional(),
  blocks: z.array(z.string().min(1)).optional(),
});

export type TaskMeta = z.infer<typeof taskMetaSchema>;

export const taskDocSchema = z.object({
  meta: taskMetaSchema,
  body: z.string(),
  path: z.string(),
});

export type TaskDoc = z.infer<typeof taskDocSchema>;

export const postImplementationInsightsHeading = "## Post-Implementation Insights" as const;

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
