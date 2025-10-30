import path from "node:path";

import type { State } from "../domain/types";

const RESET = "\u001b[0m";

export type ColorMode = "auto" | "always" | "never";

let colorMode: ColorMode = "auto";

function detectAutoColor(): boolean {
  if (process.env.NO_COLOR && ["1", "true"].includes(process.env.NO_COLOR.toLowerCase())) {
    return false;
  }
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return Boolean(process.stdout?.isTTY);
}

function colorEnabled(): boolean {
  if (colorMode === "always") {
    return true;
  }
  if (colorMode === "never") {
    return false;
  }
  return detectAutoColor();
}

function apply(code: string, text: string): string {
  if (!colorEnabled()) {
    return text;
  }
  return `\u001b[${code}m${text}${RESET}`;
}

export function setColorMode(mode: ColorMode): void {
  colorMode = mode;
}

export function getColorMode(): ColorMode {
  return colorMode;
}

export const colors = {
  bold: (text: string) => apply("1", text),
  dim: (text: string) => apply("2", text),
  red: (text: string) => apply("31", text),
  green: (text: string) => apply("32", text),
  yellow: (text: string) => apply("33", text),
  blue: (text: string) => apply("34", text),
  magenta: (text: string) => apply("35", text),
  cyan: (text: string) => apply("36", text),
  gray: (text: string) => apply("90", text),
};

export function formatId(id: string): string {
  return colors.cyan(id);
}

export function formatPath(filePath: string, repoRoot?: string): string {
  const relative = repoRoot ? path.relative(repoRoot, filePath) || filePath : filePath;
  return colors.dim(relative);
}

export function formatState(state: State, display?: string): string {
  const value = display ?? state.toUpperCase();
  switch (state) {
    case "done":
      return colors.green(value);
    case "in-progress":
      return colors.cyan(value);
    case "canceled":
      return colors.magenta(value);
    case "ready":
      return colors.blue(value);
    default:
      return colors.yellow(value);
  }
}

export function formatPriority(priority: string, display?: string): string {
  const value = display ?? priority.toUpperCase();
  switch (priority) {
    case "urgent":
      return colors.red(value);
    case "high":
      return colors.yellow(value);
    case "normal":
      return colors.blue(value);
    case "low":
      return colors.gray(value);
    default:
      return colors.dim(value);
  }
}

export interface TableCell {
  text: string;
  align?: "left" | "right";
  color?: (text: string) => string;
}

export interface TableOptions {
  flexColumns?: number[];
  minWidths?: number[];
  maxWidths?: number[];
  pad?: number;
  maxTotalWidth?: number;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  if (width <= 3) {
    return text.slice(0, width);
  }
  return `${text.slice(0, width - 3)}...`;
}

export function renderTable(
  headers: TableCell[],
  rows: TableCell[][],
  options: TableOptions = {},
): string {
  const columnCount = headers.length;
  const pad = options.pad ?? 2;
  const gap = " ".repeat(pad);
  const flexColumns = options.flexColumns ?? [1];
  const minWidths = options.minWidths ?? headers.map((header) => Math.max(6, header.text.length));
  const maxWidths = options.maxWidths ?? headers.map(() => Number.POSITIVE_INFINITY);
  const limit = options.maxTotalWidth ?? process.stdout?.columns ?? Number.POSITIVE_INFINITY;

  const widths = headers.map((header, index) => {
    const cells = rows.map((row) => row[index]?.text ?? "");
    const natural = Math.max(header.text.length, ...cells.map((cell) => cell.length));
    return Math.min(Math.max(natural, minWidths[index] ?? 4), maxWidths[index] ?? natural);
  });

  const totalSpacing = pad * (columnCount - 1);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + totalSpacing;

  if (totalWidth > limit) {
    let excess = totalWidth - limit;
    const effectiveMinWidths = headers.map((header, index) =>
      Math.max(minWidths[index] ?? header.text.length, header.text.length),
    );

    while (excess > 0) {
      let reduced = false;
      for (const column of flexColumns) {
        if (column < 0 || column >= columnCount) {
          continue;
        }
        if (widths[column] > effectiveMinWidths[column]) {
          widths[column] -= 1;
          excess -= 1;
          reduced = true;
          if (excess === 0) {
            break;
          }
        }
      }
      if (!reduced) {
        break;
      }
    }
  }

  const lines: string[] = [];
  const headerLine = headers
    .map((header, index) => {
      const truncated = truncate(header.text, widths[index]);
      const padded = truncated.padEnd(widths[index]);
      const color = header.color ?? colors.bold;
      return color(padded);
    })
    .join(gap);
  lines.push(headerLine);
  lines.push(widths.map((width) => "-".repeat(width)).join(gap));

  for (const row of rows) {
    const rendered = row
      .map((cell, index) => {
        const truncated = truncate(cell.text, widths[index]);
        const aligned =
          cell.align === "right"
            ? truncated.padStart(widths[index])
            : truncated.padEnd(widths[index]);
        return cell.color ? cell.color(aligned) : aligned;
      })
      .join(gap);
    lines.push(rendered);
  }

  return `${lines.join("\n")}\n`;
}

export function formatHeading(text: string): string {
  return colors.bold(text);
}

export function formatNote(text: string): string {
  return colors.dim(text);
}

export function sortEntries<T>(entries: [string, T][]): [string, T][] {
  return entries.sort((a, b) => a[0].localeCompare(b[0]));
}
