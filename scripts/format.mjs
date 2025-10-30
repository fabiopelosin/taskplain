#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/*
  Portable format entry:
  - If @biomejs/biome is installed locally, run `biome format` using biome.json.
  - Otherwise, run a lightweight whitespace normalizer across common text files.
    Rules: LF line endings, trim trailing spaces, ensure single EOL at EOF.
*/
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check") || args.includes("-c");

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  return res.status ?? 1;
}

function findLocalBin(binName) {
  const candidate = path.join(root, "node_modules", ".bin", binName);
  return existsSync(candidate) ? candidate : null;
}

function runWithBiome() {
  const biomeBin = findLocalBin("biome");
  if (!biomeBin) return false;
  const biomeArgs = ["format", "--config-path", path.join(root, "biome.json")];
  if (!checkOnly) biomeArgs.push("--write");
  biomeArgs.push(".");
  const code = run(biomeBin, biomeArgs);
  process.exitCode = code;
  return true;
}

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".txt",
  ".css",
  ".scss",
]);
const IGNORE_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

function isTextFile(p) {
  const ext = path.extname(p).toLowerCase();
  return TEXT_EXTS.has(ext) || (!ext && !p.includes(".")); // simple heuristic
}

function walkDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".DS_Store")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      walkDir(full);
    } else if (ent.isFile()) {
      if (isTextFile(full)) files.push(full);
    }
  }
}

function normalizeContent(buf) {
  // Convert to string, normalize CRLF->LF, trim trailing spaces per line, ensure single trailing EOL
  let s = buf.toString("utf8");
  s = s.replace(/\r\n/g, "\n");
  s = s
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n");
  if (!s.endsWith("\n")) s += "\n";
  return s;
}

const files = [];

function runWhitespaceFormatter() {
  walkDir(root);
  let changed = 0;
  let failed = 0;
  for (const file of files) {
    let orig;
    try {
      orig = readFileSync(file);
    } catch {
      continue;
    }
    const norm = normalizeContent(orig);
    if (norm !== orig.toString("utf8")) {
      if (checkOnly) {
        console.error(`Unformatted: ${path.relative(root, file)}`);
        failed++;
      } else {
        writeFileSync(file, norm, "utf8");
        changed++;
      }
    }
  }
  if (checkOnly) {
    if (failed > 0) {
      console.error(`\nFormatting check failed for ${failed} file(s).`);
      return 1;
    }
    console.log("All files pass whitespace formatting checks.");
    return 0;
  } else {
    console.log(`Applied whitespace normalization to ${changed} file(s).`);
    return 0;
  }
}

if (!runWithBiome()) {
  const code = runWhitespaceFormatter();
  process.exitCode = code;
}
