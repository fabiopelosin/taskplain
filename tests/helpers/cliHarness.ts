import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import fs from "fs-extra";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..", "..");
export const cliPath = path.join(repoRoot, "dist", "cli.js");
const lockPath = path.join(repoRoot, ".taskplain-build.lock");

async function getLatestMtime(target: string): Promise<number> {
  const exists = await fs.pathExists(target);
  if (!exists) {
    return 0;
  }

  const stat = await fs.stat(target);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  const entries = await fs.readdir(target);
  let latest = stat.mtimeMs;
  for (const entry of entries) {
    const entryPath = path.join(target, entry);
    latest = Math.max(latest, await getLatestMtime(entryPath));
  }
  return latest;
}

async function isBuildCurrent(): Promise<boolean> {
  if (!(await fs.pathExists(cliPath))) {
    return false;
  }
  const distMtime = (await fs.stat(cliPath)).mtimeMs;
  const sourceMtime = Math.max(
    await getLatestMtime(path.join(repoRoot, "src")),
    await getLatestMtime(path.join(repoRoot, "scripts")),
  );
  return distMtime >= sourceMtime;
}

async function acquireBuildLock(): Promise<() => Promise<void>> {
  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, "wx");
      return async () => {
        await handle.close();
        await fs.remove(lockPath);
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        await sleep(50);
        continue;
      }
      if (err.code === "ENOENT") {
        await fs.ensureDir(path.dirname(lockPath));
        continue;
      }
      throw error;
    }
  }
}

export async function ensureCliBuilt(): Promise<void> {
  if (await isBuildCurrent()) {
    return;
  }

  const release = await acquireBuildLock();
  try {
    if (await isBuildCurrent()) {
      return;
    }
    await execFileAsync("pnpm", ["run", "build"], { cwd: repoRoot });
  } finally {
    await release();
  }
}
