# Changelog

All notable changes to the Taskplain CLI will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [0.2.0] - 2025-11-04

### Added

- Added `taskplain metadata get` and `taskplain metadata set` commands so agents can dump canonical metadata snapshots and apply JSON patches (with `null` values unsetting optional fields) without chaining multiple `taskplain update` calls.
- Execution telemetry schema for tracking agent performance and runtime metrics. Orchestration systems can now record execution attempts (duration, model used, status) in task frontmatter, enabling data-driven analysis of which models work best for different task types. This creates a feedback loop where consumers can query historical performance data and optimize agent-to-task routing strategies. The `execution` field is optional and doesn't block task completion.
- Added `taskplain stats` command that summarizes execution telemetry, surfacing retry rates, wall-clock trends, and executor usage in human or JSON formats.
- Added `commit_message` frontmatter field for tasks, enforced when `state: done`, enabling automations to run `yq -r '.commit_message'` to author commits deterministically.
- CLI and web flows now skip unreadable or schema-invalid task files, surfacing structured `parse_failed`/`read_failed` warnings instead of aborting the command.
- Added `--check-acs` flag to `taskplain complete` so agents can automatically mark remaining acceptance criteria checkboxes before completion.
- Task board modal now refreshes automatically when idle and shows an in-modal banner to review remote updates while editing, avoiding stale views without overwriting work-in-progress.

### Changed

- Validation now emits a warning (not a failure) when in-progress tasks have every acceptance criteria checkbox checked, guiding agents to either complete the task or uncheck work still in flight while keeping CI green.
- `taskplain --version` labels repository builds with a `dev (based on <version>)` suffix so local builds are distinguishable from published packages.
- Streamlined the Post-Implementation Insights template to a lightweight heading scaffold and documented the ≤10 line Technical Changes summary requirement.
- Agent handbook and docs now cover the new metadata helpers and completion flow so teams can copy the recommended commands.

### Fixed

- Kept `commit_message` serialization on a single YAML line so Conventional Commit subjects remain intact when read from frontmatter.
- `taskplain update` now strips duplicate section headings from snippets and emits a warning instead of corrupting task files.
- Long fenced code blocks inside the task modal scroll in-place without stretching the modal or introducing page-level overflow.

## [0.1.0] - Initial Release

### Added

- Baseline CLI with validation, update, move, and complete commands.
- Task schema (YAML + Markdown) and deterministic state transitions.
- Hierarchy (epic → story → task) with parent-owned children arrays.
- Agent workflow commands: next, pickup, and cleanup.
- Web board with live open-state view.
- Documentation generator (describe + inject).
- Validation and automatic fix for schema drift.

### Summary

First public release providing a complete, repo-native task system for humans and agents.
