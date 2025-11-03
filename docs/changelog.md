# Changelog

All notable changes to the Taskplain CLI will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `taskplain metadata get` and `taskplain metadata set` commands so agents can dump canonical metadata snapshots and apply JSON patches (with `null` values unsetting optional fields) without chaining multiple `taskplain update` calls.
- Execution telemetry schema for tracking agent performance and runtime metrics. Orchestration systems can now record execution attempts (duration, model used, status) in task frontmatter, enabling data-driven analysis of which models work best for different task types. This creates a feedback loop where consumers can query historical performance data and optimize agent-to-task routing strategies. The `execution` field is optional and doesn't block task completion.
- Added `commit_message` frontmatter field for tasks, enforced when `state: done`, enabling automations to run `yq -r '.commit_message'` to author commits deterministically.
- CLI and web flows now skip unreadable or schema-invalid task files, surfacing structured `parse_failed`/`read_failed` warnings instead of aborting the command.

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
