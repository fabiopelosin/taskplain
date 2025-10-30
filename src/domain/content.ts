import fs from "node:fs";
import path from "node:path";

const CONTENT_CANDIDATES = [
  path.resolve(__dirname, "./docsources"),
  path.resolve(__dirname, "../docsources"),
  path.resolve(__dirname, "../src/docsources"),
  path.resolve(__dirname, "../../src/docsources"),
  // Fallbacks for legacy layouts that kept docs under a generic content directory.
  path.resolve(__dirname, "../content"),
  path.resolve(__dirname, "../src/content"),
  path.resolve(__dirname, "../../src/content"),
];

let cachedDir: string | undefined;

function resolveContentDir(): string {
  if (cachedDir) {
    return cachedDir;
  }

  for (const dir of CONTENT_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "handbook-snippet.md"))) {
      cachedDir = dir;
      return dir;
    }
  }

  throw new Error("Unable to locate handbook content directory.");
}

export function readDocsSource(fileName: string): string {
  const dir = resolveContentDir();
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unable to locate content file: ${fileName}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

export function resolveDocsSourcePath(fileName: string): string {
  const dir = resolveContentDir();
  return path.join(dir, fileName);
}
