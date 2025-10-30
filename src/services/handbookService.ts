import path from "node:path";
import fs from "fs-extra";

import {
  getHandbookSnippet,
  type HandbookFormat,
  type HandbookSection,
  renderHandbook,
  resolveRepoPath,
  SNIPPET_MARKER_END,
} from "../domain/canonical";

function ensureTrailingNewline(input: string): string {
  return input.endsWith("\n") ? input : `${input}\n`;
}

export async function generateHandbook(
  section: HandbookSection,
  format: HandbookFormat,
): Promise<string> {
  return renderHandbook(section, format);
}

export type SnippetWriteResult = {
  changed: boolean;
  path: string;
};

export type SnippetCheckResult = {
  ok: boolean;
  path: string;
  reason?: "file-missing" | "marker-missing" | "stale";
};

export async function writeManagedSnippet(
  repoRoot: string,
  target: string,
): Promise<SnippetWriteResult> {
  const snippet = getHandbookSnippet("md");
  const absolutePath = resolveRepoPath(repoRoot, target);
  await fs.ensureDir(path.dirname(absolutePath));

  let original = "";
  let exists = false;
  try {
    original = await fs.readFile(absolutePath, "utf8");
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const updated = injectSnippet(original, snippet);
  if (exists && updated === original) {
    return { changed: false, path: absolutePath };
  }

  await fs.writeFile(absolutePath, updated, "utf8");
  return { changed: true, path: absolutePath };
}

export async function checkManagedSnippet(
  repoRoot: string,
  target: string,
): Promise<SnippetCheckResult> {
  const absolutePath = resolveRepoPath(repoRoot, target);
  let source: string;
  try {
    source = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, path: absolutePath, reason: "file-missing" };
    }
    throw error;
  }

  const extracted = extractSnippetBlock(source);
  if (!extracted) {
    return { ok: false, path: absolutePath, reason: "marker-missing" };
  }

  const expected = getHandbookSnippet("md").trimEnd();
  const actual = extracted.trimEnd();
  if (expected === actual) {
    return { ok: true, path: absolutePath };
  }

  return { ok: false, path: absolutePath, reason: "stale" };
}

function injectSnippet(source: string, snippet: string): string {
  const normalizedSnippet = ensureTrailingNewline(snippet);
  if (source.length === 0) {
    return normalizedSnippet;
  }

  const existing = extractSnippetRange(source);

  if (existing) {
    const { start, end } = existing;
    const before = source.slice(0, start);
    const after = source.slice(end);
    let output = before + normalizedSnippet + (after.trim().length === 0 ? "" : after);
    // Deduplicate any additional managed snippet blocks beyond the first one
    let first = extractSnippetRange(output);
    if (first) {
      // Search for a second block after the first one
      while (true) {
        const searchFrom = first.end;
        const tail = output.slice(searchFrom);
        const nextMatch = ANY_START_MARKER.exec(tail);
        if (!nextMatch || nextMatch.index < 0) break;
        const nextStart = searchFrom + nextMatch.index;
        const nextEndIndex = output.indexOf(SNIPPET_MARKER_END, nextStart + nextMatch[0].length);
        if (nextEndIndex < 0) {
          // Malformed extra block; stop to avoid accidental truncation
          break;
        }
        const nextAfterEnd = nextEndIndex + SNIPPET_MARKER_END.length;
        output = output.slice(0, nextStart) + output.slice(nextAfterEnd);
        // Recompute first range in case positions shifted
        first = extractSnippetRange(output);
        if (!first) break;
      }
    }
    return output;
  }

  let working = source;
  if (!working.endsWith("\n")) {
    working += "\n";
  }
  if (!working.endsWith("\n\n")) {
    working += "\n";
  }
  return working + normalizedSnippet;
}

type SnippetRange = { start: number; end: number };

// Matches any Taskplain-managed start marker version, e.g. <!-- taskplain:start v1 --> or <!-- taskplain:start v0.1.0 -->
const ANY_START_MARKER = /<!--\s*taskplain:start\s+v[^\s>]+\s*-->/;

function extractSnippetRange(source: string): SnippetRange | null {
  // Always locate the earliest Taskplain-managed snippet, regardless of version
  const match = ANY_START_MARKER.exec(source);
  if (!match || match.index < 0) return null;
  const startIndex = match.index;
  const matchedLength = match[0].length;
  const endIndex = source.indexOf(SNIPPET_MARKER_END, startIndex + matchedLength);
  if (endIndex < 0) return null;
  const afterEnd = endIndex + SNIPPET_MARKER_END.length;
  return { start: startIndex, end: afterEnd };
}

function extractSnippetBlock(source: string): string | null {
  const range = extractSnippetRange(source);
  if (!range) return null;
  return source.slice(range.start, range.end);
}

export { extractSnippetBlock };
