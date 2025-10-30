#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/*
  Portable lint entry:
  - If @biomejs/biome is installed locally, run `biome check` using biome.json.
  - Otherwise, fall back to TypeScript type-checking (tsc --noEmit).
*/
import { existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

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
  const args = ["check", "--config-path", path.join(root, "biome.json"), "."];
  const code = run(biomeBin, args);
  process.exitCode = code;
  return true;
}

function runWithTsc() {
  // Locate local TypeScript compiler entrypoint
  const localTsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (existsSync(localTsc)) {
    return run(process.execPath, [localTsc, "--noEmit"]);
  }
  // Fallback to a global tsc on PATH if available
  const code = run("tsc", ["--noEmit"]);
  if (code !== 0) {
    console.error("TypeScript not found locally or globally. Install devDependency or add Biome.");
  }
  return code;
}

// Prefer Biome if available; otherwise fall back to tsc
if (!runWithBiome()) {
  const code = runWithTsc();
  process.exitCode = code;
}
