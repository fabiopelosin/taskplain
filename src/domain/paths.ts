import path from "node:path";
import type { Kind, State } from "./types";

export const STATE_PREFIXES: Record<State, string> = {
  idea: "00-idea",
  ready: "10-ready",
  "in-progress": "20-in-progress",
  done: "30-done",
  canceled: "40-canceled",
};

export function stateDir(state: State): string {
  return path.posix.join("tasks", STATE_PREFIXES[state]);
}

export function activeName(kind: Kind, id: string): string {
  return `${kind}-${id}.md`;
}

export function doneName(dateISO: string, kind: Kind, id: string): string {
  return `${dateISO} ${kind}-${id}.md`;
}

export function toPath(repoRoot: string, state: State, name: string): string {
  // Always resolve using posix to keep deterministic separators.
  const rel = path.posix.join("tasks", STATE_PREFIXES[state], name);
  return path.join(repoRoot, rel);
}

export function isWithinRepo(repoRoot: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(repoRoot);
  const normalizedCandidate = path.resolve(candidate);
  return normalizedCandidate.startsWith(normalizedRoot);
}
