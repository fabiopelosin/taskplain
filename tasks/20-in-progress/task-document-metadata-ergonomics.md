---
id: document-metadata-ergonomics
title: Document metadata ergonomics
kind: task
state: in-progress
commit_message: "docs(handbook): document metadata
  helpers  [Task:document-metadata-ergonomics]"
priority: normal
size: medium
ambiguity: low
executor: standard
isolation: module
touches:
  - src/docsources/handbook-snippet.md
  - AGENTS.md
depends_on:
  - implement-metadata-cli-helpers
  - auto-check-acs-on-complete
created_at: 2025-11-03T07:40:28.329Z
updated_at: 2025-11-03T08:50:10.412Z
completed_at: null
links: []
last_activity_at: 2025-11-03T08:50:10.412Z
---

## Overview

Refresh the agents handbook template so it demonstrates the new metadata JSON helpers and the `--check-acs` completion flag, giving agents copy-paste examples for the improved workflow.

## Acceptance Criteria

- [ ] Handbook template shows an example of `taskplain metadata get <id> --output json` with representative output.
- [ ] Handbook template shows how to pipe partial JSON into `taskplain metadata set <id>` to change one field.
- [ ] Handbook template documents the `taskplain complete --check-acs` flag and clarifies when to use it.
- [ ] Changes stay within the handbook template section; no unrelated documentation churn.

## Technical Approach

- Update the agents handbook template after the CLI subtasks finalize command names and examples.
- Use concise fenced blocks for the new commands, mirroring existing formatting conventions.
- Run `taskplain validate` to ensure the template still meets schema expectations.

## Post-Implementation Insights

### Changelog

- Added metadata helper walkthrough and `--check-acs` guidance to the agent handbook template so agents can streamline task metadata edits and wrap-ups.

### Decisions

- Documented jq-based partial updates because they keep changes deterministic and copyable from the handbook snippet.

### Architecture

- None.
