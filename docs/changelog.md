# Changelog

All notable changes to the Taskplain CLI will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
