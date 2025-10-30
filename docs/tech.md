# Tech Stack — Taskplain CLI

Taskplain is a TypeScript-first CLI that favors a small, predictable toolchain so new utilities can reuse the same setup without surprises. This document captures the runtime, libraries, and conventions to mirror when standing up a sibling CLI.

## Runtime and Language

- **Node.js 18+** — All targets and builds assume the modern Node 18 runtime (`target: "node18"` in `tsup.config.ts`).
- **TypeScript** — Strict compiler settings (`strict: true`) with `NodeNext` modules, declaration emit, and sourcemaps enabled so downstream tooling can consume both JavaScript and typings.

## Build and Packaging

- **Bundler**: `tsup` compiles `src/cli.ts` and `src/index.ts` into CommonJS artifacts in `dist/` with sourcemaps and `.d.ts` files. No splitting or minification keeps output readable and debuggable.
- **Compiler config**: `tsconfig.json` targets `ES2022`, emits declarations/maps, and skips lib checks for faster builds. Reuse this baseline so packages share the same module and emit settings.
- **Distribution**: `package.json` exposes `dist/cli.js` through the `"bin"` map and ships TypeScript typings via `"types": "dist/index.d.ts"`. Mirror the same layout for CLIs that need programmatic access.
- **Scripts**: Provide `pnpm build` (tsup), `pnpm dev` (tsup watch), `pnpm typecheck` (tsc --noEmit), and `pnpm test` (vitest) so developers can jump between projects without relearning commands.
- **Linting & formatting**: `@biomejs/biome` replaces ESLint/Prettier with a single Rust-based tool for fast lint + format (`pnpm lint` delegates here).

## Core Dependencies

### CLI and Validation

- **`commander`** — Command surface and option parsing. Commands accept shared `--output human|json` and `--dry-run` flags; new CLIs should keep the same names and semantics.
- **`zod`** — Runtime validation for metadata, CLI arguments, and service responses. Place schemas in `src/domain` so validation logic stays central and reusable.

### Filesystem and Git

- **`fs-extra`** — Promise-based filesystem helpers for copy/move operations across state directories.
- **`simple-git`** — Git wrapper for state moves, staging, and detecting repo configuration; keep usage isolated inside adapters.
- **`chokidar`** — Watches task files for the web UI, debouncing events before rebuilding snapshots.
- **`proper-lockfile`** — Guarantees exclusive access around mutating commands such as `taskplain fix` or bulk updates.

### Document Processing

- **`gray-matter`** + **`yaml`** — Parse and serialize Markdown frontmatter with comment preservation, keeping task docs deterministic.
- **`unified`** + **`remark-parse`** — Power documentation transforms and snippet management when generating the handbook or injecting agent guides.

### Web Interface

- **`fastify`** — Local HTTP server for `taskplain web`, serving both REST endpoints and static assets.
- **`@fastify/websocket`** — Pushes real-time task updates to browsers without polling.
- **`open`** — Optional helper to launch the user's default browser once the web UI is ready.

### Static Assets

- **`src/resources/web/board.html`**, **`board.css`**, **`board.js`** — Embedded SPA assets copied into `dist/` during bundling; no runtime build step.
- **CDN fallbacks**: `marked.js` for Markdown rendering and `canvas-confetti` for celebratory animations, each with inline fallbacks so the UI still works offline.

## Project Structure

- `src/domain` — Pure types, schemas, and state helpers.
- `src/adapters` — IO-bound wrappers (Git, task files, logging).
- `src/services` — Business flows built on domain and adapters.
- `src/utils` — Shared CLI helpers (formatting, option wiring).
- `src/cli.ts` — Entry point that registers commands via `commander`.
- `src/index.ts` — Programmatic API surface for embedding.

Reusing this layout keeps concerns separated and makes it easy to port services between CLIs.

## Testing and Quality

- **Vitest** powers unit, integration, and golden tests. Tests live under `tests/` with temporary workspaces for git-heavy flows.
- CI and local workflows rely on `pnpm test` and `node dist/cli.js validate`. New CLIs should expose equivalent validation commands so Taskplain-style automation can reuse scripts.

## Continuous Integration and Automation

- Workflow: `.github/workflows/ci.yml` runs on every `push` and `pull_request` targeting `main`.
- Install step: `pnpm/action-setup@v4` pins `pnpm@10.20.0`; `actions/setup-node@v4` provisions Node 20 with pnpm cache reuse (`cache: pnpm`, `cache-dependency-path: pnpm-lock.yaml`).
- Verification: `pnpm verify` aggregates lint, test, and build gates; the job finishes with `node dist/cli.js validate` to enforce task hygiene.
- Policy: CI must pass before merge, so regressions in tooling or schema validation block release.

## Tool Usage Patterns

- Run `pnpm dev` during development for live `tsup` rebuilding; pair with `vitest --watch` when iterating on services.
- Invoke `taskplain validate --strict` locally before committing to surface schema warnings the same way CI does.
- Use `taskplain web` for an ephemeral board; the server derives a deterministic port per repo and tears down cleanly when the process stops.
- Rely on `taskplain fix` and `taskplain cleanup --dry-run` to repair metadata drift and prune completed work without manual edits.

## Option and UX Conventions

- Commands that write state expose `--dry-run` for previews and support JSON output via `--output json`.
- Use short, hyphenated task IDs (1–3 lowercase words, max 24 chars) and follow [Conventional Commits](https://www.conventionalcommits.org/) format with `[Task:<id>]` trailer: `feat(cli): add list command [Task:cli-list]`
- Color handling is centralized behind `--color auto|always|never`; other CLIs should mirror this switch for consistent accessibility and logging behavior.

## Getting Started Checklist for New CLIs

1. Copy the `package.json` script set and dependency versions listed above.
2. Clone `tsup.config.ts` and `tsconfig.json` as-is unless the target runtime changes.
3. Scaffold `src/` folders following the domain → adapters → services → CLI layering.
4. Wire commands with `commander`, reuse shared option helpers, and honor `--output` / `--dry-run`.
5. Add Vitest suites and a `validate` flow so CI parity with Taskplain remains intact.

These guardrails ensure any new CLI in the Taskplain ecosystem feels familiar, builds the same way, and plugs into existing automation without additional setup.
