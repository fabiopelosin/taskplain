import type { AddressInfo } from "node:net";
import path from "node:path";
import websocketPlugin from "@fastify/websocket";
import chokidar, { type FSWatcher } from "chokidar";
import Fastify from "fastify";
import fs from "fs-extra";
import open from "open";
import type { WebSocket } from "ws";
import { resolveSectionHeading } from "../domain/sections";
import type { Kind, State, TaskDoc, TaskMeta } from "../domain/types";
import { ambiguityOrder, executorOrder, priorityOrder, sizeOrder } from "../domain/types";
import { buildHierarchyIndex, type HierarchyIndex } from "./hierarchy";
import { TaskQueryService } from "./taskQueryService";
import type { TaskService, TaskWarning, UpdateMetaField } from "./taskService";

const STATE_ORDER: State[] = ["idea", "ready", "in-progress", "done", "canceled"];
const STATE_SET = new Set<State>(STATE_ORDER);
const WEB_ASSET_CANDIDATES = [
  path.join(__dirname, "resources", "web"),
  path.join(__dirname, "..", "resources", "web"),
];

function resolveWebAssetsDir(): string {
  for (const candidate of WEB_ASSET_CANDIDATES) {
    try {
      if (fs.pathExistsSync(candidate)) {
        return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  throw new Error(
    `Unable to locate web assets directory. Checked: ${WEB_ASSET_CANDIDATES.join(", ")}`,
  );
}

const WEB_ASSETS_DIR = resolveWebAssetsDir();
const BOARD_HTML_PATH = path.join(WEB_ASSETS_DIR, "board.html");

export interface WebServerTask {
  id: string;
  title: string;
  kind: TaskDoc["meta"]["kind"];
  state: State;
  priority: TaskDoc["meta"]["priority"];
  updated_at: string;
  last_activity_at?: string;
  path: string;
  blocked?: string;
  children: WebServerTask[];
  acceptance?: AcceptanceStats;
  family?: WebServerFamilyContext;
}

export interface WebServerSnapshot {
  generated_at: string;
  columns: Record<State, WebServerTask[]>;
  project_name: string;
}

type AcceptanceStats = {
  completed: number;
  total: number;
};

export interface WebServerFamilyContext {
  parent?: WebServerFamilyRef;
  children: WebServerFamilyRef[];
  breakdown: Record<State, number>;
  child_count: number;
}

export interface WebServerFamilyRef {
  id: string;
  title: string;
  state: State;
  kind: TaskDoc["meta"]["kind"];
}

export interface WebServerServiceDeps {
  repoRoot: string;
  taskService: TaskService;
  onWarnings?: (warnings: TaskWarning[]) => void;
}

export interface WebServerRunOptions {
  port?: number;
  openBrowser?: boolean;
  signal?: AbortSignal;
  onReady?: (info: { url: string; port: number }) => void;
}

interface WebSocketMessage {
  type: "tasks/snapshot";
  payload: WebServerSnapshot;
}

export class WebServerService {
  private readonly repoRoot: string;
  private readonly taskService: TaskService;
  private readonly onWarnings?: (warnings: TaskWarning[]) => void;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly boardHtml: string;

  constructor(deps: WebServerServiceDeps) {
    this.repoRoot = deps.repoRoot;
    this.taskService = deps.taskService;
    this.onWarnings = deps.onWarnings;
    this.boardHtml = this.loadBoardHtmlTemplate();
  }

  async run(options: WebServerRunOptions = {}): Promise<void> {
    const app = Fastify({ logger: false });
    await app.register(websocketPlugin);

    const clients = new Set<WebSocket>();
    let snapshot = await this.refreshSnapshot();

    const emitSnapshot = async (): Promise<WebServerSnapshot> => {
      snapshot = await this.refreshSnapshot();
      this.broadcast(clients, snapshot);
      return snapshot;
    };

    const watcher = this.createWatcher(() => {
      this.scheduleRefresh(async () => {
        await emitSnapshot();
      });
    });

    app.get("/", async (_, reply) => {
      const projectName = path.basename(this.repoRoot);
      const title = `Taskplain: ${projectName}`;
      // Replace default title/heading occurrences for per-project tab identification
      const html = this.boardHtml.replace(/Taskplain Board/g, title);
      reply.type("text/html; charset=utf-8").send(html);
    });

    app.get("/assets/:file", async (request, reply) => {
      const { file } = request.params as { file: string };
      try {
        const asset = await this.readWebAsset(file);
        reply.type(asset.contentType).send(asset.body);
      } catch (error) {
        reply.code(404).send({ error: (error as Error).message });
      }
    });

    app.get("/favicon.ico", async (_, reply) => {
      // Static favicon (no per-project color) for consistency and reliability
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="12" ry="12" fill="#1f2937"/>` +
        `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="34" font-weight="700" fill="#e2e8f0">T</text>` +
        `</svg>`;
      reply.type("image/svg+xml").send(svg);
    });

    app.get("/api/health", async (_, reply) => {
      reply.type("application/json; charset=utf-8").send({ projectPath: this.repoRoot });
    });

    app.get("/api/tasks", async (_, reply) => {
      reply.send(snapshot);
    });

    app.post("/api/tasks", async (request, reply) => {
      const body = (request.body as Record<string, unknown>) ?? {};
      const title = typeof body.title === "string" ? body.title.trim() : undefined;
      if (!title) {
        reply.code(400).send({ error: "title is required" });
        return;
      }

      const kindRaw = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : "task";
      if (kindRaw !== "epic" && kindRaw !== "story" && kindRaw !== "task") {
        reply.code(400).send({ error: "kind must be epic, story, or task" });
        return;
      }
      const kind = kindRaw as Kind;

      const stateRaw =
        typeof body.state === "string" ? (body.state.trim().toLowerCase() as State) : "idea";
      if (!STATE_SET.has(stateRaw)) {
        reply.code(400).send({
          error: `state must be one of: ${STATE_ORDER.join(", ")}`,
        });
        return;
      }

      const priorityRaw =
        typeof body.priority === "string" ? body.priority.trim().toLowerCase() : "normal";
      if (!priorityOrder.includes(priorityRaw as (typeof priorityOrder)[number])) {
        reply.code(400).send({
          error: `priority must be one of: ${priorityOrder.join(", ")}`,
        });
        return;
      }

      const sizeRaw = typeof body.size === "string" ? body.size.trim().toLowerCase() : null;
      if (sizeRaw && !sizeOrder.includes(sizeRaw as (typeof sizeOrder)[number])) {
        reply.code(400).send({ error: `size must be one of: ${sizeOrder.join(", ")}` });
        return;
      }

      const ambiguityRaw =
        typeof body.ambiguity === "string" ? body.ambiguity.trim().toLowerCase() : null;
      if (
        ambiguityRaw &&
        !ambiguityOrder.includes(ambiguityRaw as (typeof ambiguityOrder)[number])
      ) {
        reply.code(400).send({
          error: `ambiguity must be one of: ${ambiguityOrder.join(", ")}`,
        });
        return;
      }

      const executorRaw =
        typeof body.executor === "string" ? body.executor.trim().toLowerCase() : null;
      if (executorRaw && !executorOrder.includes(executorRaw as (typeof executorOrder)[number])) {
        reply.code(400).send({
          error: `executor must be one of: ${executorOrder.join(", ")}`,
        });
        return;
      }

      let parentId: string | undefined;
      if (typeof body.parent === "string" && body.parent.trim().length > 0) {
        parentId = body.parent.trim();
      }

      let commitMessage: string | undefined;
      if (typeof body.commit_message === "string") {
        const trimmed = body.commit_message.trim();
        commitMessage = trimmed.length > 0 ? trimmed : undefined;
      }

      let blockedValue: string | null | undefined;
      if ("blocked" in body) {
        if (body.blocked === null) {
          blockedValue = null;
        } else if (typeof body.blocked === "string" && body.blocked.trim().length > 0) {
          blockedValue = body.blocked.trim();
        } else if (typeof body.blocked === "string" && body.blocked.trim().length === 0) {
          blockedValue = null;
        } else {
          reply.code(400).send({ error: "blocked must be a string or null" });
          return;
        }
      }

      try {
        const created = await this.taskService.newTask({
          title,
          kind,
          state: stateRaw,
          priority: priorityRaw as TaskMeta["priority"],
          parent: parentId,
          commit_message: commitMessage,
        });
        let warnings = this.taskService.drainWarnings();
        if (warnings.length > 0) {
          this.onWarnings?.(warnings);
        }

        const metaPatch: Partial<Pick<TaskMeta, UpdateMetaField>> = {};
        const unset: UpdateMetaField[] = [];
        if (sizeRaw) {
          metaPatch.size = sizeRaw as TaskMeta["size"];
        }
        if (ambiguityRaw) {
          metaPatch.ambiguity = ambiguityRaw as TaskMeta["ambiguity"];
        }
        if (executorRaw) {
          metaPatch.executor = executorRaw as TaskMeta["executor"];
        }
        if (blockedValue !== undefined) {
          if (blockedValue === null) {
            unset.push("blocked");
          } else {
            metaPatch.blocked = blockedValue;
          }
        }

        if (Object.keys(metaPatch).length > 0 || unset.length > 0) {
          await this.taskService.update({
            id: created.meta.id,
            metaPatch,
            unset,
            sections: {},
          });
          warnings = this.taskService.drainWarnings();
          if (warnings.length > 0) {
            this.onWarnings?.(warnings);
          }
        }

        const next = await emitSnapshot();
        reply.send({ ok: true, id: created.meta.id, snapshot: next });
      } catch (error) {
        reply.code(400).send({ error: (error as Error).message });
      }
    });

    app.get("/api/tasks/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const docs = await this.taskService.listAllTasks();
        const warnings = this.taskService.drainWarnings();
        if (warnings.length > 0) {
          this.onWarnings?.(warnings);
        }
        const doc = docs.find((task) => task.meta.id === id);
        if (!doc) {
          reply.code(404).send({ error: `Task with id '${id}' not found` });
          return;
        }
        const { index } = buildHierarchyIndex(docs);
        const docsById = new Map(docs.map((entry) => [entry.meta.id, entry]));
        const childrenDocs = index.childrenById.get(id) ?? [];
        const descendants = this.collectDescendantsFromIndex(id, index);
        reply.send({
          task: {
            id: doc.meta.id,
            kind: doc.meta.kind,
            state: doc.meta.state,
            title: doc.meta.title,
            priority: doc.meta.priority,
            size: doc.meta.size,
            ambiguity: doc.meta.ambiguity,
            executor: doc.meta.executor,
            blocked: typeof doc.meta.blocked === "string" ? doc.meta.blocked : null,
            commit_message: doc.meta.commit_message ?? null,
            updated_at: doc.meta.updated_at,
            last_activity_at: doc.meta.last_activity_at,
            path: this.toRelativePath(doc.path),
            body: doc.body,
            children: childrenDocs.map((child) => ({
              id: child.meta.id,
              title: child.meta.title,
              state: child.meta.state,
            })),
            descendant_count: descendants.length,
            acceptance: acceptanceStats(doc.body),
            family: buildFamilyContext(doc, childrenDocs, index, docsById),
          },
        });
      } catch (error) {
        reply.code(500).send({
          error: (error as Error).message ?? "Failed to load task",
        });
      }
    });

    app.post("/api/tasks/:id/state", async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as
        | { state?: string; includeBlocked?: boolean; force?: boolean }
        | undefined;
      const nextState = body?.state?.toLowerCase() as State | undefined;
      if (!nextState) {
        reply.code(400).send({ error: "state is required" });
        return;
      }
      if (!STATE_SET.has(nextState)) {
        reply.code(400).send({
          error: `Invalid state '${nextState}'. Expected one of: ${STATE_ORDER.join(", ")}`,
        });
        return;
      }

      try {
        await this.taskService.move(id, nextState, {
          includeBlocked: body?.includeBlocked === true,
          force: body?.force === true,
        });
        const warnings = this.taskService.drainWarnings();
        if (warnings.length > 0) {
          this.onWarnings?.(warnings);
        }
        const next = await emitSnapshot();
        reply.send({ ok: true, snapshot: next });
      } catch (error) {
        reply.code(400).send({ error: (error as Error).message });
      }
    });

    app.patch("/api/tasks/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as Record<string, unknown>) ?? {};

      const metaPatch: Partial<Pick<TaskMeta, UpdateMetaField>> = {};
      const unset: UpdateMetaField[] = [];
      let rawBody: string | undefined;

      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.trim().length === 0) {
          reply.code(400).send({ error: "title must be a non-empty string" });
          return;
        }
        metaPatch.title = body.title.trim();
      }

      if (body.priority !== undefined) {
        if (typeof body.priority !== "string") {
          reply.code(400).send({ error: "priority must be a string" });
          return;
        }
        const normalized = body.priority.trim().toLowerCase();
        if (!priorityOrder.includes(normalized as (typeof priorityOrder)[number])) {
          reply.code(400).send({
            error: `priority must be one of: ${priorityOrder.join(", ")}`,
          });
          return;
        }
        metaPatch.priority = normalized as TaskMeta["priority"];
      }

      if (body.size !== undefined) {
        if (typeof body.size !== "string") {
          reply.code(400).send({ error: "size must be a string" });
          return;
        }
        const normalized = body.size.trim().toLowerCase();
        if (!sizeOrder.includes(normalized as (typeof sizeOrder)[number])) {
          reply.code(400).send({ error: `size must be one of: ${sizeOrder.join(", ")}` });
          return;
        }
        metaPatch.size = normalized as TaskMeta["size"];
      }

      if (body.ambiguity !== undefined) {
        if (typeof body.ambiguity !== "string") {
          reply.code(400).send({ error: "ambiguity must be a string" });
          return;
        }
        const normalized = body.ambiguity.trim().toLowerCase();
        if (!ambiguityOrder.includes(normalized as (typeof ambiguityOrder)[number])) {
          reply.code(400).send({
            error: `ambiguity must be one of: ${ambiguityOrder.join(", ")}`,
          });
          return;
        }
        metaPatch.ambiguity = normalized as TaskMeta["ambiguity"];
      }

      if (body.executor !== undefined) {
        if (typeof body.executor !== "string") {
          reply.code(400).send({ error: "executor must be a string" });
          return;
        }
        const normalized = body.executor.trim().toLowerCase();
        if (!executorOrder.includes(normalized as (typeof executorOrder)[number])) {
          reply.code(400).send({
            error: `executor must be one of: ${executorOrder.join(", ")}`,
          });
          return;
        }
        metaPatch.executor = normalized as TaskMeta["executor"];
      }

      if (Object.hasOwn(body, "commit_message")) {
        const value = body.commit_message;
        if (value === null) {
          unset.push("commit_message");
        } else if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            reply.code(400).send({ error: "commit_message must be a non-empty string" });
            return;
          }
          metaPatch.commit_message = trimmed as TaskMeta["commit_message"];
        } else {
          reply.code(400).send({ error: "commit_message must be a string or null" });
          return;
        }
      }

      if ("blocked" in body) {
        const blockedValue = body.blocked;
        if (
          blockedValue === null ||
          (typeof blockedValue === "string" && blockedValue.trim().length === 0)
        ) {
          unset.push("blocked");
        } else if (typeof blockedValue === "string") {
          metaPatch.blocked = blockedValue.trim();
        } else {
          reply.code(400).send({ error: "blocked must be a string or null" });
          return;
        }
      }

      if (Object.hasOwn(body, "body")) {
        if (typeof body.body !== "string") {
          reply.code(400).send({ error: "body must be a string" });
          return;
        }
        rawBody = body.body;
      }

      if (Object.keys(metaPatch).length === 0 && unset.length === 0 && rawBody === undefined) {
        reply.code(400).send({ error: "No changes supplied" });
        return;
      }

      try {
        await this.taskService.update({
          id,
          metaPatch,
          unset,
          sections: {},
          rawBody,
        });
        const warnings = this.taskService.drainWarnings();
        if (warnings.length > 0) {
          this.onWarnings?.(warnings);
        }
        const next = await emitSnapshot();
        reply.send({ ok: true, snapshot: next });
      } catch (error) {
        reply.code(400).send({ error: (error as Error).message });
      }
    });

    app.delete("/api/tasks/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { cascade?: string } | undefined;
      const cascadeParam = (query?.cascade ?? "").toLowerCase();
      const cascade = cascadeParam === "true" || cascadeParam === "1" || cascadeParam === "yes";

      try {
        const result = await this.taskService.deleteTask(id, {
          cascade,
        });
        const warnings = this.taskService.drainWarnings();
        if (warnings.length > 0) {
          this.onWarnings?.(warnings);
        }
        const next = await emitSnapshot();
        reply.send({
          ok: true,
          deleted: {
            id: result.task.id,
            descendants: result.descendants.map((entry) => entry.id),
          },
          snapshot: next,
        });
      } catch (error) {
        reply.code(400).send({ error: (error as Error).message });
      }
    });

    app.get("/files/*", async (request, reply) => {
      const params = request.params as { "*": string };
      const encoded = params["*"] ?? "";
      const decoded = decodeURIComponent(encoded);
      const resolved = path.resolve(this.repoRoot, decoded);
      if (!this.isPathWithinRepo(resolved)) {
        reply.code(400).send({ error: "Invalid path" });
        return;
      }

      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) {
          reply.code(400).send({ error: "Path is not a file" });
          return;
        }
        const content = await fs.readFile(resolved, "utf8");
        reply.type("text/markdown; charset=utf-8").send(content);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reply.code(404).send({ error: "File not found" });
          return;
        }
        reply.code(500).send({ error: "Failed to read file" });
      }
    });

    app.get("/ws", { websocket: true }, (socket: WebSocket) => {
      clients.add(socket);
      this.sendSnapshot(socket, snapshot);
      socket.on("close", () => {
        clients.delete(socket);
      });
      socket.on("error", () => {
        clients.delete(socket);
      });
    });

    const requestedPort = options.port ?? 0;
    let listeningUrl: string;
    try {
      listeningUrl = await app.listen({
        host: "127.0.0.1",
        port: requestedPort,
      });
    } catch (error) {
      await watcher.close();
      await app.close();
      throw error;
    }

    const address = app.server.address() as AddressInfo | null;
    const actualPort =
      address && typeof address === "object"
        ? address.port
        : Number.parseInt(new URL(listeningUrl).port, 10);

    options.onReady?.({ url: listeningUrl, port: actualPort });
    this.printStartupBanner(listeningUrl);

    if (options.openBrowser) {
      await this.tryOpenBrowser(listeningUrl);
    }

    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      let stopping = false;
      const stop = async () => {
        if (stopping) {
          return;
        }
        stopping = true;
        try {
          await watcher.close();
        } catch {
          // ignore watcher close errors
        }
        try {
          await app.close();
        } catch (error) {
          process.stderr.write(`Failed to close web server: ${(error as Error).message}\n`);
        } finally {
          for (const [signal, handler] of signalHandlers) {
            process.removeListener(signal, handler);
          }
          finish();
        }
      };

      const requestStop = (announce: boolean) => {
        if (announce) {
          process.stdout.write("\nStopping Taskplain web server...\n");
        }
        void stop();
      };

      const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
      const signalHandlers = new Map<NodeJS.Signals, () => void>();
      for (const signal of signals) {
        const handler = () => {
          requestStop(true);
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
      }

      const externalSignal = options.signal;
      if (externalSignal) {
        if (externalSignal.aborted) {
          requestStop(false);
        } else {
          externalSignal.addEventListener(
            "abort",
            () => {
              requestStop(false);
            },
            { once: true },
          );
        }
      }
    });
  }

  private async tryOpenBrowser(url: string): Promise<void> {
    try {
      await open(url);
    } catch (error) {
      process.stderr.write(`Failed to open browser: ${(error as Error).message}\n`);
    }
  }

  private broadcast(clients: Set<WebSocket>, snapshot: WebServerSnapshot): void {
    const message: WebSocketMessage = {
      type: "tasks/snapshot",
      payload: snapshot,
    };
    const serialized = JSON.stringify(message);
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) {
        socket.send(serialized, (error) => {
          if (error) {
            clients.delete(socket);
          }
        });
      } else {
        clients.delete(socket);
      }
    }
  }

  private sendSnapshot(socket: WebSocket, snapshot: WebServerSnapshot): void {
    const message: WebSocketMessage = {
      type: "tasks/snapshot",
      payload: snapshot,
    };
    const serialized = JSON.stringify(message);
    if (socket.readyState === socket.OPEN) {
      socket.send(serialized, (error: Error | undefined) => {
        if (error) {
          socket.close();
        }
      });
    }
  }

  private scheduleRefresh(job: () => Promise<void>): void {
    const execute = async () => {
      try {
        await job();
      } catch (error) {
        process.stderr.write(`Failed to refresh tasks: ${(error as Error).message}\n`);
      } finally {
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = null;
        }
      }
    };
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(execute, 250);
  }

  private createWatcher(onChange: () => void): FSWatcher {
    const tasksPath = path.join(this.repoRoot, "tasks");
    const watcher = chokidar.watch(tasksPath, {
      ignoreInitial: true,
      persistent: true,
      depth: 4,
    });
    watcher.on("add", onChange);
    watcher.on("change", onChange);
    watcher.on("unlink", onChange);
    watcher.on("error", (error) => {
      process.stderr.write(`Watcher error: ${(error as Error).message}\n`);
    });
    return watcher;
  }

  private toRelativePath(filePath: string): string {
    const relative = path.relative(this.repoRoot, filePath);
    return relative.split(path.sep).join(path.posix.sep);
  }

  private loadBoardHtmlTemplate(): string {
    try {
      return fs.readFileSync(BOARD_HTML_PATH, "utf8");
    } catch (error) {
      throw new Error(
        `Unable to load board template at ${BOARD_HTML_PATH}: ${(error as Error).message}`,
      );
    }
  }

  private async readWebAsset(
    fileName: string,
  ): Promise<{ body: string | Buffer; contentType: string }> {
    const sanitized = path.normalize(fileName).replace(/^\.\/+/, "");
    const absolute = path.join(WEB_ASSETS_DIR, sanitized);
    if (!absolute.startsWith(WEB_ASSETS_DIR)) {
      throw new Error("Invalid asset path");
    }

    const ext = path.extname(absolute).toLowerCase();
    const textTypes = new Set([".js", ".css", ".html", ".json", ".txt"]);
    const encoding: BufferEncoding | undefined = textTypes.has(ext) ? "utf8" : undefined;

    try {
      const body = await fs.readFile(absolute, encoding);
      return { body, contentType: this.resolveContentType(ext) };
    } catch (_error) {
      throw new Error(`Asset '${fileName}' not found`);
    }
  }

  private resolveContentType(ext: string): string {
    switch (ext) {
      case ".js":
        return "application/javascript; charset=utf-8";
      case ".css":
        return "text/css; charset=utf-8";
      case ".html":
        return "text/html; charset=utf-8";
      case ".json":
        return "application/json; charset=utf-8";
      case ".txt":
        return "text/plain; charset=utf-8";
      default:
        return "application/octet-stream";
    }
  }

  private collectDescendantsFromIndex(id: string, index: HierarchyIndex): TaskDoc[] {
    const result: TaskDoc[] = [];
    const queue: TaskDoc[] = [...(index.childrenById.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) continue;
      result.push(next);
      const children = index.childrenById.get(next.meta.id);
      if (children) {
        queue.push(...children);
      }
    }
    return result;
  }

  private isPathWithinRepo(resolvedPath: string): boolean {
    const normalizedRepo = path.resolve(this.repoRoot);
    const normalizedTarget = path.resolve(resolvedPath);
    return normalizedTarget.startsWith(normalizedRepo);
  }

  private async refreshSnapshot(): Promise<WebServerSnapshot> {
    const docs = await this.taskService.listAllTasks();
    const warnings = this.taskService.drainWarnings();
    if (warnings.length > 0) {
      this.onWarnings?.(warnings);
    }
    return buildSnapshot(docs, this.repoRoot);
  }

  private printStartupBanner(url: string): void {
    process.stdout.write(`Taskplain web board available at ${url}\n`);
    process.stdout.write("Press CTRL+C to stop the server.\n");
  }
}

export function buildSnapshot(tasks: TaskDoc[], repoRoot: string): WebServerSnapshot {
  const columns: Record<State, WebServerTask[]> = {
    idea: [],
    ready: [],
    "in-progress": [],
    done: [],
    canceled: [],
  };

  const projectName = path.basename(repoRoot);

  if (tasks.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      columns,
      project_name: projectName,
    };
  }

  const { index } = buildHierarchyIndex(tasks);
  const docsById = new Map<string, TaskDoc>();
  for (const doc of tasks) {
    docsById.set(doc.meta.id, doc);
  }

  const relativePath = (absolute: string): string => {
    const rel = path.relative(repoRoot, absolute);
    return rel.split(path.sep).join(path.posix.sep);
  };

  const buildNode = (doc: TaskDoc): WebServerTask => {
    const childrenDocs = index.childrenById.get(doc.meta.id) ?? [];
    const sameStateChildren = childrenDocs.filter((child) => child.meta.state === doc.meta.state);
    const family = buildFamilyContext(doc, childrenDocs, index, docsById);
    return {
      id: doc.meta.id,
      title: doc.meta.title,
      kind: doc.meta.kind,
      state: doc.meta.state,
      priority: doc.meta.priority,
      updated_at: doc.meta.updated_at,
      last_activity_at: doc.meta.last_activity_at,
      path: relativePath(doc.path),
      blocked: typeof doc.meta.blocked === "string" ? doc.meta.blocked : undefined,
      acceptance: acceptanceStats(doc.body),
      family,
      children: sameStateChildren.map((child) => buildNode(child)),
    };
  };

  const query = new TaskQueryService(tasks);

  for (const state of STATE_ORDER) {
    const columnItems = query
      .list({ state })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const columnDocs = columnItems
      .map((item) => docsById.get(item.id))
      .filter((doc): doc is TaskDoc => Boolean(doc));

    for (const doc of columnDocs) {
      const parentId = index.parentById.get(doc.meta.id);
      if (parentId) {
        const parentDoc = docsById.get(parentId);
        if (parentDoc && parentDoc.meta.state === doc.meta.state) {
          continue;
        }
      }
      columns[state].push(buildNode(doc));
    }
  }

  return {
    generated_at: new Date().toISOString(),
    columns,
    project_name: projectName,
  };
}

function acceptanceStats(body: string): AcceptanceStats | undefined {
  const heading = resolveSectionHeading("acceptance_criteria");
  const normalized = body.replace(/\r\n/g, "\n");
  const headingIndex = normalized.indexOf(heading);
  if (headingIndex === -1) {
    return undefined;
  }
  const afterHeadingIndex = normalized.indexOf("\n", headingIndex);
  if (afterHeadingIndex === -1) {
    return undefined;
  }
  const remainder = normalized.slice(afterHeadingIndex + 1);
  const nextHeadingMatch = remainder.match(/\n##\s+/);
  const blockEnd = nextHeadingMatch?.index ?? remainder.length;
  const block = remainder.slice(0, blockEnd);
  const checkboxPattern = /^[-*]\s+\[(?: |x|X)\]\s+.+$/gm;
  const matches = block.match(checkboxPattern);
  if (!matches || matches.length === 0) {
    return undefined;
  }
  const completed = matches.filter((line) => /^[-*]\s+\[(x|X)\]/i.test(line)).length;
  return {
    completed,
    total: matches.length,
  };
}

function buildFamilyContext(
  doc: TaskDoc,
  childrenDocs: TaskDoc[],
  index: HierarchyIndex,
  docsById: Map<string, TaskDoc>,
): WebServerFamilyContext | undefined {
  const parentId = index.parentById.get(doc.meta.id);
  const parentDoc = parentId ? docsById.get(parentId) : undefined;
  if (!parentDoc && childrenDocs.length === 0) {
    return undefined;
  }
  const breakdown = createStateBreakdown(childrenDocs);
  return {
    parent: parentDoc
      ? {
          id: parentDoc.meta.id,
          title: parentDoc.meta.title,
          state: parentDoc.meta.state,
          kind: parentDoc.meta.kind,
        }
      : undefined,
    children: childrenDocs.map((child) => ({
      id: child.meta.id,
      title: child.meta.title,
      state: child.meta.state,
      kind: child.meta.kind,
    })),
    breakdown,
    child_count: childrenDocs.length,
  };
}

function createStateBreakdown(childrenDocs: TaskDoc[]): Record<State, number> {
  const breakdown: Record<State, number> = {
    idea: 0,
    ready: 0,
    "in-progress": 0,
    done: 0,
    canceled: 0,
  };
  for (const child of childrenDocs) {
    breakdown[child.meta.state] += 1;
  }
  return breakdown;
}

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0xffffffff;
}

export function generateProjectColor(projectPath: string): string {
  const h = hash32(projectPath) % 360; // hue
  const s = 65; // saturation
  const l = 55; // lightness
  // Convert HSL to RGB then to hex for broad favicon compatibility
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
