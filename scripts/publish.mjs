#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");
const tmpRoot = path.join(rootDir, ".local", "tmp");
const tarballDir = path.join(tmpRoot, "publish");
const helpOutputPath = path.join(tmpRoot, "taskplain-help.txt");
const installDir = path.join(tmpRoot, "publish-install");
const npmCacheDir = path.join(tmpRoot, "npm-cache");

function run(command, args, options = {}) {
  const { cwd = rootDir, ...rest } = options;
  execFileSync(command, args, {
    stdio: "inherit",
    cwd,
    ...rest,
  });
}

await fs.mkdir(tmpRoot, { recursive: true });
await fs.rm(tarballDir, { recursive: true, force: true });
await fs.mkdir(tarballDir, { recursive: true });
await fs.rm(installDir, { recursive: true, force: true });
await fs.mkdir(installDir, { recursive: true });
await fs.mkdir(npmCacheDir, { recursive: true });

console.log("🔁 Validating project with prepublishOnly");
run("pnpm", ["run", "prepublishOnly"]);

console.log("📦 Packing tarball");
run("pnpm", ["pack", "--pack-destination", tarballDir]);

const entries = await fs.readdir(tarballDir);
const tarballs = await Promise.all(
  entries
    .filter((name) => name.endsWith(".tgz"))
    .map(async (name) => {
      const stats = await fs.stat(path.join(tarballDir, name));
      return { name, mtimeMs: stats.mtimeMs };
    }),
);

if (tarballs.length === 0) {
  throw new Error(`Failed to locate tarball under ${tarballDir}`);
}

tarballs.sort((a, b) => b.mtimeMs - a.mtimeMs);
const tarballPath = path.join(tarballDir, tarballs[0].name);
console.log(`✅ Tarball ready at ${path.relative(rootDir, tarballPath)}`);

console.log("🧪 Installing tarball in temporary workspace");
const tempPackageJson = {
  name: "taskplain-publish-check",
  version: "0.0.0",
  private: true,
  dependencies: {
    taskplain: `file:${tarballPath}`,
  },
};
await fs.writeFile(
  path.join(installDir, "package.json"),
  `${JSON.stringify(tempPackageJson, null, 2)}\n`,
);
let helpBuffer;
let verificationMode = "pnpm exec";
try {
  const installOutput = execFileSync("pnpm", ["install", "--offline"], {
    cwd: installDir,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (installOutput.length > 0) {
    process.stdout.write(installOutput.toString());
  }

  console.log("🔎 Verifying CLI help output");
  helpBuffer = execFileSync("pnpm", ["exec", "taskplain", "--help"], {
    cwd: installDir,
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (error) {
  const stdout = error?.stdout?.toString?.() ?? "";
  if (stdout.includes("ERR_PNPM_NO_OFFLINE_TARBALL")) {
    console.warn(
      "⚠️ pnpm offline install failed (missing cached tarballs). Falling back to direct execution using workspace dependencies.",
    );
    const extractDir = path.join(tmpRoot, "publish-extract");
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.mkdir(extractDir, { recursive: true });
    run("tar", ["-xzf", tarballPath, "-C", extractDir]);
    const cliPath = path.join(extractDir, "package", "dist", "cli.js");
    const nodePath = [path.join(rootDir, "node_modules"), process.env.NODE_PATH ?? ""]
      .filter((value) => value.length > 0)
      .join(path.delimiter);
    helpBuffer = execFileSync("node", [cliPath, "--help"], {
      cwd: extractDir,
      env: nodePath.length > 0 ? { ...process.env, NODE_PATH: nodePath } : process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    verificationMode = "direct node fallback";
  } else {
    throw error;
  }
}

await fs.writeFile(helpOutputPath, helpBuffer);
console.log(
  `📝 CLI help captured to ${path.relative(rootDir, helpOutputPath)} (${verificationMode})`,
);

const publishArgs = process.argv.slice(2).filter((arg) => arg !== "--");
console.log(
  "🚀 Publishing package with pnpm publish",
  publishArgs.length ? `(extra args: ${publishArgs.join(" ")})` : "",
);
run("pnpm", ["publish", ...publishArgs], {
  env: {
    ...process.env,
    npm_config_cache: npmCacheDir,
  },
});
