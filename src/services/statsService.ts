import type { ExecutionAttempt, ExecutionStatus, State, TaskDoc } from "../domain/types";

type ExecutorKey = string;

type ExecutorAccumulator = {
  key: ExecutorKey;
  tool: string | null;
  model: string | null;
  attempts: number;
  workSeconds: number;
  taskIds: Set<string>;
};

export interface StatsTaskRow {
  id: string;
  title: string;
  state: State;
  updated_at: string;
  last_activity_at?: string;
  attempts: number;
  total_seconds: number;
  latest_status: ExecutionStatus;
  latest_tool: string | null;
  latest_model: string | null;
  executors: Array<{ tool: string | null; model: string | null }>;
}

export interface StatsExecutorRow {
  tool: string | null;
  model: string | null;
  task_count: number;
  attempt_count: number;
  work_seconds: number;
  average_attempts: number;
  average_work_seconds: number;
}

export interface StatsReport {
  counts: {
    total_tasks: number;
    with_execution: number;
    insufficient_telemetry: number;
  };
  totals: {
    attempts: number;
    work_seconds: number;
  };
  averages: {
    attempts: number;
    work_seconds: number;
  };
  executors: StatsExecutorRow[];
  distinct_executor_count: number;
  tasks: StatsTaskRow[];
  insufficientTelemetryIds: string[];
}

function round(value: number, precision = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeValue(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function buildExecutorKey(tool: string | null, model: string | null): ExecutorKey {
  return `${tool ?? ""}@@${model ?? ""}`;
}

function selectLatestAttempt(attempts: ExecutionAttempt[]): ExecutionAttempt {
  if (attempts.length === 1) {
    return attempts[0]!;
  }
  return attempts.reduce((latest, candidate) => {
    const latestEnded = Date.parse(latest.ended_at);
    const candidateEnded = Date.parse(candidate.ended_at);
    return candidateEnded > latestEnded ? candidate : latest;
  }, attempts[0]!);
}

function sortAttemptsChronologically(attempts: ExecutionAttempt[]): ExecutionAttempt[] {
  return attempts.slice().sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

export function computeExecutionStats(tasks: TaskDoc[]): StatsReport {
  const rows: StatsTaskRow[] = [];
  const insufficient: string[] = [];
  const perExecutor = new Map<ExecutorKey, ExecutorAccumulator>();

  let totalAttempts = 0;
  let totalWorkSeconds = 0;

  for (const doc of tasks) {
    const telemetry = doc.meta.execution;
    if (!telemetry || telemetry.attempts.length === 0) {
      insufficient.push(doc.meta.id);
      continue;
    }

    const chronological = sortAttemptsChronologically(telemetry.attempts);
    const attempts = chronological.length;
    const totalSeconds = chronological.reduce((sum, attempt) => sum + attempt.duration_seconds, 0);
    const latestAttempt = selectLatestAttempt(chronological);

    totalAttempts += attempts;
    totalWorkSeconds += totalSeconds;

    const taskExecutors = new Map<ExecutorKey, { tool: string | null; model: string | null }>();

    chronological.forEach((attempt) => {
      const tool = normalizeValue(attempt.executor.tool ?? null);
      const model = normalizeValue(attempt.executor.model ?? null);
      const key = buildExecutorKey(tool, model);
      taskExecutors.set(key, { tool, model });

      const accumulator = perExecutor.get(key) ?? {
        key,
        tool,
        model,
        attempts: 0,
        workSeconds: 0,
        taskIds: new Set<string>(),
      };
      accumulator.attempts += 1;
      accumulator.workSeconds += attempt.duration_seconds;
      accumulator.taskIds.add(doc.meta.id);
      perExecutor.set(key, accumulator);
    });

    rows.push({
      id: doc.meta.id,
      title: doc.meta.title,
      state: doc.meta.state,
      updated_at: doc.meta.updated_at,
      last_activity_at: doc.meta.last_activity_at,
      attempts,
      total_seconds: totalSeconds,
      latest_status: latestAttempt.status,
      latest_tool: normalizeValue(latestAttempt.executor.tool ?? null),
      latest_model: latestAttempt.executor.model ?? null,
      executors: Array.from(taskExecutors.values()),
    });
  }

  const withExecution = rows.length;
  const totalTasks = tasks.length;
  const insufficientTelemetry = insufficient.length;

  const averages =
    withExecution === 0
      ? { attempts: 0, work_seconds: 0 }
      : {
          attempts: round(totalAttempts / withExecution),
          work_seconds: round(totalWorkSeconds / withExecution),
        };

  const executorRows: StatsExecutorRow[] = Array.from(perExecutor.values()).map(
    ({ tool, model, attempts: attemptCount, workSeconds, taskIds }) => {
      const taskCount = taskIds.size;
      const averageAttempts = taskCount === 0 ? 0 : round(attemptCount / taskCount);
      const averageWorkSeconds = taskCount === 0 ? 0 : round(workSeconds / taskCount);
      return {
        tool,
        model,
        task_count: taskCount,
        attempt_count: attemptCount,
        work_seconds: workSeconds,
        average_attempts: averageAttempts,
        average_work_seconds: averageWorkSeconds,
      };
    },
  );

  executorRows.sort((a, b) => {
    if (b.attempt_count !== a.attempt_count) {
      return b.attempt_count - a.attempt_count;
    }
    if (b.task_count !== a.task_count) {
      return b.task_count - a.task_count;
    }
    const toolCompare = (a.tool ?? "").localeCompare(b.tool ?? "");
    if (toolCompare !== 0) {
      return toolCompare;
    }
    return (a.model ?? "").localeCompare(b.model ?? "");
  });

  const distinctExecutorCount = executorRows.length;

  return {
    counts: {
      total_tasks: totalTasks,
      with_execution: withExecution,
      insufficient_telemetry: insufficientTelemetry,
    },
    totals: {
      attempts: totalAttempts,
      work_seconds: totalWorkSeconds,
    },
    averages,
    executors: executorRows,
    distinct_executor_count: distinctExecutorCount,
    tasks: rows,
    insufficientTelemetryIds: insufficient,
  };
}
