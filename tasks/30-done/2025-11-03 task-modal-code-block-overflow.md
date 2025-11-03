---
id: modal-code-block-overflow
title: Modal code block overflow
kind: task
state: done
commit_message: "fix(board): contain modal code overflow  [Task:modal-code-block-overflow]"
priority: normal
size: small
ambiguity: low
executor: standard
isolation: module
touches:
  - src/resources/web/board.css
  - src/resources/web/board.js
  - src/resources/web/board.html
created_at: 2025-11-03T05:36:30.502Z
updated_at: 2025-11-03T08:03:48.681Z
completed_at: 2025-11-03T08:03:48.681Z
links: []
last_activity_at: 2025-11-03T08:03:48.681Z
execution:
  attempts:
    - started_at: 2025-11-03T07:57:24.257Z
      ended_at: 2025-11-03T08:03:48.969Z
      duration_seconds: 384
      status: completed
      executor:
        tool: agent-driver
        model: gpt-5-codex
      isolation:
        worktree: false
---

## Overview

Long, unwrapped code samples inside the task modal currently force the `.modal-content` container to stretch beyond its intended width/height, which hides parts of the metadata column and footer actions. Agents using the web board to review CLI output or stack traces cannot read or interact with the modal once the body overflows. We need to keep the modal dimensions fixed and push overflow handling down into the rendered code blocks so the surrounding UI stays readable. Success means pasting the sample CLI log from the attached screenshot (or any fenced block with 150+ character lines) keeps the modal at `calc(100vh - 6rem)`, introduces only an inner scrollbar on the snippet, and avoids horizontal scrolling on the page body.

## Acceptance Criteria

- [x] Viewing a task whose body contains a fenced code block with lines ≥160 characters keeps `#task-modal .modal-content` within the viewport; the code block gains an internal horizontal scrollbar instead of widening the modal or page body.
- [x] When a code block is taller than the modal, `.body-preview` continues to scroll internally and the modal header/footer remain visible; `document.body` never gains a horizontal scrollbar while the modal is open.
- [x] `pnpm run lint` and `pnpm run build` succeed after the styling/script changes.

## Technical Approach

- **Changes**: Tighten `.body-preview pre` / `.body-preview code` styles in `src/resources/web/board.css` with `max-width: 100%`, `max-height` tied to available space, `overflow: auto`, and `word-break` helpers so long tokens wrap/scroll without escaping the modal gutters.
- **Changes**: Ensure rendered Markdown adds a wrapper class for code fences (via `renderBody` in `src/resources/web/board.js`) when needed so CSS hooks can differentiate inline vs block code; confirm edit toggle keeps markup intact.
- **Integration**: Manually verify in Chrome and Safari at 1280×800 that both preview and edit modes honor the limits, and that copying/pasting from the body editor still preserves code fencing.
- **Unknowns**: Confirm whether the modal height should reserve space for acceptance criteria checkboxes when the body scrollbar is active; adjust layout math if nested scrollbars fight.
- **Considerations**: Retain accessible contrast and keyboard scroll behavior (e.g., focusable code panes when overflowed) while avoiding layout shifts for existing markdown content.

## Post-Implementation Insights

### Changelog

- Fixed the task modal so long fenced code snippets scroll inside a dedicated pane without stretching the modal or introducing page-level overflow.

### Decisions

- Added `.body-code-block` / `.body-code-block__code` classes while sanitizing markdown to isolate block code styles from inline code and keep the new overflow rules maintainable.
