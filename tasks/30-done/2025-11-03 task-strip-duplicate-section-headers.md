---
id: strip-duplicate-section-headers
title: Strip duplicate section headers
kind: task
state: done
commit_message: "fix(update): strip duplicate section
  headings  [Task:strip-duplicate-section-headers]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/services/taskService.ts
  - tests/taskService.test.ts
created_at: 2025-11-03T09:10:39.282Z
updated_at: 2025-11-03T10:08:14.861Z
completed_at: 2025-11-03T10:08:14.861Z
links: []
last_activity_at: 2025-11-03T10:08:14.861Z
---

## Overview

Ensure `taskplain update --field` gracefully handles inputs that accidentally repeat the section heading, preventing duplicated headers and downstream validation failures.

## Acceptance Criteria

- [x] When a section update includes its own heading on the first line, the CLI strips it before writing the Markdown.
- [x] The tool emits a warning (or helpful notice) informing the user that the heading was removed.
- [x] Existing behaviour is unchanged when the snippet omits the heading.
- [x] Unit tests cover both the stripping and non-stripping paths.

## Technical Approach

- Update the CLI section writer to detect leading Markdown headings matching the target section name and remove them.
- Add warning/log output to guide agents toward best practices.
- Extend existing tests for `taskplain update` to exercise the new sanitization path.

## Post-Implementation Insights

### Changelog

- Fixed section updates to strip duplicate headings and emit a helpful warning so task files stay valid.

### Decisions

- Reused TaskService warnings pipeline to surface duplicate heading removals instead of inventing a new channel.

### Architecture

- No architecture changes required.
