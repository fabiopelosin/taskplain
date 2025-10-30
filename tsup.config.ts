import path from "node:path";
import fs from "fs-extra";
import { defineConfig } from "tsup";

const staticCopies = [
  {
    src: path.resolve(__dirname, "src/resources/web"),
    dest: path.resolve(__dirname, "dist/resources/web"),
  },
  {
    src: path.resolve(__dirname, "src/docsources"),
    dest: path.resolve(__dirname, "dist/docsources"),
  },
  {
    src: path.resolve(__dirname, "docs"),
    dest: path.resolve(__dirname, "dist/docs"),
  },
];

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["cjs"],
  target: "node18",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  shims: false,
  minify: false,
  esbuildPlugins: [
    {
      name: "copy-static-assets",
      setup(build) {
        build.onStart(async () => {
          await Promise.all(
            staticCopies.map(async ({ dest }) => {
              await fs.remove(dest);
            }),
          );
        });
        build.onEnd(async () => {
          await Promise.all(
            staticCopies.map(async ({ src, dest }) => {
              if (await fs.pathExists(src)) {
                await fs.copy(src, dest, { overwrite: true });
              }
            }),
          );
        });
      },
    },
  ],
});
