((root, factory) => {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.TaskplainDiff = factory();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this,
  () => {
    const prettyState = (value) => {
      if (!value) return "unknown";
      switch (value) {
        case "idea":
          return "Idea";
        case "ready":
          return "Ready";
        case "in-progress":
          return "In Progress";
        case "done":
          return "Done";
        case "canceled":
          return "Canceled";
        default:
          return value;
      }
    };

    const prettyKind = (value) => {
      if (!value) return "Task";
      return value.charAt(0).toUpperCase() + value.slice(1);
    };

    const acceptanceSummary = (acceptance) => {
      if (!acceptance) return "0/0 acceptance criteria";
      return `${acceptance.completed}/${acceptance.total} acceptance criteria`;
    };

    const summarizeBreakdown = (breakdown) => {
      if (!breakdown) return "";
      const parts = [];
      for (const [state, count] of Object.entries(breakdown)) {
        if (!count) continue;
        parts.push(`${count} ${prettyState(state)}`);
      }
      return parts.length > 0 ? parts.join(", ") : "No children";
    };

    const normalizeFamily = (input) => {
      if (!input) {
        return {
          parentId: null,
          parentTitle: null,
          childCount: 0,
          breakdown: {},
        };
      }
      return {
        parentId: input.parent ? input.parent.id : null,
        parentTitle: input.parent ? input.parent.title : null,
        childCount: typeof input.child_count === "number" ? input.child_count : 0,
        breakdown: input.breakdown ?? {},
      };
    };

    function diffTaskDetails(previous, next) {
      if (!previous || !next || previous.id !== next.id) {
        return { changedFields: [], messages: [] };
      }
      const changedFields = [];
      const messages = [];

      const add = (field, message) => {
        changedFields.push(field);
        messages.push(message);
      };

      if ((previous.title || "") !== (next.title || "")) {
        add("title", `Title changed to '${next.title || "Untitled"}'.`);
      }
      if ((previous.kind || "") !== (next.kind || "")) {
        add("kind", `Kind switched to ${prettyKind(next.kind)}.`);
      }
      if ((previous.state || "") !== (next.state || "")) {
        add("state", `State moved to ${prettyState(next.state)}.`);
      }
      if ((previous.priority || "") !== (next.priority || "")) {
        add("priority", `Priority set to ${next.priority || "normal"}.`);
      }
      if ((previous.size || "") !== (next.size || "")) {
        add("size", `Size set to ${next.size || "medium"}.`);
      }
      if ((previous.ambiguity || "") !== (next.ambiguity || "")) {
        add("ambiguity", `Ambiguity set to ${next.ambiguity || "medium"}.`);
      }
      if ((previous.executor || "") !== (next.executor || "")) {
        add("executor", `Executor set to ${next.executor || "standard"}.`);
      }
      if ((previous.blocked || "") !== (next.blocked || "")) {
        if (next.blocked) {
          add("blocked", `Task blocked: ${next.blocked}.`);
        } else {
          add("blocked", "Task unblocked.");
        }
      }
      if ((previous.body || "") !== (next.body || "")) {
        add("body", "Body content updated.");
      }
      const prevAcceptance = previous.acceptance || null;
      const nextAcceptance = next.acceptance || null;
      if (
        (prevAcceptance?.completed ?? null) !== (nextAcceptance?.completed ?? null) ||
        (prevAcceptance?.total ?? null) !== (nextAcceptance?.total ?? null)
      ) {
        add("acceptance", `Acceptance now ${acceptanceSummary(nextAcceptance)}.`);
      }

      if ((previous.descendant_count ?? null) !== (next.descendant_count ?? null)) {
        add("descendants", `Descendant count is ${next.descendant_count ?? 0}.`);
      }

      const prevFamily = normalizeFamily(previous.family);
      const nextFamily = normalizeFamily(next.family);
      if (prevFamily.parentId !== nextFamily.parentId) {
        if (nextFamily.parentId) {
          add("parent", `Parent set to '${nextFamily.parentTitle || nextFamily.parentId}'.`);
        } else {
          add("parent", "Parent removed.");
        }
      }
      if (prevFamily.childCount !== nextFamily.childCount) {
        add(
          "children",
          `Children summary now ${nextFamily.childCount} (${summarizeBreakdown(nextFamily.breakdown)}).`,
        );
      } else if (JSON.stringify(prevFamily.breakdown) !== JSON.stringify(nextFamily.breakdown)) {
        add("children", `Children breakdown updated: ${summarizeBreakdown(nextFamily.breakdown)}.`);
      }

      return { changedFields, messages };
    }

    return {
      diffTaskDetails,
    };
  },
);
