(() => {
  const STATE_ORDER = ["idea", "ready", "in-progress", "done", "canceled"];
  const TERMINAL_STATES = ["done", "canceled"];
  const DEFAULT_VISIBLE = new Set(["idea", "ready", "in-progress"]);
  const SESSION_KEY = "taskplain-board-visible";

  const STATE_LABELS = {
    idea: "Idea",
    ready: "Ready",
    "in-progress": "In Progress",
    done: "Done",
    canceled: "Canceled",
  };
  const PARENT_SESSION_KEY = "taskplain-parent-expanded";
  const CHILD_KIND_MAP = {
    epic: ["story"],
    story: ["task"],
  };

  const boardEl = document.getElementById("board");
  const statusEl = document.getElementById("connection-status");
  const activityEl = document.getElementById("activity-status");
  const updatedEl = document.getElementById("last-updated");
  const togglesEl = document.getElementById("state-toggles");

  const modalBackdrop = document.getElementById("modal-backdrop");
  const modalEl = document.getElementById("task-modal");
  const modalTitle = document.getElementById("task-modal-title");
  const modalForm = document.getElementById("task-modal-form");
  const modalStatus = document.getElementById("modal-status");
  const fieldTitle = document.getElementById("field-title");
  const fieldPriority = document.getElementById("field-priority");
  const fieldSize = document.getElementById("field-size");
  const fieldAmbiguity = document.getElementById("field-ambiguity");
  const fieldExecutor = document.getElementById("field-executor");
  const fieldState = document.getElementById("field-state");
  // Blocked text field removed; toggled via button
  const blockToggleButton = document.getElementById("modal-block-toggle");
  const fieldBody = document.getElementById("field-body-preview");
  const fieldBodyEdit = document.getElementById("field-body-edit");
  const fieldId = document.getElementById("field-id");
  const fieldKind = document.getElementById("field-kind");
  const saveButton = document.getElementById("modal-save");
  const cancelButton = document.getElementById("modal-cancel");
  const closeButton = document.getElementById("modal-close");
  const newChildButton = document.getElementById("open-child-modal");
  const deleteButton = document.getElementById("modal-delete");
  const completeButton = document.getElementById("modal-complete");
  const openBodyButton = document.getElementById("open-body-editor");
  const editToggleButton = document.getElementById("modal-edit-toggle");
  const copyTaskIdButton = document.getElementById("copy-task-id");
  const bodyModal = document.getElementById("body-modal");
  const bodyModalTitle = document.getElementById("body-modal-title");
  const bodyModalId = document.getElementById("body-modal-id");
  const bodyEditorInput = document.getElementById("body-editor-input");
  const bodyModalStatus = document.getElementById("body-modal-status");
  const bodyModalSave = document.getElementById("body-modal-save");
  const bodyModalCancel = document.getElementById("body-modal-cancel");
  const deleteModal = document.getElementById("delete-modal");
  const deleteModalMessage = document.getElementById("delete-modal-message");
  const deleteModalConfirm = document.getElementById("delete-modal-confirm");
  const deleteModalCancel = document.getElementById("delete-modal-cancel");
  const deleteModalStatus = document.getElementById("delete-modal-status");
  const blockModal = document.getElementById("block-modal");
  const blockModalForm = document.getElementById("block-modal-form");
  const blockReasonInput = document.getElementById("block-reason");
  const blockModalCancel = document.getElementById("block-modal-cancel");
  const blockModalConfirm = document.getElementById("block-modal-confirm");
  const blockModalStatus = document.getElementById("block-modal-status");
  const commitModal = document.getElementById("commit-modal");
  const commitModalForm = document.getElementById("commit-modal-form");
  const commitModalTitle = document.getElementById("commit-modal-title");
  const commitMessageInput = document.getElementById("commit-message-input");
  const commitModalStatus = document.getElementById("commit-modal-status");
  const commitModalCancel = document.getElementById("commit-modal-cancel");
  const commitModalSave = document.getElementById("commit-modal-save");
  const childModal = document.getElementById("child-modal");
  const childModalTitle = document.getElementById("child-modal-title");
  const childModalParent = document.getElementById("child-modal-parent");
  const childModalForm = document.getElementById("child-modal-form");
  const childModalStatus = document.getElementById("child-modal-status");
  const childModalCancel = document.getElementById("child-modal-cancel");
  const childModalSave = document.getElementById("child-modal-save");
  const childTitleInput = document.getElementById("child-title");
  const childKindSelect = document.getElementById("child-kind");
  const childPrioritySelect = document.getElementById("child-priority");
  const notificationRegion = document.getElementById("notification-region");
  const modalUpdateBanner = document.getElementById("modal-update-banner");
  const modalUpdateMessage = document.getElementById("modal-update-message");
  const modalUpdateReviewButton = document.getElementById("modal-update-review");
  const modalUpdateApplyButton = document.getElementById("modal-update-apply");
  const modalUpdateDetail = document.getElementById("modal-update-detail");
  const modalUpdateList = document.getElementById("modal-update-list");
  const diffHelpers = window.TaskplainDiff || {};
  const _diffTaskDetails =
    typeof diffHelpers.diffTaskDetails === "function"
      ? diffHelpers.diffTaskDetails
      : () => ({ changedFields: [], messages: [] });
  const MODAL_FIELD_LABELS = {
    title: "Title",
    kind: "Kind",
    state: "State",
    priority: "Priority",
    size: "Size",
    ambiguity: "Ambiguity",
    executor: "Executor",
    blocked: "Blocked",
    body: "Body",
    acceptance: "Acceptance",
    descendants: "Descendants",
    parent: "Parent",
    children: "Children",
  };
  const notifications = [];
  let notificationCounter = 1;

  if (window.marked && typeof window.marked.setOptions === "function") {
    window.marked.setOptions({
      gfm: true,
      breaks: false,
      mangle: false,
      headerIds: false,
    });
  }

  const visibleStates = loadVisibility();
  let currentSnapshot = null;
  let dragTaskId = null;
  let dragOriginState = null;
  let modalTaskId = null;
  let modalMode = "edit";
  let modalViewMode = "view";
  let modalCreateState = "idea";
  let isSaving = false;
  let isCompleting = false;
  let isBodySaving = false;
  const taskDetailsCache = new Map();
  let previousDoneTaskIds = new Set();
  let hasRenderedSnapshot = false;
  let commitModalTaskId = null;
  let commitModalDetail = null;
  let commitModalSource = null;
  let isSavingCommitMessage = false;
  let bodyEditorDetail = null;
  let childModalParentDetail = null;
  const expandedParents = loadExpandedParents();
  let _modalDirty = false;
  let modalBaselineDetail = null;
  let _modalPendingDiff = null;
  let modalPendingRemoteUpdatedAt = null;
  let modalRefreshInFlight = false;
  let modalRefreshQueued = false;
  let modalRefreshTargetUpdatedAt = null;
  let modalLastSeenUpdatedAt = null;
  let pollingIntervalId = null;
  const POLLING_INTERVAL_MS = 5000;

  renderControls();
  loadInitial();
  connectWebSocket();

  if (modalUpdateReviewButton) {
    modalUpdateReviewButton.addEventListener("click", toggleModalUpdateDetail);
  }

  if (fieldTitle) {
    fieldTitle.addEventListener("input", markModalDirty);
  }
  if (fieldBodyEdit) {
    fieldBodyEdit.addEventListener("input", markModalDirty);
  }

  [fieldPriority, fieldSize, fieldAmbiguity, fieldExecutor, fieldKind].forEach((select) => {
    if (select) {
      select.addEventListener("change", markModalDirty);
    }
  });

  modalForm.addEventListener("change", (event) => {
    if (modalViewMode !== "edit") {
      return;
    }
    const target = event.target;
    if (
      target === fieldPriority ||
      target === fieldSize ||
      target === fieldAmbiguity ||
      target === fieldExecutor ||
      target === fieldKind
    ) {
      markModalDirty();
    }
  });

  cancelButton.addEventListener("click", async () => {
    if (modalViewMode === "edit") {
      // Discard changes: reload latest task details and switch back to view
      if (modalTaskId) {
        try {
          const detail = await fetchTaskDetails(modalTaskId);
          populateModal(detail);
        } catch (_e) {
          // best-effort; keep existing values if reload fails
        }
      }
      setModalViewMode("view");
      return;
    }
    closeModal();
  });
  if (closeButton) {
    closeButton.addEventListener("click", closeModal);
  }
  if (blockToggleButton) {
    blockToggleButton.addEventListener("click", () => {
      if (!modalTaskId) return;
      toggleBlock(modalTaskId);
    });
  }
  if (blockModalCancel) {
    blockModalCancel.addEventListener("click", closeBlockModal);
  }
  if (blockModal) {
    blockModal.addEventListener("click", (event) => {
      if (event.target === blockModal) {
        closeBlockModal();
      }
    });
  }
  if (blockModalForm) {
    blockModalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const reason = blockReasonInput.value.trim();
      if (!reason) {
        blockModalStatus.textContent = "Please enter a reason";
        blockReasonInput.focus();
        return;
      }
      confirmBlock(reason);
    });
  }
  if (commitModalCancel) {
    commitModalCancel.addEventListener("click", () => {
      closeCommitModal("cancel");
    });
  }
  if (commitModal) {
    commitModal.addEventListener("click", (event) => {
      if (event.target === commitModal) {
        closeCommitModal("cancel");
      }
    });
  }
  if (commitModalForm) {
    commitModalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void handleCommitModalSubmit();
    });
  }
  modalBackdrop.addEventListener("click", closeModal);
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
      closeModal();
    }
  });
  if (editToggleButton) {
    editToggleButton.addEventListener("click", () => {
      toggleModalViewMode();
    });
  }
  if (copyTaskIdButton) {
    copyTaskIdButton.addEventListener("click", () => {
      if (modalTaskId) {
        copyToClipboard(modalTaskId);
      }
    });
  }
  if (openBodyButton) {
    openBodyButton.addEventListener("click", () => {
      if (!modalTaskId || modalMode === "create") {
        return;
      }
      openBodyEditor(modalTaskId);
    });
  }
  bodyModalCancel.addEventListener("click", closeBodyEditor);
  bodyModal.addEventListener("click", (event) => {
    if (event.target === bodyModal) {
      closeBodyEditor();
    }
  });
  bodyModalSave.addEventListener("click", () => {
    if (!modalTaskId || isBodySaving) {
      return;
    }
    saveBodyChanges(modalTaskId);
  });
  if (newChildButton) {
    newChildButton.addEventListener("click", () => {
      if (!bodyEditorDetail || !modalTaskId) {
        return;
      }
      openChildModal(bodyEditorDetail);
    });
  }
  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      if (!modalTaskId) {
        return;
      }
      openDeleteModal(modalTaskId);
    });
  }
  if (completeButton) {
    completeButton.addEventListener("click", () => {
      if (!modalTaskId || isCompleting) {
        return;
      }
      completeCurrentTask(modalTaskId);
    });
  }
  deleteModalCancel.addEventListener("click", closeDeleteModal);
  deleteModal.addEventListener("click", (event) => {
    if (event.target === deleteModal) {
      closeDeleteModal();
    }
  });
  deleteModalConfirm.addEventListener("click", () => {
    if (!modalTaskId) {
      return;
    }
    performDelete(modalTaskId);
  });
  if (
    childModal &&
    childModalCancel &&
    childModalForm &&
    childModalSave &&
    childModalStatus &&
    childTitleInput &&
    childKindSelect &&
    childPrioritySelect
  ) {
    childModalCancel.addEventListener("click", closeChildModal);
    childModal.addEventListener("click", (event) => {
      if (event.target === childModal) {
        closeChildModal();
      }
    });
    childModalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const isTopLevel = childModal.dataset.isTopLevel === "true";
      if (!isTopLevel && !childModalParentDetail) {
        return;
      }
      createChildTask();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (bodyModal.classList.contains("active")) {
        closeBodyEditor();
        return;
      }
      if (blockModal.classList.contains("active")) {
        closeBlockModal();
        return;
      }
      if (childModal.classList.contains("active")) {
        closeChildModal();
        return;
      }
      if (deleteModal.classList.contains("active")) {
        closeDeleteModal();
        return;
      }
      if (modalEl.classList.contains("active")) {
        closeModal();
      }
    }
  });

  modalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    if (modalMode === "create") {
      createTask();
      return;
    }
    if (!modalTaskId) {
      return;
    }
    saveTaskChanges(modalTaskId);
  });

  async function loadInitial() {
    setConnectionStatus("Loading…", "warn");
    try {
      const response = await fetch("/api/tasks");
      if (!response.ok) {
        throw new Error("Failed to load tasks");
      }
      const payload = await response.json();
      renderBoard(payload);
      applyProjectName(payload.project_name);
      setConnectionStatus("Live", "ok");
    } catch (error) {
      setConnectionStatus(error.message || "Failed to load", "error");
    }
  }

  function connectWebSocket() {
    const wsUrl = new URL("/ws", window.location.href);
    wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(wsUrl.toString());

    socket.addEventListener("open", () => {
      setConnectionStatus("Live", "ok");
      stopPollingFallback();
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.type === "tasks/snapshot" && payload.payload) {
          renderBoard(payload.payload);
          applyProjectName(payload.payload.project_name);
        }
      } catch (error) {
        console.error("Failed to parse websocket payload", error);
      }
    });

    socket.addEventListener("close", () => {
      setConnectionStatus("Reconnecting…", "warn");
      startPollingFallback();
      setTimeout(connectWebSocket, 1500);
    });

    socket.addEventListener("error", (error) => {
      console.error("WebSocket error", error);
      setConnectionStatus("WebSocket error", "error");
      startPollingFallback();
    });
  }

  function loadVisibility() {
    const states = new Set(DEFAULT_VISIBLE);
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((state) => {
            if (TERMINAL_STATES.indexOf(state) !== -1) {
              states.add(state);
            }
          });
        }
      }
    } catch (error) {
      console.warn("Failed to load visibility preferences", error);
    }
    return states;
  }

  function persistVisibility() {
    try {
      const stored = [];
      TERMINAL_STATES.forEach((state) => {
        if (visibleStates.has(state)) {
          stored.push(state);
        }
      });
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    } catch (error) {
      console.warn("Failed to persist visibility preferences", error);
    }
  }

  function renderControls() {
    togglesEl.querySelectorAll("label.toggle").forEach((node) => {
      node.remove();
    });
    TERMINAL_STATES.forEach((state) => {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = visibleStates.has(state);
      input.dataset.state = state;
      input.addEventListener("change", () => {
        if (input.checked) {
          visibleStates.add(state);
        } else {
          visibleStates.delete(state);
        }
        persistVisibility();
        if (currentSnapshot) {
          renderBoard(currentSnapshot);
        }
      });
      const text = document.createElement("span");
      text.textContent = `Show ${STATE_LABELS[state]}`;
      label.appendChild(input);
      label.appendChild(text);
      togglesEl.appendChild(label);
    });
  }

  function renderBoard(snapshot) {
    const nextDoneTasks = collectDoneTaskIds(snapshot);
    if (hasRenderedSnapshot) {
      let newlyCompletedCount = 0;
      nextDoneTasks.forEach((id) => {
        if (!previousDoneTaskIds.has(id)) {
          // Notify per newly completed task with a sticky success toast
          try {
            notifyTaskMove(id, "done", snapshot);
          } catch (_err) {
            // best-effort: never block rendering on notification errors
          }
          newlyCompletedCount += 1;
        }
      });
      if (newlyCompletedCount > 0) {
        launchConfetti(newlyCompletedCount);
      }
    }
    previousDoneTaskIds = nextDoneTasks;
    currentSnapshot = snapshot;
    hasRenderedSnapshot = true;
    taskDetailsCache.clear();
    handleModalSync(snapshot);
    if (snapshot?.generated_at) {
      updatedEl.textContent = `Updated ${formatTimestamp(snapshot.generated_at)}`;
    } else {
      updatedEl.textContent = "";
    }

    boardEl.innerHTML = "";
    let hasVisibleColumn = false;

    STATE_ORDER.forEach((state) => {
      if (!visibleStates.has(state)) {
        return;
      }
      hasVisibleColumn = true;
      const column = buildColumn(state, snapshot.columns?.[state] ? snapshot.columns[state] : []);
      boardEl.appendChild(column);
    });

    if (!hasVisibleColumn) {
      const empty = document.createElement("div");
      empty.className = "empty-board";
      empty.textContent = "All hidden — enable columns above.";
      boardEl.appendChild(empty);
    }
    persistExpandedParents();
  }

  function handleModalSync(snapshot) {
    if (!modalTaskId || !modalEl.classList.contains("active")) {
      _modalPendingDiff = null;
      modalPendingRemoteUpdatedAt = null;
      return;
    }
    const node = findTaskInSnapshot(snapshot, modalTaskId);
    if (!node) {
      handleModalTaskDeleted(modalTaskId);
      return;
    }

    const nodeUpdatedAt = node.updated_at || null;
    const baseline =
      modalBaselineDetail && modalBaselineDetail.id === node.id ? modalBaselineDetail : null;
    const hasSnapshotDiff = baseline ? modalSnapshotDiffersFromBaseline(node, baseline) : true;

    if (nodeUpdatedAt && modalLastSeenUpdatedAt && nodeUpdatedAt === modalLastSeenUpdatedAt) {
      if (!hasSnapshotDiff) {
        return;
      }
    } else if (!nodeUpdatedAt && !hasSnapshotDiff) {
      return;
    }

    scheduleModalDetailRefresh(nodeUpdatedAt);
  }

  function modalSnapshotDiffersFromBaseline(node, baseline) {
    if (!baseline || baseline.id !== node.id) {
      return true;
    }

    const compareText = (value) => (value === undefined || value === null ? "" : String(value));
    if (compareText(baseline.title) !== compareText(node.title)) {
      return true;
    }
    if (compareText(baseline.kind) !== compareText(node.kind)) {
      return true;
    }
    if (compareText(baseline.state) !== compareText(node.state)) {
      return true;
    }
    if (compareText(baseline.priority) !== compareText(node.priority)) {
      return true;
    }

    const baselineBlocked = compareText(baseline.blocked);
    const nodeBlocked = compareText(node.blocked);
    if (baselineBlocked !== nodeBlocked) {
      return true;
    }

    const baselineAcceptance = baseline.acceptance || null;
    const nodeAcceptance = node.acceptance || null;
    const baselineAcceptanceCompleted =
      baselineAcceptance && typeof baselineAcceptance.completed === "number"
        ? baselineAcceptance.completed
        : null;
    const nodeAcceptanceCompleted =
      nodeAcceptance && typeof nodeAcceptance.completed === "number"
        ? nodeAcceptance.completed
        : null;
    const baselineAcceptanceTotal =
      baselineAcceptance && typeof baselineAcceptance.total === "number"
        ? baselineAcceptance.total
        : null;
    const nodeAcceptanceTotal =
      nodeAcceptance && typeof nodeAcceptance.total === "number" ? nodeAcceptance.total : null;
    if (
      baselineAcceptanceCompleted !== nodeAcceptanceCompleted ||
      baselineAcceptanceTotal !== nodeAcceptanceTotal
    ) {
      return true;
    }

    const baselineFamily = baseline.family || null;
    const nodeFamily = node.family || null;
    if (!!baselineFamily !== !!nodeFamily) {
      return true;
    }
    if (baselineFamily && nodeFamily) {
      const baselineParentId = baselineFamily.parent ? baselineFamily.parent.id : null;
      const nodeParentId = nodeFamily.parent ? nodeFamily.parent.id : null;
      if (baselineParentId !== nodeParentId) {
        return true;
      }
      const baselineChildCount =
        typeof baselineFamily.child_count === "number" ? baselineFamily.child_count : null;
      const nodeChildCount =
        typeof nodeFamily.child_count === "number" ? nodeFamily.child_count : null;
      if (baselineChildCount !== nodeChildCount) {
        return true;
      }
      const baselineBreakdown = baselineFamily.breakdown || {};
      const nodeBreakdown = nodeFamily.breakdown || {};
      if (JSON.stringify(baselineBreakdown) !== JSON.stringify(nodeBreakdown)) {
        return true;
      }
    }

    return false;
  }

  function scheduleModalDetailRefresh(updatedAt) {
    if (!modalTaskId) {
      return;
    }
    modalRefreshTargetUpdatedAt = updatedAt;
    if (modalRefreshInFlight) {
      modalRefreshQueued = true;
      return;
    }
    modalRefreshInFlight = true;
    void refreshModalDetail();
  }

  async function refreshModalDetail() {
    if (!modalTaskId) {
      modalRefreshInFlight = false;
      return;
    }
    const target = modalRefreshTargetUpdatedAt;
    try {
      const detail = await fetchTaskDetails(modalTaskId);
      if (!detail) {
        return;
      }
      const detailUpdatedAt = detail.updated_at || null;
      if (target && detailUpdatedAt && target !== detailUpdatedAt) {
        modalRefreshTargetUpdatedAt = detailUpdatedAt;
      }
      applyModalRemoteDetail(detail);
    } catch (error) {
      console.error("Failed to refresh modal detail", error);
    } finally {
      modalRefreshInFlight = false;
      if (modalRefreshQueued) {
        modalRefreshQueued = false;
        scheduleModalDetailRefresh(modalRefreshTargetUpdatedAt);
      }
    }
  }

  function applyModalRemoteDetail(detail) {
    if (!detail) {
      return;
    }
    _modalPendingDiff = null;
    modalPendingRemoteUpdatedAt = detail.updated_at || null;
    hideModalUpdateBanner();
    populateModal(detail);
    setModalViewMode("view");
  }

  function _formatChangedFields(fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return "";
    }
    const readable = fields.map((field) =>
      MODAL_FIELD_LABELS[field] ? MODAL_FIELD_LABELS[field] : field,
    );
    if (readable.length === 1) {
      return readable[0];
    }
    return `${readable.slice(0, -1).join(", ")} and ${readable[readable.length - 1]}`;
  }

  function _showModalUpdateBanner(diff, detail) {
    if (!modalUpdateBanner || !modalUpdateMessage) {
      return;
    }
    const fields = Array.isArray(diff?.changedFields) ? diff.changedFields : [];
    const messages = Array.isArray(diff?.messages) ? diff.messages : [];
    const summary = _formatChangedFields(fields);
    modalUpdateMessage.textContent =
      summary.length > 0
        ? `Task updated externally. Updated fields: ${summary}.`
        : "Task updated externally. Review the latest details.";
    modalUpdateBanner.hidden = false;
    modalUpdateBanner.setAttribute("data-task-id", detail?.id || "");
    if (modalUpdateApplyButton) {
      modalUpdateApplyButton.disabled = false;
    }
    if (modalUpdateReviewButton) {
      const hasDetails = messages.length > 0;
      modalUpdateReviewButton.disabled = !hasDetails;
      modalUpdateReviewButton.setAttribute("aria-expanded", "false");
    }
    if (modalUpdateDetail) {
      modalUpdateDetail.hidden = true;
    }
    if (modalUpdateList) {
      modalUpdateList.innerHTML = "";
      messages.forEach((message) => {
        const item = document.createElement("li");
        item.textContent = message;
        modalUpdateList.appendChild(item);
      });
    }
  }

  function hideModalUpdateBanner() {
    if (!modalUpdateBanner) {
      return;
    }
    modalUpdateBanner.hidden = true;
    modalUpdateBanner.removeAttribute("data-task-id");
    if (modalUpdateReviewButton) {
      modalUpdateReviewButton.setAttribute("aria-expanded", "false");
      modalUpdateReviewButton.disabled = false;
    }
    if (modalUpdateDetail) {
      modalUpdateDetail.hidden = true;
    }
    if (modalUpdateList) {
      modalUpdateList.innerHTML = "";
    }
  }

  function toggleModalUpdateDetail() {
    if (!modalUpdateDetail || !modalUpdateReviewButton || modalUpdateReviewButton.disabled) {
      return;
    }
    const expanded = modalUpdateReviewButton.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    modalUpdateReviewButton.setAttribute("aria-expanded", next ? "true" : "false");
    modalUpdateDetail.hidden = !next;
  }

  function markModalDirty() {
    if (modalViewMode !== "edit") {
      return;
    }
    _modalDirty = true;
  }

  function handleModalTaskDeleted(taskId) {
    if (!taskId) {
      return;
    }
    if (modalTaskId !== taskId) {
      return;
    }
    closeModal();
    pushNotification("Task removed while viewing. Modal closed.", "warning", {
      persistent: true,
    });
  }

  async function pollSnapshot() {
    try {
      const response = await fetch("/api/tasks");
      if (!response.ok) {
        throw new Error("Failed to poll tasks");
      }
      const payload = await response.json();
      if (!payload) {
        return;
      }
      if (!currentSnapshot || payload.generated_at !== currentSnapshot.generated_at) {
        renderBoard(payload);
        applyProjectName(payload.project_name);
      }
    } catch (error) {
      console.error("Polling fallback failed", error);
    }
  }

  function startPollingFallback() {
    if (pollingIntervalId !== null) {
      return;
    }
    pollingIntervalId = window.setInterval(pollSnapshot, POLLING_INTERVAL_MS);
    void pollSnapshot();
  }

  function stopPollingFallback() {
    if (pollingIntervalId === null) {
      return;
    }
    window.clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }

  function buildColumn(state, tasks) {
    const column = document.createElement("section");
    column.className = "column";
    column.dataset.state = state;

    const header = document.createElement("div");
    header.className = "column-header";
    const headerInfo = document.createElement("div");
    headerInfo.className = "column-header-info";
    const title = document.createElement("h2");
    title.className = "column-title";
    title.textContent = STATE_LABELS[state] || state;
    const count = document.createElement("span");
    count.className = "column-count";
    count.textContent = String(tasks.length);
    headerInfo.appendChild(title);
    headerInfo.appendChild(count);
    header.appendChild(headerInfo);

    if (!TERMINAL_STATES.includes(state)) {
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "column-add-button";
      addButton.textContent = "+ Add Task";
      addButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCreateModal(state);
      });
      header.appendChild(addButton);
    }

    const content = document.createElement("div");
    content.className = "column-content";
    attachDropZone(content, state);

    if (tasks.length === 0) {
      const emptyState = document.createElement("div");
      emptyState.className = "empty";
      emptyState.textContent = "No tasks";
      content.appendChild(emptyState);
    } else {
      tasks.forEach((task) => {
        const node = buildTaskNode(task, 0);
        content.appendChild(node);
      });
    }

    column.appendChild(header);
    column.appendChild(content);
    return column;
  }

  function buildTaskNode(task, depth) {
    const element = document.createElement(depth === 0 ? "article" : "div");
    element.className = depth === 0 ? "card" : "child";
    element.setAttribute("data-task-id", task.id);
    element.setAttribute("data-task-state", task.state);
    element.draggable = true;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = task.title;
    element.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    const kindBadge = document.createElement("span");
    kindBadge.className = `badge kind-${task.kind}`;
    kindBadge.textContent = task.kind;
    meta.appendChild(kindBadge);

    const priorityBadge = document.createElement("span");
    priorityBadge.className = `badge priority-${task.priority}`;
    priorityBadge.textContent = task.priority;
    meta.appendChild(priorityBadge);

    if (task.blocked) {
      const blockedBadge = document.createElement("span");
      blockedBadge.className = "badge blocked";
      blockedBadge.textContent = "blocked";
      meta.appendChild(blockedBadge);
    }

    const updatedBadge = document.createElement("span");
    updatedBadge.className = "badge";
    updatedBadge.textContent = formatTimestamp(task.updated_at);
    meta.appendChild(updatedBadge);

    element.appendChild(meta);
    if (task.acceptance && task.acceptance.total > 0) {
      element.appendChild(renderAcceptance(task.acceptance));
    }
    if (depth === 0 && task.family?.parent) {
      element.appendChild(renderParentBadge(task.family.parent));
    }
    if (depth === 0 && task.family?.children && task.family.children.length > 0) {
      element.appendChild(renderChildSummary(task, task.family, expandedParents.has(task.id)));
      if (expandedParents.has(task.id)) {
        element.appendChild(renderChildList(task.family.children));
      }
    }
    attachTaskInteractions(element, task.id, task.state);

    if (task.children && task.children.length > 0) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "children";
      task.children.forEach((child) => {
        const childNode = buildTaskNode(child, depth + 1);
        childrenContainer.appendChild(childNode);
      });
      element.appendChild(childrenContainer);
    }

    return element;
  }

  function renderAcceptance(acceptance) {
    const wrapper = document.createElement("div");
    wrapper.className = "ac-progress";
    const label = document.createElement("span");
    label.className = "ac-progress-label";
    const percent = Math.round((acceptance.completed / acceptance.total) * 100);
    label.textContent = `AC ${acceptance.completed}/${acceptance.total} (${percent}%)`;
    wrapper.setAttribute(
      "aria-label",
      `${acceptance.completed} of ${acceptance.total} acceptance criteria completed`,
    );
    const bar = document.createElement("div");
    bar.className = "ac-progress-bar";
    const barInner = document.createElement("div");
    barInner.className = "ac-progress-bar-inner";
    barInner.style.width = `${Math.min(100, percent)}%`;
    bar.appendChild(barInner);
    wrapper.appendChild(label);
    wrapper.appendChild(bar);
    return wrapper;
  }

  function renderParentBadge(parent) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "parent-badge";
    const label = STATE_LABELS[parent.state] || parent.state;
    badge.textContent = `↰ ${parent.title} (${label})`;
    badge.addEventListener("click", (event) => {
      event.stopPropagation();
      scrollTaskIntoView(parent.id);
    });
    return badge;
  }

  function renderChildSummary(task, family, expanded) {
    const summary = document.createElement("div");
    summary.className = "hierarchy-summary";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "hierarchy-toggle";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide children" : "Show children";
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleParentExpansion(task.id);
    });
    const breakdown = document.createElement("span");
    breakdown.className = "hierarchy-breakdown";
    breakdown.textContent = formatBreakdown(family.breakdown, family.child_count);
    summary.appendChild(toggle);
    summary.appendChild(breakdown);
    return summary;
  }

  function renderChildList(children) {
    const container = document.createElement("div");
    container.className = "hierarchy-child-list";
    children.forEach((child) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hierarchy-child";
      const label = STATE_LABELS[child.state] || child.state;
      button.textContent = `[${label}] ${child.title}`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        scrollTaskIntoView(child.id);
      });
      container.appendChild(button);
    });
    return container;
  }

  function formatBreakdown(breakdown, total) {
    const parts = [];
    STATE_ORDER.forEach((state) => {
      const count = breakdown?.[state];
      if (count > 0) {
        parts.push(`${count} ${STATE_LABELS[state] || state}`);
      }
    });
    const detail = parts.length > 0 ? parts.join(", ") : "No children";
    return `Children (${total}): ${detail}`;
  }

  function attachDropZone(target, state) {
    target.addEventListener("dragover", (event) => {
      if (!dragTaskId) {
        return;
      }
      event.preventDefault();
      target.classList.add("drop-target");
    });

    target.addEventListener("dragleave", () => {
      target.classList.remove("drop-target");
    });

    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("drop-target");
      if (!dragTaskId) {
        return;
      }
      const taskId = dragTaskId;
      const origin = dragOriginState;
      dragTaskId = null;
      dragOriginState = null;
      if (origin === state) {
        return;
      }
      if (state === "done") {
        void handleDropCompletion(taskId);
      } else {
        moveTask(taskId, state);
      }
    });
  }

  async function handleDropCompletion(taskId) {
    const detail = await fetchTaskDetails(taskId).catch((error) => {
      const message =
        (error instanceof Error ? error.message : String(error)) || "Failed to prepare completion";
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
      return null;
    });
    if (!detail) {
      return;
    }
    await openCommitModalForTask(taskId, "board", detail);
  }

  function attachTaskInteractions(element, taskId, taskState) {
    let dragging = false;
    element.addEventListener("dragstart", (event) => {
      dragging = true;
      dragTaskId = taskId;
      dragOriginState = taskState;
      element.classList.add("dragging");
      event.dataTransfer.setData("text/plain", taskId);
      event.dataTransfer.effectAllowed = "move";
    });

    element.addEventListener("dragend", () => {
      dragging = false;
      dragTaskId = null;
      dragOriginState = null;
      element.classList.remove("dragging");
    });

    element.addEventListener("click", (event) => {
      if (dragging) {
        event.preventDefault();
        return;
      }
      const target = event.target;
      const container = target?.closest ? target.closest("[data-task-id]") : null;
      const clickedTaskId = container ? container.getAttribute("data-task-id") : null;
      openTaskModal(clickedTaskId || taskId);
      event.stopPropagation();
    });
  }

  async function moveTask(taskId, nextState, options = {}) {
    const { message, successMessage, afterSuccess, onError } = options;
    const startMessage = message || (nextState === "done" ? "Completing task…" : "Moving task…");
    const doneMessage = successMessage || (nextState === "done" ? "Task completed" : "Task moved");

    boardEl.setAttribute("data-working", "true");
    setActivityStatus(startMessage, "warn");
    let succeeded = false;
    let payload = null;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      payload = await response.json();
      if (payload?.snapshot) {
        renderBoard(payload.snapshot);
        applyProjectName(payload.snapshot.project_name);
      }
      succeeded = true;
      setActivityStatus(doneMessage, "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      if (typeof afterSuccess === "function") {
        afterSuccess(payload);
      }
      if (nextState !== "done") {
        notifyTaskMove(taskId, nextState, payload?.snapshot);
      }
    } catch (error) {
      console.error(error);
      const messageText =
        (error instanceof Error ? error.message : String(error)) || "Failed to move task";
      setActivityStatus(messageText, "error");
      pushNotification(messageText, "error", { persistent: true });
      if (typeof onError === "function") {
        onError(error);
      }
    } finally {
      boardEl.removeAttribute("data-working");
    }
    return succeeded;
  }

  function openCreateModal(state) {
    const createState = STATE_ORDER.includes(state) ? state : "idea";

    if (!childModal || !childTitleInput || !childKindSelect || !childPrioritySelect) {
      return;
    }

    childModalParentDetail = null;
    childModalTitle.textContent = "Create New Task";
    childModalParent.textContent = `Will be added to ${STATE_LABELS[createState] || createState}`;
    childTitleInput.value = "";
    childPrioritySelect.value = "normal";

    childKindSelect.innerHTML = "";
    ["epic", "story", "task"].forEach((kind) => {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
      if (kind === "task") {
        option.selected = true;
      }
      childKindSelect.appendChild(option);
    });

    childModalStatus.textContent = "";
    childModalSave.disabled = false;
    childModalSave.textContent = "Create task";
    childModal.dataset.createState = createState;
    childModal.dataset.isTopLevel = "true";
    document.body.classList.add("modal-open");
    modalBackdrop.classList.add("active");
    childModal.classList.add("active");
    requestAnimationFrame(() => childTitleInput.focus());
  }

  async function openTaskModal(taskId) {
    modalMode = "edit";
    modalViewMode = "view";
    modalTaskId = taskId;
    isSaving = false;
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
    isCompleting = false;
    if (openBodyButton) {
      openBodyButton.disabled = false;
      openBodyButton.style.display = "";
    }
    updateCompleteButton(null);
    if (editToggleButton) {
      editToggleButton.style.display = "";
      editToggleButton.textContent = "Edit";
    }
    modalStatus.textContent = "";
    document.body.classList.add("modal-open");
    modalBackdrop.classList.add("active");
    modalEl.classList.add("active");

    try {
      const detail = await fetchTaskDetails(taskId);
      populateModal(detail);
      setModalViewMode("view");
    } catch (error) {
      modalStatus.textContent = error.message || "Failed to load task";
    }
  }

  function toggleModalViewMode() {
    if (modalViewMode === "view") {
      setModalViewMode("edit");
    } else {
      setModalViewMode("view");
    }
  }

  function setModalViewMode(mode) {
    modalViewMode = mode;
    const isEditing = mode === "edit";

    if (isEditing) {
      _modalDirty = false;
    } else {
      _modalDirty = false;
      if (modalBaselineDetail) {
        modalLastSeenUpdatedAt = modalBaselineDetail.updated_at || modalLastSeenUpdatedAt;
      }
      hideModalUpdateBanner();
    }

    fieldTitle.readOnly = !isEditing;
    fieldPriority.disabled = !isEditing;
    fieldSize.disabled = !isEditing;
    fieldAmbiguity.disabled = !isEditing;
    fieldExecutor.disabled = !isEditing;
    setScaleDisabled("priority", !isEditing);
    setScaleDisabled("size", !isEditing);
    setScaleDisabled("ambiguity", !isEditing);
    setScaleDisabled("executor", !isEditing);
    // State cannot be edited in the modal
    fieldState.disabled = true;
    fieldKind.disabled = !isEditing;

    if (fieldBody && fieldBodyEdit) {
      if (isEditing) {
        fieldBody.style.display = "none";
        fieldBodyEdit.style.display = "";
        fieldBodyEdit.value = bodyEditorDetail?.body || "";
      } else {
        fieldBody.style.display = "";
        fieldBodyEdit.style.display = "none";
      }
    }

    if (editToggleButton) {
      // Show the bottom-right Edit button only in view mode
      editToggleButton.textContent = isEditing ? "View" : "Edit";
      editToggleButton.style.display = isEditing ? "none" : "";
    }

    // Keep child and delete action buttons visible in both modes;
    // hide Save/Cancel in view mode and show when editing
    saveButton.style.display = isEditing ? "" : "none";
    cancelButton.style.display = isEditing ? "" : "none";
    updateCompleteButton(bodyEditorDetail);
  }

  async function fetchTaskDetails(taskId) {
    if (taskDetailsCache.has(taskId)) {
      return taskDetailsCache.get(taskId);
    }
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (!response.ok) {
      throw new Error(await extractError(response));
    }
    const payload = await response.json();
    if (!payload || !payload.task) {
      throw new Error("Malformed response");
    }
    taskDetailsCache.set(taskId, payload.task);
    return payload.task;
  }

  function populateModal(detail) {
    modalBaselineDetail = detail;
    modalLastSeenUpdatedAt = detail.updated_at || null;
    modalPendingRemoteUpdatedAt = null;
    _modalDirty = false;
    hideModalUpdateBanner();
    modalTitle.textContent = detail.title;
    fieldTitle.value = detail.title || "";
    fieldPriority.value = detail.priority;
    fieldSize.value = detail.size;
    fieldAmbiguity.value = detail.ambiguity;
    fieldExecutor.value = detail.executor;
    setScaleValue("priority", detail.priority);
    setScaleValue("size", detail.size);
    setScaleValue("ambiguity", detail.ambiguity);
    setScaleValue("executor", detail.executor);
    fieldState.value = detail.state;
    updateBlockButton(detail.blocked);
    bodyEditorDetail = detail;
    fieldBody.innerHTML = renderMarkdown(detail.body || "");
    fieldId.textContent = detail.id;
    fieldKind.value = detail.kind;
    updateChildButtonState(detail);
    if (detail.descendant_count > 0) {
      deleteButton.dataset.hasDescendants = "true";
      deleteButton.textContent = "Delete task tree";
    } else {
      deleteButton.dataset.hasDescendants = "false";
      deleteButton.textContent = "Delete task";
    }
    updateCompleteButton(detail);
  }

  async function openBodyEditor(taskId) {
    try {
      const detail = await fetchTaskDetails(taskId);
      bodyEditorDetail = detail;
      bodyModalTitle.textContent = `Edit Body — ${detail.title || detail.id}`;
      bodyModalId.textContent = detail.id;
      bodyEditorInput.value = detail.body || "";
      bodyModalStatus.textContent = "";
      bodyModalSave.disabled = false;
      isBodySaving = false;
      bodyModal.classList.add("active");
      requestAnimationFrame(() => {
        bodyEditorInput.focus();
        const length = bodyEditorInput.value.length;
        bodyEditorInput.setSelectionRange(length, length);
      });
    } catch (error) {
      bodyModalStatus.textContent =
        (error instanceof Error ? error.message : String(error)) || "Failed to load body";
      bodyModalSave.disabled = true;
      bodyModal.classList.add("active");
    }
  }

  function closeBodyEditor() {
    if (!bodyModal.classList.contains("active")) {
      bodyEditorDetail = null;
      return;
    }
    bodyModal.classList.remove("active");
    bodyModalStatus.textContent = "";
    bodyModalSave.disabled = false;
    isBodySaving = false;
    bodyEditorInput.value = "";
    bodyEditorDetail = null;
  }

  async function saveBodyChanges(taskId) {
    if (isBodySaving) {
      return;
    }
    isBodySaving = true;
    bodyModalSave.disabled = true;
    bodyModalStatus.textContent = "";
    setActivityStatus("Saving body…", "warn");
    const nextBody = bodyEditorInput.value;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: nextBody }),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      if (bodyEditorDetail) {
        bodyEditorDetail = {
          ...bodyEditorDetail,
          body: nextBody,
        };
        taskDetailsCache.set(taskId, bodyEditorDetail);
      } else {
        taskDetailsCache.delete(taskId);
      }
      fieldBody.innerHTML = renderMarkdown(nextBody);
      setActivityStatus("Body updated", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      closeBodyEditor();
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)) || "Failed to save";
      bodyModalStatus.textContent = message;
      setActivityStatus(message, "error");
      bodyModalSave.disabled = false;
      isBodySaving = false;
      return;
    }
    isBodySaving = false;
    bodyModalSave.disabled = false;
  }

  async function createTask() {
    const title = fieldTitle.value.trim();
    if (title.length === 0) {
      modalStatus.textContent = "Title is required";
      return;
    }

    // State is chosen by which column you create in; default to modalCreateState
    const normalizedState = modalCreateState;
    const payload = {
      title,
      state: normalizedState,
      kind: fieldKind.value || "task",
      priority: fieldPriority.value,
      size: fieldSize.value,
      ambiguity: fieldAmbiguity.value,
      executor: fieldExecutor.value,
    };

    isSaving = true;
    saveButton.disabled = true;
    modalStatus.textContent = "";
    setActivityStatus("Creating task…", "warn");

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      taskDetailsCache.clear();
      setActivityStatus("Task created", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      closeModal();
      pushNotification("Task created", "success");
    } catch (error) {
      const message = error.message || "Failed to create task";
      modalStatus.textContent = message;
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
      saveButton.disabled = false;
      isSaving = false;
      return;
    }

    isSaving = false;
    saveButton.disabled = false;
  }

  async function saveTaskChanges(taskId) {
    isSaving = true;
    saveButton.disabled = true;
    modalStatus.textContent = "";
    setActivityStatus("Saving task…", "warn");
    const payload = {
      title: fieldTitle.value.trim(),
      priority: fieldPriority.value,
      size: fieldSize.value,
      ambiguity: fieldAmbiguity.value,
      executor: fieldExecutor.value,
    };

    if (fieldBodyEdit && modalViewMode === "edit") {
      payload.body = fieldBodyEdit.value;
    }

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      taskDetailsCache.delete(taskId);
      if (fieldBodyEdit && modalViewMode === "edit") {
        bodyEditorDetail = {
          ...bodyEditorDetail,
          body: fieldBodyEdit.value,
        };
        taskDetailsCache.set(taskId, bodyEditorDetail);
        fieldBody.innerHTML = renderMarkdown(fieldBodyEdit.value);
      }
      setActivityStatus("Task updated", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      setModalViewMode("view");
    } catch (error) {
      const message = error.message || "Failed to save task";
      modalStatus.textContent = message;
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
      saveButton.disabled = false;
      isSaving = false;
      return;
    }

    isSaving = false;
    saveButton.disabled = false;
  }

  async function openCommitModalForTask(taskId, source, detail) {
    if (!commitModal || !commitMessageInput || !commitModalSave || !commitModalStatus) {
      return;
    }

    let resolvedDetail = detail ?? null;
    if (!resolvedDetail) {
      try {
        resolvedDetail = await fetchTaskDetails(taskId);
      } catch (error) {
        const message =
          (error instanceof Error ? error.message : String(error)) ||
          "Failed to load commit message";
        if (source === "modal") {
          modalStatus.textContent = message;
        } else {
          setActivityStatus(message, "error");
          pushNotification(message, "error", { persistent: true });
        }
        return;
      }
    }

    commitModalTaskId = taskId;
    commitModalDetail = resolvedDetail;
    commitModalSource = source;
    commitModalStatus.textContent = "";
    commitModalSave.disabled = false;
    commitMessageInput.disabled = false;
    commitMessageInput.value = resolvedDetail?.commit_message ?? "";
    if (commitModalTitle) {
      const label = resolvedDetail?.title || resolvedDetail?.id || "Commit Message";
      commitModalTitle.textContent = `Commit Message — ${label}`;
    }
    if (source === "board") {
      document.body.classList.add("modal-open");
      modalBackdrop.classList.add("active");
    }
    commitModal.classList.add("active");
    if (source === "modal" && completeButton) {
      completeButton.disabled = true;
    }
    requestAnimationFrame(() => {
      commitMessageInput.focus();
      const length = commitMessageInput.value.length;
      commitMessageInput.setSelectionRange(length, length);
    });
  }

  function closeCommitModal(reason) {
    if (!commitModal) {
      return;
    }
    commitModal.classList.remove("active");
    if (commitMessageInput) {
      commitMessageInput.value = "";
      commitMessageInput.disabled = false;
    }
    if (commitModalStatus) {
      commitModalStatus.textContent = "";
    }
    if (commitModalSave) {
      commitModalSave.disabled = false;
    }
    const source = commitModalSource;
    commitModalTaskId = null;
    commitModalDetail = null;
    commitModalSource = null;
    isSavingCommitMessage = false;
    if (source === "modal" && completeButton) {
      completeButton.disabled = false;
    }
    if (source === "board") {
      document.body.classList.remove("modal-open");
      modalBackdrop.classList.remove("active");
    }
    if (reason === "cancel") {
      if (source === "modal") {
        modalStatus.textContent = "Completion canceled";
      } else {
        setActivityStatus("Completion canceled", "warn");
        setTimeout(() => setActivityStatus(""), 2000);
      }
    }
  }

  async function handleCommitModalSubmit() {
    if (!commitModalTaskId || !commitMessageInput || isSavingCommitMessage) {
      return;
    }
    const message = commitMessageInput.value.trim();
    if (message.length === 0) {
      commitModalStatus.textContent = "Commit message is required";
      commitMessageInput.focus();
      return;
    }

    const taskId = commitModalTaskId;
    const source = commitModalSource || "board";
    const existing = commitModalDetail?.commit_message ?? "";

    if (existing === message) {
      const detail = commitModalDetail;
      closeCommitModal("confirm");
      await finalizeCompletion(taskId, source, detail, message);
      return;
    }

    isSavingCommitMessage = true;
    commitModalSave.disabled = true;
    commitMessageInput.disabled = true;
    commitModalStatus.textContent = "Saving commit message…";
    const saved = await saveCommitMessage(taskId, message);
    isSavingCommitMessage = false;
    if (!saved) {
      commitModalSave.disabled = false;
      commitMessageInput.disabled = false;
      return;
    }
    if (commitModalDetail) {
      commitModalDetail = { ...commitModalDetail, commit_message: message };
    }
    const detail = commitModalDetail;
    closeCommitModal("confirm");
    await finalizeCompletion(taskId, source, detail, message);
  }

  async function saveCommitMessage(taskId, commitMessage) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit_message: commitMessage }),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      taskDetailsCache.delete(taskId);
      if (bodyEditorDetail && bodyEditorDetail.id === taskId) {
        bodyEditorDetail = { ...bodyEditorDetail, commit_message: commitMessage };
        taskDetailsCache.set(taskId, bodyEditorDetail);
      }
      return true;
    } catch (error) {
      const message =
        (error instanceof Error ? error.message : String(error)) || "Failed to save commit message";
      commitModalStatus.textContent = message;
      pushNotification(message, "error", { persistent: true });
      return false;
    }
  }

  async function finalizeCompletion(taskId, source, detail, commitMessage) {
    if (detail && commitMessage) {
      detail.commit_message = commitMessage;
    }

    if (source === "modal") {
      modalStatus.textContent = "";
      isCompleting = true;
      updateCompleteButton(detail || bodyEditorDetail);
      const succeeded = await moveTask(taskId, "done", {
        message: "Completing task…",
        successMessage: "Task completed",
        afterSuccess: () => {
          taskDetailsCache.delete(taskId);
          closeModal();
        },
        onError: (error) => {
          const message =
            (error instanceof Error ? error.message : String(error)) || "Failed to complete task";
          modalStatus.textContent = message;
        },
      });
      if (!succeeded) {
        isCompleting = false;
        updateCompleteButton(detail || bodyEditorDetail);
      }
    } else {
      await moveTask(taskId, "done", {
        message: "Completing task…",
        successMessage: "Task completed",
      });
    }
  }

  async function completeCurrentTask(taskId) {
    if (!taskId) {
      return;
    }
    const detail =
      bodyEditorDetail ??
      (await fetchTaskDetails(taskId).catch((error) => {
        const message =
          (error instanceof Error ? error.message : String(error)) || "Failed to load task details";
        modalStatus.textContent = message;
        return null;
      }));
    if (!detail) {
      return;
    }
    bodyEditorDetail = detail;
    await openCommitModalForTask(taskId, "modal", detail);
  }

  function updateChildButtonState(detail) {
    if (!newChildButton) {
      return;
    }
    const allowedKinds = getChildKindsForParent(detail.kind);
    const disabled =
      detail.state === "done" || detail.state === "canceled" || allowedKinds.length === 0;
    newChildButton.disabled = disabled;
    if (disabled) {
      if (detail.state === "done" || detail.state === "canceled") {
        newChildButton.title = "Cannot add children to completed or canceled tasks";
      } else {
        newChildButton.title = "This task type cannot adopt children";
      }
    } else {
      newChildButton.title = "Create a child task";
    }
  }

  function updateCompleteButton(detail) {
    if (!completeButton) {
      return;
    }
    const state = detail?.state;
    const hideButton =
      !detail || modalMode === "create" || state === "done" || state === "canceled";
    const isEditing = modalViewMode === "edit";
    if (hideButton || isEditing) {
      completeButton.style.display = "none";
      completeButton.disabled = false;
      completeButton.textContent = "Complete task";
      completeButton.removeAttribute("title");
      return;
    }
    completeButton.style.display = "";
    completeButton.disabled = isCompleting;
    completeButton.textContent = isCompleting ? "Completing…" : "Complete task";
    completeButton.title = "Move task to Done";
  }

  function getChildKindsForParent(kind) {
    return CHILD_KIND_MAP[kind] ? [...CHILD_KIND_MAP[kind]] : [];
  }

  function openChildModal(detail) {
    const kinds = getChildKindsForParent(detail.kind);
    if (kinds.length === 0) {
      return;
    }
    childModalParentDetail = detail;
    childModalTitle.textContent = detail.kind === "epic" ? "Create Story" : "Create Task";
    childModalParent.textContent = detail.title || detail.id;
    childTitleInput.value = "";
    childPrioritySelect.value = detail.priority || "normal";
    childKindSelect.innerHTML = "";
    kinds.forEach((kind) => {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
      childKindSelect.appendChild(option);
    });
    childModalStatus.textContent = "";
    childModalSave.disabled = false;
    childModalSave.textContent = "Create task";
    childModal.dataset.isTopLevel = "false";
    childModal.classList.add("active");
    requestAnimationFrame(() => childTitleInput.focus());
  }

  function closeChildModal() {
    childModal.classList.remove("active");
    document.body.classList.remove("modal-open");
    modalBackdrop.classList.remove("active");
    childModalStatus.textContent = "";
    childModalSave.disabled = false;
    childTitleInput.value = "";
    childModalParentDetail = null;
    delete childModal.dataset.isTopLevel;
    delete childModal.dataset.createState;
  }

  async function createChildTask() {
    const isTopLevel = childModal.dataset.isTopLevel === "true";
    const title = childTitleInput.value.trim();

    if (title.length === 0) {
      childModalStatus.textContent = "Title is required";
      childTitleInput.focus();
      return;
    }

    if (!isTopLevel && !childModalParentDetail) {
      return;
    }

    const payload = {
      title,
      kind: childKindSelect.value,
      priority: childPrioritySelect.value,
    };

    if (isTopLevel) {
      const createState = childModal.dataset.createState || "idea";
      payload.state = createState;
    } else {
      payload.parent = childModalParentDetail.id;
      payload.state =
        childModalParentDetail.state === "done" || childModalParentDetail.state === "canceled"
          ? "idea"
          : childModalParentDetail.state;
    }

    childModalSave.disabled = true;
    childModalStatus.textContent = "";
    setActivityStatus(isTopLevel ? "Creating task…" : "Creating child task…", "warn");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      if (!isTopLevel && childModalParentDetail) {
        taskDetailsCache.delete(childModalParentDetail.id);
      }
      setActivityStatus(isTopLevel ? "Task created" : "Child task created", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      closeChildModal();
      pushNotification(isTopLevel ? "Task created" : "Child task created", "success");
    } catch (error) {
      const message = error.message || "Failed to create task";
      childModalStatus.textContent = message;
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
      childModalSave.disabled = false;
      return;
    }
    childModalSave.disabled = false;
  }

  function pushNotification(message, variant = "info", options = {}) {
    if (!notificationRegion || !message) {
      return;
    }
    const id = notificationCounter++;
    const entry = {
      id,
      message,
      variant,
      persistent: options.persistent === true,
    };
    notifications.push(entry);
    renderNotifications();
    const duration =
      options.duration ?? (variant === "error" || variant === "warning" ? 8000 : 5000);
    if (!entry.persistent) {
      entry.timeout = window.setTimeout(() => {
        removeNotification(id);
      }, duration);
    }
  }

  function removeNotification(id) {
    const index = notifications.findIndex((note) => note.id === id);
    if (index === -1) {
      return;
    }
    const [entry] = notifications.splice(index, 1);
    if (entry.timeout) {
      window.clearTimeout(entry.timeout);
    }
    renderNotifications();
  }

  function renderNotifications() {
    if (!notificationRegion) {
      return;
    }
    notificationRegion.innerHTML = "";
    notifications.forEach((note) => {
      const item = document.createElement("div");
      item.className = `notification ${note.variant}`;
      item.setAttribute(
        "role",
        note.variant === "error" || note.variant === "warning" ? "alert" : "status",
      );
      const message = document.createElement("div");
      message.className = "notification-message";
      message.textContent = note.message;
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.setAttribute("aria-label", "Dismiss notification");
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => removeNotification(note.id));
      item.appendChild(message);
      item.appendChild(dismiss);
      notificationRegion.appendChild(item);
    });
  }

  function notifyTaskMove(taskId, nextState, snapshot) {
    const label = STATE_LABELS[nextState] || nextState;
    const found = snapshot ? findTaskInSnapshot(snapshot, taskId) : null;
    const title = found?.title || "Task";
    const isDone = nextState === "done";
    const message = isDone ? `Completed ${title}` : `${title} moved to ${label}`;
    pushNotification(message, isDone ? "success" : "info", {
      persistent: isDone,
    });
  }

  function findTaskInSnapshot(snapshot, taskId) {
    if (!snapshot || !snapshot.columns) {
      return null;
    }
    for (const nodes of Object.values(snapshot.columns)) {
      if (!Array.isArray(nodes)) continue;
      for (const node of nodes) {
        const found = findTaskNode(node, taskId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  function findTaskNode(node, taskId) {
    if (!node) return null;
    if (node.id === taskId) {
      return node;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findTaskNode(child, taskId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  function scrollTaskIntoView(taskId) {
    if (!taskId) {
      return;
    }
    const selectorId =
      typeof CSS !== "undefined" && CSS.escape ? CSS.escape(taskId) : taskId.replace(/"/g, '\\"');
    const target = document.querySelector(`[data-task-id="${selectorId}"]`);
    if (!target) {
      pushNotification("Task not visible in current view", "info");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("card-pulse");
    window.setTimeout(() => target.classList.remove("card-pulse"), 1200);
  }

  function loadExpandedParents() {
    try {
      const raw = window.sessionStorage.getItem(PARENT_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch (error) {
      console.warn("Failed to load parent expansion state", error);
    }
    return new Set();
  }

  function persistExpandedParents() {
    try {
      window.sessionStorage.setItem(
        PARENT_SESSION_KEY,
        JSON.stringify(Array.from(expandedParents)),
      );
    } catch (error) {
      console.warn("Failed to persist parent expansion state", error);
    }
  }

  function toggleParentExpansion(taskId) {
    if (expandedParents.has(taskId)) {
      expandedParents.delete(taskId);
    } else {
      expandedParents.add(taskId);
    }
    persistExpandedParents();
    if (currentSnapshot) {
      renderBoard(currentSnapshot);
    }
  }

  function closeModal() {
    closeBodyEditor();
    closeBlockModal();
    closeDeleteModal();
    closeChildModal();
    hideModalUpdateBanner();
    modalTaskId = null;
    modalMode = "edit";
    modalViewMode = "view";
    modalCreateState = "idea";
    isSaving = false;
    isCompleting = false;
    saveButton.textContent = "Save changes";
    fieldState.disabled = true;
    fieldState.value = "idea";
    fieldKind.disabled = true;
    fieldTitle.readOnly = false;
    modalStatus.textContent = "";
    _modalDirty = false;
    modalBaselineDetail = null;
    _modalPendingDiff = null;
    modalPendingRemoteUpdatedAt = null;
    modalLastSeenUpdatedAt = null;
    updateCompleteButton(null);
    document.body.classList.remove("modal-open");
    modalBackdrop.classList.remove("active");
    modalEl.classList.remove("active");
  }

  function updateBlockButton(blockedValue) {
    if (!blockToggleButton) return;
    const isBlocked = !!(blockedValue && String(blockedValue).trim());
    blockToggleButton.textContent = isBlocked ? "Unblock" : "Block";
    blockToggleButton.title = isBlocked ? "Unblock this task" : "Block this task";
  }

  async function toggleBlock(taskId) {
    const current = bodyEditorDetail?.blocked || "";
    const isBlocked = !!(current && String(current).trim());
    if (!isBlocked) {
      openBlockModal();
      return;
    }
    setActivityStatus("Unblocking…", "warn");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: null }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      // refresh local cache / modal state
      taskDetailsCache.delete(taskId);
      const detail = await fetchTaskDetails(taskId);
      populateModal(detail);
      setActivityStatus("Task unblocked", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
    } catch (error) {
      const message = error?.message || "Failed to update block state";
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
    }
  }

  function openBlockModal() {
    blockReasonInput.value = "";
    blockModalStatus.textContent = "";
    document.body.classList.add("modal-open");
    modalBackdrop.classList.add("active");
    blockModal.classList.add("active");
    requestAnimationFrame(() => blockReasonInput.focus());
  }

  function closeBlockModal() {
    blockModal.classList.remove("active");
    document.body.classList.remove("modal-open");
    modalBackdrop.classList.remove("active");
    blockModalStatus.textContent = "";
  }

  async function confirmBlock(reason) {
    if (!modalTaskId) return;
    blockModalConfirm.disabled = true;
    blockModalStatus.textContent = "";
    setActivityStatus("Blocking…", "warn");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(modalTaskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: reason.trim() }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const json = await response.json();
      if (json?.snapshot) {
        renderBoard(json.snapshot);
        applyProjectName(json.snapshot.project_name);
      }
      taskDetailsCache.delete(modalTaskId);
      const detail = await fetchTaskDetails(modalTaskId);
      populateModal(detail);
      closeBlockModal();
      setActivityStatus("Task blocked", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
    } catch (error) {
      const message = error?.message || "Failed to block task";
      blockModalStatus.textContent = message;
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
    } finally {
      blockModalConfirm.disabled = false;
    }
  }

  function setConnectionStatus(message, state) {
    if (!statusEl) {
      return;
    }
    const label = statusEl.querySelector(".live-indicator-label");
    if (label) {
      label.textContent = message;
    } else {
      statusEl.textContent = message;
    }
    if (state) {
      statusEl.dataset.state = state;
    } else {
      statusEl.removeAttribute("data-state");
    }
    const accessibleLabel = `Connection status: ${message}`;
    statusEl.setAttribute("title", accessibleLabel);
    statusEl.setAttribute("aria-label", accessibleLabel);
  }

  function setActivityStatus(message, state) {
    if (!message) {
      activityEl.textContent = "";
      activityEl.removeAttribute("data-state");
      return;
    }
    activityEl.textContent = message;
    activityEl.dataset.state = state || "info";
  }

  function formatTimestamp(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  }

  async function extractError(response) {
    try {
      const data = await response.json();
      if (data?.error) {
        return data.error;
      }
    } catch (_error) {
      /* ignore */
    }
    return `${response.status} ${response.statusText}`;
  }

  function applyProjectName(name) {
    if (!name) {
      return;
    }
    const titleText = `${name} — Taskplain Board`;
    document.title = titleText;
    const heading = document.getElementById("board-heading");
    if (heading) {
      heading.textContent = titleText;
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        pushNotification("Task ID copied to clipboard", "success");
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
          pushNotification("Task ID copied to clipboard", "success");
        } catch (_err) {
          pushNotification("Failed to copy task ID", "error");
        }
        textArea.remove();
      }
    } catch (_error) {
      pushNotification("Failed to copy task ID", "error");
    }
  }

  function collectDoneTaskIds(snapshot) {
    const ids = new Set();
    if (!snapshot || !snapshot.columns) {
      return ids;
    }
    const doneColumn = snapshot.columns.done;
    if (!Array.isArray(doneColumn)) {
      return ids;
    }
    const queue = [...doneColumn];
    while (queue.length > 0) {
      const task = queue.pop();
      if (!task || task.state !== "done") {
        continue;
      }
      ids.add(task.id);
      if (Array.isArray(task.children)) {
        task.children.forEach((child) => {
          if (child && child.state === "done") {
            queue.push(child);
          }
        });
      }
    }
    return ids;
  }

  function launchConfetti(multiplier) {
    if (typeof window.confetti === "function") {
      const bursts = Math.max(1, Math.min(3, Math.floor(multiplier / 2) + 1));
      for (let index = 0; index < bursts; index += 1) {
        window.confetti({
          particleCount: Math.min(400, 120 + multiplier * 80),
          spread: 70,
          gravity: 1.1,
          scalar: 1,
          origin: { y: 0.2 },
        });
      }
      return;
    }

    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    const colors = ["#38bdf8", "#a855f7", "#f97316", "#22d3ee", "#f472b6"];
    const count = Math.min(200, 60 + Math.floor(multiplier * 30));
    for (let index = 0; index < count; index += 1) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.backgroundColor = colors[index % colors.length];
      const left = Math.random() * 100;
      piece.style.left = `${left}%`;
      const delay = Math.random() * 150;
      const duration = 1800 + Math.random() * 1200;
      const drift = (Math.random() - 0.5) * 320;
      const rotation = (Math.random() - 0.5) * 720;
      const midRotation = rotation * 0.5;
      const fall = window.innerHeight + 200;
      piece.animate(
        [
          { transform: "translate3d(0, -10%, 0) rotate(0deg)", opacity: 0 },
          {
            transform: `translate3d(${drift * 0.6}px, ${fall * 0.5}px, 0) rotate(${midRotation}deg)`,
            opacity: 1,
          },
          {
            transform: `translate3d(${drift}px, ${fall}px, 0) rotate(${rotation}deg)`,
            opacity: 0,
          },
        ],
        {
          duration,
          delay,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        },
      );
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    window.setTimeout(() => {
      layer.remove();
    }, 3500);
  }

  function renderMarkdown(source) {
    if (!source) {
      return "";
    }
    const sanitizeHtml = (html) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      const disallowed = new Set(["script", "style", "iframe", "object", "embed", "link", "meta"]);
      const walker = document.createTreeWalker(
        template.content,
        window.NodeFilter ? window.NodeFilter.SHOW_ELEMENT : 1,
      );
      const toRemove = [];
      while (walker.nextNode()) {
        const element = walker.currentNode;
        const tagName = element.tagName.toLowerCase();
        if (disallowed.has(tagName)) {
          toRemove.push(element);
          continue;
        }
        const attributes = Array.from(element.attributes);
        attributes.forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value;
          if (name.startsWith("on")) {
            element.removeAttribute(attr.name);
            return;
          }
          if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
            element.removeAttribute(attr.name);
          }
        });
      }
      toRemove.forEach((node) => {
        node.remove();
      });
      const listItems = template.content.querySelectorAll("li");
      listItems.forEach((item) => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!checkbox) {
          return;
        }
        item.classList.add("task-list-item");
        if (checkbox.checked) {
          item.classList.add("task-list-item-checked");
        }
        // Keep non-interactive without dimming accent color
        checkbox.setAttribute("aria-disabled", "true");
        checkbox.setAttribute("tabindex", "-1");
        while (
          item.firstChild &&
          item.firstChild !== checkbox &&
          item.firstChild.nodeType === Node.TEXT_NODE &&
          item.firstChild.textContent &&
          item.firstChild.textContent.trim() === ""
        ) {
          item.removeChild(item.firstChild);
        }
        if (checkbox.previousSibling) {
          item.insertBefore(checkbox, item.firstChild);
        }
        const list = item.closest("ul,ol");
        if (list) {
          list.classList.add("task-list");
          if (!list.classList.contains("contains-task-list")) {
            list.classList.add("contains-task-list");
          }
        }
        const label = document.createElement("span");
        label.className = "task-list-item-label";
        let sibling = checkbox.nextSibling;
        while (sibling) {
          const next = sibling.nextSibling;
          label.appendChild(sibling);
          sibling = next;
        }
        if (label.childNodes.length > 0) {
          item.appendChild(label);
        }
      });
      return template.innerHTML;
    };
    if (window.marked && typeof window.marked.parse === "function") {
      const rawHtml = window.marked.parse(String(source));
      return sanitizeHtml(rawHtml);
    }
    const text = String(source).replace(/\r\n/g, "\n");
    const escapeHtml = (value) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapeAttr = (value) => escapeHtml(value).replace(/"/g, "&quot;");
    const lines = text.split("\n");
    const htmlParts = [];
    let inList = false;
    let listTag = "";
    let listClass = "";
    const flushList = () => {
      if (inList) {
        htmlParts.push(`</${listTag}>`);
        inList = false;
        listTag = "";
        listClass = "";
      }
    };
    let inCodeBlock = false;
    let codeLang = "";
    const codeLines = [];
    const flushCode = () => {
      if (!inCodeBlock) {
        return;
      }
      const content = escape(codeLines.join("\n"));
      const langAttr = codeLang ? ` class="language-${escapeAttr(codeLang)}"` : "";
      htmlParts.push(`<pre><code${langAttr}>${content}</code></pre>`);
      inCodeBlock = false;
      codeLang = "";
      codeLines.length = 0;
    };

    const splitTableRow = (line) => {
      const trimmed = line.trim();
      const withoutBorders = trimmed.replace(/^\|/, "").replace(/\|$/, "");
      return withoutBorders.split("|").map((cell) => cell.trim());
    };

    const alignmentFromCell = (cell) => {
      const trimmed = cell.trim();
      const left = trimmed.startsWith(":");
      const right = trimmed.endsWith(":");
      if (left && right) {
        return "center";
      }
      if (right) {
        return "right";
      }
      if (left) {
        return "left";
      }
      return "";
    };

    const parseTable = (startIndex) => {
      const headerLine = lines[startIndex];
      const separatorLine = lines[startIndex + 1];
      if (
        !headerLine ||
        !separatorLine ||
        headerLine.indexOf("|") === -1 ||
        separatorLine.indexOf("|") === -1
      ) {
        return null;
      }
      const headerCells = splitTableRow(headerLine);
      const separatorCells = splitTableRow(separatorLine);
      if (headerCells.length === 0) {
        return null;
      }
      const separatorValid = separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
      if (!separatorValid) {
        return null;
      }
      const alignments = headerCells.map((_, index) =>
        alignmentFromCell(index < separatorCells.length ? separatorCells[index] : ""),
      );
      const rows = [];
      let i = startIndex + 2;
      while (i < lines.length) {
        const rowLine = lines[i];
        if (!rowLine || rowLine.trim() === "") {
          break;
        }
        if (rowLine.indexOf("|") === -1) {
          break;
        }
        const rowCells = splitTableRow(rowLine);
        rows.push(rowCells);
        i += 1;
      }
      const headerHtml = headerCells
        .map((cell, index) => {
          const align = alignments[index];
          const alignAttr = align ? ` style="text-align: ${align};"` : "";
          return `<th${alignAttr}>${inlineFormat(cell)}</th>`;
        })
        .join("");
      const bodyHtml = rows
        .map((row) => {
          const cells = headerCells.map((_, index) => {
            const cellValue = index < row.length ? row[index] : "";
            const align = alignments[index];
            const alignAttr = align ? ` style="text-align: ${align};"` : "";
            return `<td${alignAttr}>${inlineFormat(cellValue)}</td>`;
          });
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
      return {
        html: `<table class="md-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
        nextIndex: i - 1,
      };
    };

    const parseBlockquote = (startIndex) => {
      const collected = [];
      let i = startIndex;
      while (i < lines.length) {
        const current = lines[i];
        if (!/^\s*>/.test(current)) {
          break;
        }
        collected.push(current.replace(/^\s*> ?/, ""));
        i += 1;
      }
      const innerHtml = renderMarkdown(collected.join("\n"));
      return {
        html: `<blockquote>${innerHtml}</blockquote>`,
        nextIndex: i - 1,
      };
    };

    const inlineFormat = (value) => {
      if (!value) {
        return "";
      }
      let escaped = escape(value);
      const codeTokens = [];
      escaped = escaped.replace(/`([^`]+)`/g, (_, code) => {
        const token = `@@CODE${codeTokens.length}@@`;
        codeTokens.push(code);
        return token;
      });
      escaped = escaped.replace(
        /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
        (_match, alt, src) =>
          `<img src="${escapeAttr(src)}" alt="${escape(alt)}" loading="lazy" />`,
      );
      escaped = escaped.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_match, label, href) =>
          `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
      escaped = escaped.replace(/~~(.+?)~~/g, "<del>$1</del>");
      escaped = escaped.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
      escaped = escaped.replace(/(\*|_)([^*_]+?)\1/g, "<em>$2</em>");
      escaped = escaped.replace(/@@CODE(\d+)@@/g, (_, index) => {
        const codeContent = codeTokens[Number(index)] ?? "";
        return `<code>${codeContent}</code>`;
      });
      escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, (match, _url, offset, full) => {
        const prevChar = offset === 0 ? "" : full[offset - 1];
        if (prevChar === '"' || prevChar === "'" || prevChar === "=") {
          return match;
        }
        return `<a href="${escapeAttr(match)}" target="_blank" rel="noopener noreferrer">${match}</a>`;
      });
      return escaped;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (inCodeBlock) {
        if (/^\s*```/.test(line)) {
          flushCode();
        } else {
          codeLines.push(line);
        }
        continue;
      }

      const fenceMatch = line.match(/^\s*```(\w+)?\s*$/);
      if (fenceMatch) {
        flushList();
        flushCode();
        inCodeBlock = true;
        codeLang = fenceMatch[1] ? fenceMatch[1].trim() : "";
        codeLines.length = 0;
        continue;
      }

      if (/^\s*$/.test(line)) {
        flushList();
        continue;
      }

      const table = parseTable(i);
      if (table) {
        flushList();
        htmlParts.push(table.html);
        i = table.nextIndex;
        continue;
      }

      if (/^\s*>/.test(line)) {
        flushList();
        const block = parseBlockquote(i);
        htmlParts.push(block.html);
        i = block.nextIndex;
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        htmlParts.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushList();
        htmlParts.push("<hr />");
        continue;
      }

      const taskMatch = line.match(/^\s*[-*+]\s+\[(x|X| )\]\s+(.*)$/);
      if (taskMatch) {
        const isChecked = taskMatch[1].toLowerCase() === "x";
        const content = inlineFormat(taskMatch[2]);
        if (!inList || listTag !== "ul" || listClass !== "task-list") {
          flushList();
          htmlParts.push('<ul class="task-list">');
          inList = true;
          listTag = "ul";
          listClass = "task-list";
        }
        htmlParts.push(
          `<li class="task-list-item${isChecked ? " task-list-item-checked" : ""}"><input type="checkbox" aria-disabled="true" tabindex="-1"${isChecked ? " checked" : ""} /><span class="task-list-item-label">${content}</span></li>`,
        );
        continue;
      }

      const listMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const isOrdered = /^\s*\d+\./.test(line);
        const tag = isOrdered ? "ol" : "ul";
        if (!inList || listTag !== tag || listClass !== "") {
          flushList();
          htmlParts.push(`<${tag}>`);
          inList = true;
          listTag = tag;
          listClass = "";
        }
        htmlParts.push(`<li>${inlineFormat(listMatch[1])}</li>`);
        continue;
      }

      flushList();
      htmlParts.push(`<p>${inlineFormat(line)}</p>`);
    }

    flushCode();
    flushList();

    return htmlParts.join("");
  }
  function openDeleteModal(taskId) {
    const detail = taskDetailsCache.get(taskId);
    const hasDescendants =
      detail && typeof detail.descendant_count === "number"
        ? detail.descendant_count > 0
        : deleteButton?.dataset.hasDescendants === "true";
    // Checkbox removed; confirm is enabled by default
    deleteModalConfirm.disabled = false;
    deleteModalStatus.textContent = "";
    deleteModalMessage.textContent = hasDescendants
      ? "Deleting this task will also delete all of its descendant tasks. This cannot be undone."
      : "This will permanently delete the task. This cannot be undone.";
    deleteModal.dataset.taskId = taskId;
    deleteModal.dataset.cascade = hasDescendants ? "true" : "false";
    deleteModal.classList.add("active");
  }

  function closeDeleteModal() {
    deleteModal.dataset.taskId = "";
    deleteModal.dataset.cascade = "false";
    deleteModal.classList.remove("active");
    deleteModalConfirm.disabled = false;
    deleteModalStatus.textContent = "";
  }

  async function performDelete(taskId) {
    if (!deleteModal.classList.contains("active")) {
      return;
    }
    deleteModalConfirm.disabled = true;
    deleteModalStatus.textContent = "";
    setActivityStatus("Deleting task…", "warn");
    const cascade = deleteModal.dataset.cascade === "true";
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}?cascade=${cascade ? "true" : "false"}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const payload = await response.json();
      if (payload?.snapshot) {
        renderBoard(payload.snapshot);
        applyProjectName(payload.snapshot.project_name);
      }
      taskDetailsCache.delete(taskId);
      setActivityStatus("Task deleted", "ok");
      setTimeout(() => setActivityStatus(""), 2000);
      closeDeleteModal();
      closeModal();
      pushNotification("Task deleted", "success");
    } catch (error) {
      const message = error.message || "Failed to delete task";
      deleteModalStatus.textContent = message;
      setActivityStatus(message, "error");
      pushNotification(message, "error", { persistent: true });
      deleteModalConfirm.disabled = false;
    }
  }
})();
// Scale slider helpers
const scaleControls = new Map(); // field -> {slider, options, labelEl, values}

function prettyValue(_field, v) {
  if (v === "human_review") return "Needs human review";
  if (v === "xl") return "XL";
  if (v === "none") return "None";
  return v.replace(/_/g, " ").replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

function updateScaleLabel(field, value) {
  const ctrl = scaleControls.get(field);
  if (!ctrl) return;
  const text = `${ctrl.labelPrefix}: ${prettyValue(field, value)}`;
  ctrl.labelEl.textContent = text;
}

function setScaleValue(field, value, options = {}) {
  const ctrl = scaleControls.get(field);
  if (!ctrl) return;
  const idx = ctrl.values.indexOf(value);
  if (idx === -1) return;
  // Update hidden select
  if (ctrl.selectEl) {
    const previous = ctrl.selectEl.value;
    ctrl.selectEl.value = value;
    if (options.triggerChange && previous !== value) {
      const changeEvent = new Event("change", { bubbles: true });
      ctrl.selectEl.dispatchEvent(changeEvent);
    }
  }
  // Update visual
  ctrl.options.forEach((opt, i) => {
    opt.classList.toggle("active", i === idx);
    opt.classList.toggle("before", i <= idx);
  });
  ctrl.sliderEl.dataset.index = String(idx);
  updateScaleLabel(field, value);
}

function setScaleDisabled(field, disabled) {
  const ctrl = scaleControls.get(field);
  if (!ctrl) return;
  ctrl.sliderEl.classList.toggle("disabled", !!disabled);
}

function initScaleControls() {
  document.querySelectorAll(".scale-field").forEach((node) => {
    const field = node.getAttribute("data-field");
    const values = (node.getAttribute("data-values") || "").split(",").map((s) => s.trim());
    const labelPrefix = node.getAttribute("data-label") || field;
    const labelEl = node.querySelector("label");
    const sliderEl = node.querySelector(".scale-slider");
    const selectEl = node.querySelector("select");
    if (!field || !values.length || !labelEl || !sliderEl || !selectEl) return;

    sliderEl.style.setProperty("--count", String(values.length));
    sliderEl.innerHTML = "";
    const options = values.map((val, i) => {
      const div = document.createElement("div");
      div.className = "scale-option";
      div.setAttribute("role", "button");
      div.setAttribute("tabindex", "0");
      div.dataset.index = String(i);
      div.dataset.value = val;
      div.title = prettyValue(field, val);
      div.addEventListener("click", () => setScaleValue(field, val, { triggerChange: true }));
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setScaleValue(field, val, { triggerChange: true });
        }
      });
      sliderEl.appendChild(div);
      return div;
    });

    scaleControls.set(field, {
      values,
      labelEl,
      labelPrefix,
      sliderEl,
      selectEl,
      options,
    });

    // Initialize from select current value
    setScaleValue(field, selectEl.value || values[0]);
  });
}

// Initialize sliders after helpers are defined
initScaleControls();
