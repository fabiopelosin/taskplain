---
id: report-dev-build-version-when-running-from-repo
title: Report dev build version when running from repo
kind: task
state: done
commit_message: "chore(cli): report dev build version when running from repo [Task:local-version]"
priority: normal
size: small
ambiguity: low
executor: standard
isolation: module
touches:
  - src/cli.ts
created_at: 2025-10-30T18:32:47.631Z
updated_at: 2025-10-30T18:34:21.095Z
completed_at: 2025-10-30T18:35:28.000Z
links: []
last_activity_at: 2025-10-30T18:34:21.095Z
---

## Overview

Ensure developers can distinguish a locally linked CLI build from the released package by printing a “dev” suffix while working inside the repository.

## Acceptance Criteria

- [x] `taskplain --version` reports `dev (based on <version>)` when executed from the repo build.
- [x] `taskplain --version` continues to output the published semver when installed normally.
- [x] `pnpm run build` succeeds after the change.

## Technical Approach

- Import `package.json` inside `src/cli.ts` to reuse the published version string.
- Detect repository execution by checking for `.git` and `package.json` alongside the built CLI.
- Pass the dynamic version string into `commander`’s `.version()` call.

## Post-Implementation Insights

### Changelog

- Changed CLI version output to show `dev (based on <version>)` when running from a locally linked build.

### Decisions

- Reused existing build artifacts rather than introducing environment variables.

### Architecture

- No architectural impact; confined to CLI bootstrap logic.
