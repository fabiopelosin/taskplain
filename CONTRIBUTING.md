# Contributing to Taskplain

Thank you for helping shape Taskplain! This document explains how to set up your environment, run the workflow, and land changes safely.

## Getting Started

### Prerequisites

- Node.js 18 or newer (the CLI targets Node 18 LTS) with [Corepack](https://nodejs.org/api/corepack.html) enabled
- pnpm 10+ (recommended: `corepack enable pnpm && corepack use pnpm@10`)
- Git

### Clone & Install

```bash
git clone https://github.com/fabiopelosin/taskplain.git
cd taskplain
pnpm install
```

Taskplain bundles to `dist/` via `tsup`. After installing dependencies, run the local build so the compiled CLI is available:

```bash
pnpm build
```

The compiled binary lives at `dist/cli.js`. You can run it directly (`node dist/cli.js ...`) or point at the workspace build with `npx taskplain`.

## Workflow Overview

1. Capture new ideas with `taskplain new` when gaps surface. Flesh out the overview, acceptance criteria, and metadata before promoting beyond `00-idea/`.
2. Locate the task you plan to work on under `tasks/`. Ensure scope, dependencies, and acceptance criteria are complete.
3. Move the task to in-progress with `taskplain pickup <id>` before editing any files so state transitions are recorded.
4. Update the task document as you work—record findings, blockers, and validation results in the appropriate sections.
5. Run the relevant validation commands (`pnpm verify`, `node dist/cli.js validate`, targeted tests) before marking the task complete.
6. Capture Post-Implementation Insights (Changelog, Decisions, Architecture) in the task file, then run `taskplain complete <id>`.
7. Commit your changes using Conventional Commit syntax with the task trailer (see below), and push your branch for review.

## Local Commands

Stick with pnpm when invoking scripts—`pnpm-lock.yaml` is the source of truth for dependency state. The commands you'll run most often are:

- `pnpm build` bundles the CLI and type definitions to `dist/`.
- `pnpm test` executes the Vitest suite (service and CLI integration tests).
- `taskplain validate` verifies every task file matches the schema and invariants.

Helpful extras:

- `pnpm typecheck` runs `tsc --noEmit` for static analysis.
- `pnpm dev` watches source files and rebuilds the bundle on change.
- `pnpm run prepublishOnly` runs build, typecheck, and tests sequentially—the same gate used pre-publish.

Please ensure `pnpm run prepublishOnly` and `taskplain validate` succeed before opening a pull request or submitting a patch. If pnpm blocks optional build scripts (for example `esbuild`), run `pnpm approve-builds` once in the repository.

## Coding Standards

- Use TypeScript throughout the codebase.
- Prefer pure functions in the domain layer and keep filesystem/git effects inside services or adapters.
- Maintain exhaustive test coverage around CLI surfaces; the integration tests spin up temporary repositories, so keep fixtures small.
- When editing documentation, update the relevant files in `docs/` (PRD, architecture, roadmap, changelog, decisions) and `README.md` so the published guidance stays accurate.
- Generated assets (like the handbook snippet in `AGENTS.md`) should be refreshed with the CLI rather than edited manually.

## Commit Messages

Use Conventional Commits with the Taskplain trailer:

```
<type>[optional scope]: <description>  [Task:<id>]
```

Examples:

- `feat(cli): add pickup context summary  [Task:pickup-context]`
- `docs: refresh contributing guide  [Task:polish-docs]`

Keep the trailer separated from the subject by two spaces to preserve compatibility with downstream tooling. Reference GitHub issues in the body when relevant (for example, `Refs #123`).

## Opening Pull Requests

- Link the associated Taskplain task or GitHub issue in the PR description.
- Summarize validation steps (commands run, test suites, manual QA).
- Include screenshots or terminal output for UX-affecting changes when helpful.
- Keep your branch up to date with `main` to avoid large merge conflicts.

## Publishing Releases

Releases are published to npm by maintainers:

1. Ensure `pnpm run prepublishOnly` passes.
2. Update `docs/changelog.md` and other public docs as needed.
3. Bump the version in `package.json` and regenerate the bundle.
4. Run `pnpm pack --json` to inspect the tarball contents.
5. Publish with `pnpm publish`.

## Reporting Issues

Please use GitHub issues for bugs or feature requests. Security-sensitive reports should follow the process in `SECURITY.md`.

We appreciate your time and contributions—thanks for helping make Taskplain better!
