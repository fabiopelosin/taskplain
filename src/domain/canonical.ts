import { existsSync, readFileSync } from "node:fs";
import path, { join } from "node:path";

import packageJson from "../../package.json";
import { readDocsSource } from "./content";
import { STATE_PREFIXES } from "./paths";
import {
  ambiguityOrder,
  defaultAmbiguity,
  defaultExecutor,
  defaultIsolation,
  defaultSize,
  executorOrder,
  isolationOrder,
  kindOrder,
  priorityOrder,
  requiredHeadings,
  sizeOrder,
  stateOrder,
  TASK_ID_REGEX,
} from "./types";

export type HandbookSection = "overview" | "all";
export type HandbookFormat = "md" | "txt";

export type CommandDescriptor = {
  name: string;
  summary: string;
  usage: string;
  options?: Array<{
    name: string;
    summary: string;
    type: string;
    default?: string | boolean | number | string[];
  }>;
  exitCodes: Record<string, string>;
  argsSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  group: "docs" | "core" | "utility";
};

export const TASK_ROOT = "tasks";
export const MACHINE_DESCRIPTOR_PATH = ".taskplain/describe.json";
export const COMMIT_TRAILER = "[Task:<id>]";

export const SNIPPET_VERSION = `v${packageJson.version}`;
export const SNIPPET_MARKER_START = `<!-- taskplain:start ${SNIPPET_VERSION} -->`;
export const SNIPPET_MARKER_END = "<!-- taskplain:end -->";

const snippetBody = readDocsSource("handbook-snippet.md").trim();
const snippetMarkdown = `${SNIPPET_MARKER_START}\n${snippetBody}\n${SNIPPET_MARKER_END}\n`;

const taskMetaJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://taskplain.dev/schema/task.json",
  title: "TaskplainTask",
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "kind", "state", "priority", "created_at", "updated_at"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]+$" },
    title: { type: "string", minLength: 1 },
    kind: { type: "string", enum: [...kindOrder] },
    parent: { type: "string" },
    state: { type: "string", enum: [...stateOrder] },
    blocked: { type: "string" },
    priority: { type: "string", enum: [...priorityOrder] },
    size: { type: "string", enum: [...sizeOrder], default: defaultSize },
    ambiguity: {
      type: "string",
      enum: [...ambiguityOrder],
      default: defaultAmbiguity,
    },
    executor: {
      type: "string",
      enum: [...executorOrder],
      default: defaultExecutor,
    },
    isolation: {
      type: "string",
      enum: [...isolationOrder],
      default: defaultIsolation,
    },
    assignees: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    labels: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    touches: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    depends_on: {
      type: "array",
      items: { type: "string", pattern: TASK_ID_REGEX.source },
    },
    blocks: {
      type: "array",
      items: { type: "string", pattern: TASK_ID_REGEX.source },
    },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    completed_at: {
      oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
    },
    links: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "number"],
            properties: {
              type: { const: "github_issue" },
              repo: { type: "string" },
              number: { type: "integer", minimum: 1 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "key"],
            properties: {
              type: { const: "linear" },
              key: { type: "string", minLength: 1 },
            },
          },
        ],
      },
    },
    last_activity_at: { type: "string", format: "date-time" },
  },
} as const;

const pickupCandidateJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rank: { type: "number", nullable: true },
    id: { type: "string" },
    title: { type: "string" },
    kind: { type: "string", enum: [...kindOrder] },
    state: { type: "string", enum: [...stateOrder] },
    priority: { type: "string", enum: [...priorityOrder] },
    size: { type: "string", enum: [...sizeOrder] },
    executor: { type: "string", enum: [...executorOrder] },
    ambiguity: { type: "string", enum: [...ambiguityOrder] },
    isolation: { type: "string", enum: [...isolationOrder] },
    touches: { type: "array", items: { type: "string" } },
    blocked: { type: "string", nullable: true },
    score_breakdown: {
      type: "object",
      additionalProperties: false,
      properties: {
        priority: { type: "number" },
        epic_in_flight: { type: "boolean" },
        size: { type: "number" },
        executor_index: { type: "number" },
        executor_distance: { type: "number" },
        ambiguity: { type: "number" },
        isolation: { type: "number" },
        updated_at_ms: { type: "number" },
      },
      required: [
        "priority",
        "epic_in_flight",
        "size",
        "executor_index",
        "executor_distance",
        "ambiguity",
        "isolation",
        "updated_at_ms",
      ],
    },
  },
  required: [
    "id",
    "title",
    "kind",
    "state",
    "priority",
    "size",
    "executor",
    "ambiguity",
    "isolation",
    "touches",
    "blocked",
    "score_breakdown",
  ],
} as const;

const pickupDocJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    path: { type: "string" },
    meta: taskMetaJsonSchema,
    body: { type: "string" },
  },
  required: ["id", "path", "meta", "body"],
} as const;

function toPlainText(markdown: string): string {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

const handbookMarkdown = (() => {
  const handbookCandidates = [
    join(__dirname, "docs", "cli-playbook.md"),
    join(__dirname, "..", "docs", "cli-playbook.md"),
    join(__dirname, "..", "..", "docs", "cli-playbook.md"),
  ];

  for (const candidate of handbookCandidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8").replace(/\r\n/g, "\n");
    }
  }

  throw new Error("Unable to locate CLI playbook content.");
})();

const baseCommandDescriptors: CommandDescriptor[] = [
  {
    name: "help",
    summary: "Show help for commands or access reference documentation.",
    usage: "taskplain help [command] [options]",
    options: [
      {
        name: "--playbook",
        summary: "Show complete CLI playbook with workflows and examples",
        type: "boolean",
        default: false,
      },
      {
        name: "--reference",
        summary: "Show aggregated reference for all commands",
        type: "boolean",
        default: false,
      },
      {
        name: "--contract",
        summary: "Show machine-readable CLI contract (JSON)",
        type: "boolean",
        default: false,
      },
      {
        name: "--snippet",
        summary: "Show agent instructions snippet for AGENTS.md",
        type: "boolean",
        default: false,
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid command",
      "3": "descriptor generation failed",
    },
    argsSchema: {
      type: "object",
      properties: {
        command: { type: "string", nullable: true },
        playbook: { type: "boolean", default: false },
        reference: { type: "boolean", default: false },
        contract: { type: "boolean", default: false },
        snippet: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      description:
        "Without arguments prints root help. With a command name, prints that command's help. With flags, shows reference documentation.",
    },
    group: "docs",
  },
  {
    name: "inject",
    summary: "Inject the managed AGENTS.md snippet into a target file.",
    usage: "taskplain inject [file] [options]",
    options: [
      {
        name: "--stdout",
        summary: "Also print the injected snippet to stdout",
        type: "boolean",
        default: false,
      },
      {
        name: "--check",
        summary: "Exit non-zero when the managed snippet in file is stale",
        type: "boolean",
        default: false,
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "unexpected error",
      "2": "io error while writing managed snippet",
      "4": "snippet check failed (stale or missing)",
    },
    argsSchema: {
      type: "object",
      properties: {
        file: { type: "string", default: "AGENTS.md" },
        stdout: { type: "boolean", default: false },
        check: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      description:
        "Updates the managed snippet in-place. With --stdout, also writes the refreshed snippet to stdout. With --check, no writes occur and the command exits 4 when the snippet is stale or missing.",
    },
    group: "docs",
  },
  {
    name: "new",
    summary: "Create a new task file with metadata and template headings.",
    usage: "taskplain new --title <title> [--kind <kind>] [options]",
    options: [
      { name: "--title <title>", summary: "Task title", type: "string" },
      {
        name: "--kind <kind>",
        summary: `${kindOrder.join(" | ")} (defaults to inference)`,
        type: "string",
      },
      { name: "--parent <id>", summary: "Parent task id", type: "string" },
      {
        name: "--state <state>",
        summary: stateOrder.join(" | "),
        type: "string",
        default: "idea",
      },
      {
        name: "--priority <priority>",
        summary: priorityOrder.join(" | "),
        type: "string",
        default: "normal",
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "task creation failed",
    },
    argsSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: [...kindOrder], nullable: true },
        parent: { type: "string", nullable: true },
        state: { type: "string", enum: [...stateOrder], default: "idea" },
        priority: {
          type: "string",
          enum: [...priorityOrder],
          default: "normal",
        },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        path: { type: "string" },
        meta: taskMetaJsonSchema,
      },
      required: ["id", "path", "meta"],
    },
    group: "core",
  },
  {
    name: "list",
    summary: "List tasks using filters and render as table or JSON.",
    usage: "taskplain list [options]",
    options: [
      { name: "--state <state>", summary: "Filter by state", type: "string" },
      {
        name: "--priority <priority>",
        summary: "Filter by priority",
        type: "string",
      },
      { name: "--parent <id>", summary: "Filter by parent id", type: "string" },
      { name: "--search <query>", summary: "Substring match", type: "string" },
      { name: "--label <label>", summary: "Filter by label", type: "string" },
      {
        name: "--size <values>",
        summary: "Comma list of size tiers",
        type: "string",
      },
      {
        name: "--ambiguity <values>",
        summary: "Comma list of ambiguity levels",
        type: "string",
      },
      {
        name: "--executor <values>",
        summary: "Comma list of executor tiers",
        type: "string",
      },
      {
        name: "--isolation <values>",
        summary: "Comma list of isolation scopes",
        type: "string",
      },
      {
        name: "--blocked",
        summary: "Only include blocked tasks (defaults to open states)",
        type: "boolean",
        default: false,
      },
      {
        name: "--unblocked",
        summary: "Only include unblocked tasks (defaults to open states)",
        type: "boolean",
        default: false,
      },
      {
        name: "--open",
        summary: "Filter to open states",
        type: "boolean",
        default: false,
      },
      {
        name: "--states <states>",
        summary: "Comma list of open states (idea,ready,in-progress)",
        type: "string",
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid filter",
    },
    argsSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: [...stateOrder], nullable: true },
        priority: { type: "string", enum: [...priorityOrder], nullable: true },
        parent: { type: "string", nullable: true },
        search: { type: "string", nullable: true },
        label: { type: "string", nullable: true },
        size: {
          type: "array",
          nullable: true,
          items: { type: "string", enum: [...sizeOrder] },
        },
        ambiguity: {
          type: "array",
          nullable: true,
          items: { type: "string", enum: [...ambiguityOrder] },
        },
        executor: {
          type: "array",
          nullable: true,
          items: { type: "string", enum: [...executorOrder] },
        },
        isolation: {
          type: "array",
          nullable: true,
          items: { type: "string", enum: [...isolationOrder] },
        },
        blocked: { type: "boolean", default: false },
        unblocked: { type: "boolean", default: false },
        open: { type: "boolean", default: false },
        states: {
          type: "array",
          description: "Only applies with --open",
          items: { type: "string", enum: ["idea", "ready", "in-progress"] },
          default: ["idea", "ready", "in-progress"],
        },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
      },
    },
    group: "core",
  },
  {
    name: "next",
    summary: "Suggest ready-state tasks for agents using dispatch metadata and heuristics.",
    usage: "taskplain next [options]",
    options: [
      {
        name: "--count <n>",
        summary: "Number of tasks to select",
        type: "number",
        default: 1,
      },
      {
        name: "--parallelize <n>",
        summary: "Greedy pick of non-conflicting tasks",
        type: "number",
      },
      {
        name: "--kinds <kinds>",
        summary: "Comma list of kinds (task,story,epic)",
        type: "string",
        default: "task",
      },
      {
        name: "--executor <tier>",
        summary: "Preferred executor tier (simple|standard|expert|human_review)",
        type: "string",
      },
      {
        name: "--max-size <size>",
        summary: "Maximum size tiny|small|medium|large|xl",
        type: "string",
      },
      {
        name: "--ambiguity <levels>",
        summary: "Comma list of ambiguity levels",
        type: "string",
      },
      {
        name: "--isolation <scopes>",
        summary: "Comma list of isolation scopes",
        type: "string",
      },
      {
        name: "--parent <id>",
        summary: "Limit to a specific parent (epic or story)",
        type: "string",
      },
      {
        name: "--include-blocked",
        summary: "Allow blocked tasks in the candidate pool",
        type: "boolean",
        default: false,
      },
      {
        name: "--output <mode>",
        summary: "ids | json | human",
        type: "string",
        default: "ids",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid options",
    },
    argsSchema: {
      type: "object",
      properties: {
        count: { type: "number", minimum: 1, default: 1 },
        parallelize: { type: "number", nullable: true },
        kinds: {
          type: "array",
          items: { type: "string", enum: [...kindOrder] },
          default: ["task"],
        },
        executor: { type: "string", enum: [...executorOrder], nullable: true },
        max_size: { type: "string", enum: [...sizeOrder], nullable: true },
        ambiguity: {
          type: "array",
          items: { type: "string", enum: [...ambiguityOrder] },
          nullable: true,
        },
        isolation: {
          type: "array",
          items: { type: "string", enum: [...isolationOrder] },
          nullable: true,
        },
        parent: { type: "string", nullable: true },
        include_blocked: { type: "boolean", default: false },
        output: {
          type: "string",
          enum: ["ids", "json", "human"],
          default: "ids",
        },
      },
      additionalProperties: false,
    },
    outputSchema: null,
    group: "core",
  },
  {
    name: "show",
    summary: "Display a task's metadata and a truncated body preview.",
    usage: "taskplain show <id> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      {
        name: "--lines <n>",
        summary: "Preview length",
        type: "number",
        default: 20,
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "task not found",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        lines: { type: "number", minimum: 0, default: 20 },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: null,
    group: "core",
  },
  {
    name: "move",
    summary: "Move a task into another state directory.",
    usage: "taskplain move <id> <state> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      { name: "<state>", summary: stateOrder.join(" | "), type: "string" },
      {
        name: "--dry-run",
        summary: "Preview without writing",
        type: "boolean",
      },
      {
        name: "--cascade <mode>",
        summary: "none | ready | cancel",
        type: "string",
        default: "none",
      },
      {
        name: "--include-blocked",
        summary: "Include blocked descendants during cascade",
        type: "boolean",
        default: false,
      },
      {
        name: "--force",
        summary: "Override a block on the parent task",
        type: "boolean",
        default: false,
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "parent move failed or no changes applied",
      "3": "invalid arguments",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        state: { type: "string", enum: [...stateOrder] },
        dryRun: { type: "boolean", default: false },
        cascade: {
          type: "string",
          enum: ["none", "ready", "cancel"],
          default: "none",
        },
        includeBlocked: { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id", "state"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dryRun: { type: "boolean" },
        cascade: { type: "string", enum: ["none", "ready", "cancel"] },
        parent_move: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            changed: { type: "boolean" },
            from_path: { type: "string" },
            to_path: { type: "string" },
          },
          required: ["from", "to", "changed", "from_path", "to_path"],
          additionalProperties: false,
        },
        children: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              from: { type: "string", nullable: true },
              to: { type: "string", nullable: true },
              changed: { type: "boolean", nullable: true },
              skipped: { type: "boolean", nullable: true },
              reason: { type: "string" },
            },
            required: ["id", "reason"],
            additionalProperties: false,
          },
        },
        changed_children: { type: "integer", minimum: 0 },
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", nullable: true },
              file: { type: "string" },
            },
            required: ["code", "message", "file"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "id",
        "dryRun",
        "cascade",
        "parent_move",
        "children",
        "changed_children",
        "warnings",
      ],
      additionalProperties: false,
    },
    group: "core",
  },
  {
    name: "pickup",
    summary: "Gather parent context, suggest next children, and move idea work to ready.",
    usage: "taskplain pickup <id> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      {
        name: "--dry-run",
        summary: "Preview context and state transitions",
        type: "boolean",
      },
      {
        name: "--include-blocked",
        summary: "Include blocked children when ranking suggestions",
        type: "boolean",
        default: false,
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid options or task not found",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dryRun: { type: "boolean", default: false },
        includeBlocked: { type: "boolean", default: false },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        dry_run: { type: "boolean" },
        moves: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              from_state: { type: "string", enum: [...stateOrder] },
              to_state: { type: "string", enum: [...stateOrder] },
              changed: { type: "boolean" },
              reason: { type: "string", nullable: true },
              from_path: { type: "string" },
              to_path: { type: "string" },
            },
            required: ["id", "from_state", "to_state", "changed", "from_path", "to_path"],
          },
        },
        context: {
          type: "object",
          additionalProperties: false,
          properties: {
            target: pickupDocJsonSchema,
            ancestors: { type: "array", items: pickupDocJsonSchema },
            children: {
              type: "object",
              additionalProperties: false,
              properties: {
                include_blocked: { type: "boolean" },
                total_direct_children: { type: "number" },
                candidates: { type: "array", items: pickupCandidateJsonSchema },
                selected: { type: "array", items: pickupCandidateJsonSchema },
                not_ready: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      kind: { type: "string", enum: [...kindOrder] },
                      state: { type: "string", enum: [...stateOrder] },
                      priority: { type: "string", enum: [...priorityOrder] },
                      reason: { type: "string" },
                    },
                    required: ["id", "title", "kind", "state", "priority", "reason"],
                  },
                },
              },
              required: [
                "include_blocked",
                "total_direct_children",
                "candidates",
                "selected",
                "not_ready",
              ],
            },
          },
          required: ["target", "ancestors", "children"],
        },
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", nullable: true },
              file: { type: "string" },
            },
            required: ["code", "message", "file"],
            additionalProperties: false,
          },
        },
      },
      required: ["id", "dry_run", "moves", "context", "warnings"],
    },
    group: "core",
  },
  {
    name: "update",
    summary: "Update metadata fields and replace section content in a single command.",
    usage: "taskplain update <id> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      {
        name: "--meta <key=value>",
        summary: "Apply metadata patch (repeatable)",
        type: "string",
      },
      {
        name: "--field <section> <text|@file>",
        summary: "Replace section content using inline text or @file",
        type: "array",
      },
      { name: "--unset <key>", summary: "Remove metadata key", type: "string" },
      {
        name: "--dry-run",
        summary: "Preview without writing",
        type: "boolean",
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid patch",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        meta: { type: "array", items: { type: "string" }, default: [] },
        field: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          default: [],
        },
        unset: { type: "array", items: { type: "string" }, default: [] },
        dryRun: { type: "boolean", default: false },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dryRun: { type: "boolean" },
        changed: { type: "boolean" },
        from: { type: "string" },
        to: { type: "string" },
        meta: taskMetaJsonSchema,
        metaChanges: { type: "array", items: { type: "string" } },
        sectionChanges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              changed: { type: "boolean" },
              added: { type: "boolean" },
            },
            required: ["id", "changed", "added"],
            additionalProperties: false,
          },
        },
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", nullable: true },
              file: { type: "string" },
            },
            required: ["code", "message", "file"],
            additionalProperties: false,
          },
        },
      },
    },
    group: "core",
  },
  {
    name: "complete",
    summary: "Mark a task as done.",
    usage: "taskplain complete <id> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      {
        name: "--dry-run",
        summary: "Preview without writing",
        type: "boolean",
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "completion failed",
      "5": "deprecated option provided",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dryRun: { type: "boolean", default: false },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        state: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        dryRun: { type: "boolean" },
        changed: { type: "boolean" },
        changed_state: { type: "boolean" },
        no_op: { type: "boolean" },
        meta: taskMetaJsonSchema,
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", nullable: true },
              file: { type: "string" },
            },
            required: ["code", "message", "file"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "id",
        "state",
        "from",
        "to",
        "dryRun",
        "changed",
        "changed_state",
        "no_op",
        "meta",
        "warnings",
      ],
      additionalProperties: false,
    },
    group: "core",
  },
  {
    name: "subject",
    summary: "Generate a commit subject for a task.",
    usage: "taskplain subject <id> -m <message> [options]",
    options: [
      { name: "<id>", summary: "Task identifier", type: "string" },
      {
        name: "-m, --message <message>",
        summary: "Commit subject body",
        type: "string",
      },
      {
        name: "--close-gh [number]",
        summary: "Append Closes #<n>; infer first linked GitHub issue when omitted",
        type: "string",
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "3": "invalid arguments",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        message: { type: "string" },
        closeGh: {
          anyOf: [
            { type: "boolean", const: true },
            { type: "integer", minimum: 1 },
          ],
          nullable: true,
        },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      required: ["id", "message"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        subject: { type: "string" },
        closed_issue: { type: "integer", minimum: 1, nullable: true },
        warnings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              field: { type: "string", nullable: true },
              file: { type: "string" },
            },
            required: ["code", "message", "file"],
            additionalProperties: false,
          },
        },
      },
      required: ["id", "subject"],
      additionalProperties: false,
    },
    group: "core",
  },
  {
    name: "validate",
    summary: "Validate every task file against the schema.",
    usage: "taskplain validate [options]",
    options: [
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
      {
        name: "--concurrency <workers>",
        summary: "Maximum number of parallel workers",
        type: "string",
      },
      {
        name: "--min-parallel <count>",
        summary: "Minimum files before enabling parallel validation",
        type: "string",
      },
      {
        name: "--fix",
        summary: "Apply automatic repairs before validating",
        type: "boolean",
        default: false,
      },
      {
        name: "--rename-files",
        summary: "Rename mismatched filenames when combined with --fix",
        type: "boolean",
        default: false,
      },
    ],
    exitCodes: {
      "0": "all tasks valid",
      "1": "validation errors detected",
    },
    argsSchema: {
      type: "object",
      properties: {
        output: { type: "string", enum: ["human", "json"], default: "human" },
        concurrency: { type: "string", nullable: true },
        min_parallel: { type: "string", nullable: true },
        fix: { type: "boolean", default: false },
        rename_files: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
    outputSchema: null,
    group: "utility",
  },
  {
    name: "tree",
    summary: "Render task hierarchy or open work grouped by state.",
    usage: "taskplain tree [id] [options]",
    options: [
      { name: "[id]", summary: "Optional root id", type: "string" },
      {
        name: "--open",
        summary: "Group open work by state",
        type: "boolean",
        default: false,
      },
      {
        name: "--states <states>",
        summary: "Comma list of open states (idea,ready,in-progress)",
        type: "string",
      },
      {
        name: "--priority <priority>",
        summary: "Filter by priority when using --open",
        type: "string",
      },
      {
        name: "--label <label>",
        summary: "Filter by label when using --open",
        type: "string",
      },
      {
        name: "--search <query>",
        summary: "Substring search when using --open",
        type: "string",
      },
      {
        name: "--ready-only",
        summary: "Hide blocked or dependency-pending items (with --open)",
        type: "boolean",
        default: false,
      },
      {
        name: "--output <format>",
        summary: "human | json",
        type: "string",
        default: "human",
      },
    ],
    exitCodes: {
      "0": "success",
      "1": "invalid arguments",
    },
    argsSchema: {
      type: "object",
      properties: {
        id: { type: "string", nullable: true },
        open: { type: "boolean", default: false },
        states: {
          type: "array",
          description: "Only applies with --open",
          items: { type: "string", enum: ["idea", "ready", "in-progress"] },
          default: ["idea", "ready", "in-progress"],
        },
        priority: { type: "string", enum: [...priorityOrder], nullable: true },
        label: { type: "string", nullable: true },
        search: { type: "string", nullable: true },
        ready_only: { type: "boolean", default: false },
        output: { type: "string", enum: ["human", "json"], default: "human" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      description:
        "Without --open and with --output json, returns { tree: TaskTreeNode[] }. With --open, returns { states: OpenStateGroup[] } where open work is grouped by state, epic, story, then tasks.",
      examples: [
        {
          mode: "hierarchy",
          payload: {
            tree: [
              {
                id: "epic-onboarding",
                title: "Onboarding Flow",
                kind: "epic",
                state: "ready",
                priority: "high",
                children: [],
              },
            ],
          },
        },
        {
          mode: "open",
          payload: {
            states: [
              {
                state: "idea",
                by_epic: [
                  {
                    epic: {
                      id: "landing-page",
                      title: "Landing Page Refresh",
                      kind: "epic",
                      state: "idea",
                      priority: "high",
                      updated_at: "2025-01-04T12:30:00.000Z",
                      path: "tasks/00-idea/epic-landing-page.md",
                    },
                    children: [
                      {
                        story: {
                          id: "hero-copy",
                          title: "Rewrite hero copy",
                          kind: "story",
                          state: "idea",
                          priority: "normal",
                          parent: "landing-page",
                          updated_at: "2025-01-04T12:30:00.000Z",
                          path: "tasks/00-idea/story-hero-copy.md",
                        },
                        tasks: [
                          {
                            id: "cta-copy",
                            title: "Polish CTA wording",
                            kind: "task",
                            state: "idea",
                            priority: "normal",
                            parent: "hero-copy",
                            updated_at: "2025-01-03T09:15:00.000Z",
                            path: "tasks/00-idea/task-cta-copy.md",
                          },
                        ],
                      },
                    ],
                  },
                ],
                ungrouped: {
                  stories: [],
                  tasks: [],
                },
              },
            ],
          },
        },
      ],
    },
    group: "utility",
  },
];

export function getHandbookSnippet(format: HandbookFormat = "md"): string {
  if (format === "md") {
    return snippetMarkdown;
  }
  return `${toPlainText(snippetMarkdown)}\n`;
}

export function renderHandbook(section: HandbookSection, format: HandbookFormat): string {
  if (section === "overview") {
    return getHandbookSnippet(format);
  }

  if (format === "md") {
    return handbookMarkdown.endsWith("\n") ? handbookMarkdown : `${handbookMarkdown}\n`;
  }

  return `${toPlainText(handbookMarkdown)}\n`;
}

export type DescribePayload = {
  name: string;
  version: string;
  conventions: {
    root: string;
    states: Array<{ id: string; dir: string }>;
    filenames: { active: string; done: string };
    commit_trailer: string;
    required_headings: string[];
  };
  commands: CommandDescriptor[];
  schema: {
    task: unknown;
    dispatch: {
      fields: {
        size: { enum: string[]; default: string };
        ambiguity: { enum: string[]; default: string };
        executor: { enum: string[]; default: string };
        isolation: { enum: string[]; default: string };
      };
    };
  };
  snippet: {
    version: string;
    marker_start: string;
    marker_end: string;
    target: string;
    doc: string | null;
    content: string;
  };
};

export function buildDescribePayload(): DescribePayload {
  const states = stateOrder.map((state) => ({
    id: state,
    dir: STATE_PREFIXES[state],
  }));

  return {
    name: "taskplain",
    version: packageJson.version ?? "0.0.0",
    conventions: {
      root: TASK_ROOT,
      states,
      filenames: {
        active: "[kind]-[id].md",
        done: "[YYYY-MM-DD] [kind]-[id].md",
      },
      commit_trailer: COMMIT_TRAILER,
      required_headings: [...requiredHeadings],
    },
    commands: baseCommandDescriptors,
    schema: {
      task: taskMetaJsonSchema,
      dispatch: {
        fields: {
          size: { enum: [...sizeOrder], default: defaultSize },
          ambiguity: { enum: [...ambiguityOrder], default: defaultAmbiguity },
          executor: { enum: [...executorOrder], default: defaultExecutor },
          isolation: { enum: [...isolationOrder], default: defaultIsolation },
        },
      },
    },
    snippet: {
      version: SNIPPET_VERSION,
      marker_start: SNIPPET_MARKER_START,
      marker_end: SNIPPET_MARKER_END,
      target: "AGENTS.md",
      doc: null,
      content: snippetMarkdown.trimEnd(),
    },
  };
}

export function resolveRepoPath(repoRoot: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.join(repoRoot, target);
}
