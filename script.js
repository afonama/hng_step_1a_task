const STATUS = { PENDING: "pending", IN_PROGRESS: "in-progress", DONE: "done" };
const STATUS_LABELS = {
  [STATUS.PENDING]: "Pending", [STATUS.IN_PROGRESS]: "In Progress",
  [STATUS.DONE]: "Done", overdue: "Overdue"
};
const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const ALLOWED_NEXT = {
  [STATUS.PENDING]: [STATUS.IN_PROGRESS],
  [STATUS.IN_PROGRESS]: [STATUS.PENDING, STATUS.DONE],
  [STATUS.DONE]: [STATUS.IN_PROGRESS],
};

/* ── Seed Data ───────────────────────────────────── */
function seedData() {
  const d = (off) => { const dt = new Date(); dt.setUTCHours(17,0,0,0); dt.setUTCDate(dt.getUTCDate()+off); return dt.toISOString().slice(0,10); };
  return [
    { id: uid(), title: "Review patient intake forms", description: "Check completeness of all new intake submissions from last week. Flag any missing consent signatures.", due: d(2), tags: ["admin","health"], priority: "high", status: STATUS.PENDING, createdAt: new Date().toISOString() },
    { id: uid(), title: "Schedule team briefing on Q3 outcomes", description: "Coordinate with all department heads. Send calendar invites at least 48 hours in advance.", due: d(5), tags: ["meetings","planning"], priority: "medium", status: STATUS.IN_PROGRESS, createdAt: new Date().toISOString() },
    { id: uid(), title: "Submit monthly equipment audit report", description: "Compile findings from ward checks. Attach supporting photos to the final submission.", due: d(-1), tags: ["audit","reports"], priority: "critical", status: STATUS.PENDING, createdAt: new Date().toISOString() },
    { id: uid(), title: "Update caregiver onboarding checklist", description: "Reflect new compliance requirements effective from this quarter.", due: d(14), tags: ["onboarding","compliance"], priority: "low", status: STATUS.DONE, createdAt: new Date().toISOString() },
  ];
}

/* ── State ────────────────────────────────────────── */
let tasks = [];
let expandedCards = new Set();

function loadTasks() {
  try { const raw = localStorage.getItem("taskboard_tasks_v2"); tasks = raw ? JSON.parse(raw) : seedData(); }
  catch { tasks = seedData(); }
  // migrate: add priority if missing
  tasks.forEach(t => { if (!t.priority) t.priority = "medium"; });
}
function saveTasks() { localStorage.setItem("taskboard_tasks_v2", JSON.stringify(tasks)); }

/* ── Utilities ────────────────────────────────────── */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function countdown(isoDate) {
  const now = Date.now();
  const dueUTC = new Date(isoDate + "T17:00:00Z").getTime();
  const diffMs = dueUTC - now;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMs <= 0) {
    const m = Math.abs(diffMins), h = Math.abs(diffHrs), dd = Math.abs(diffDays);
    if (m < 60) return { text: `${m} min${m!==1?"s":""} overdue`, cls: "urgent" };
    if (h < 24) return { text: `${h} hr${h!==1?"s":""} overdue`, cls: "urgent" };
    return { text: `${dd} day${dd!==1?"s":""} overdue`, cls: "urgent" };
  }
  if (diffMins < 60) return { text: `${diffMins} min${diffMins!==1?"s":""} to go`, cls: "warn" };
  if (diffHrs < 24) return { text: `${diffHrs} hr${diffHrs!==1?"s":""} to go`, cls: "warn" };
  if (diffDays === 1) return { text: "1 day to go", cls: "ok" };
  if (diffDays <= 3) return { text: `${diffDays} days to go`, cls: "warn" };
  return { text: `${diffDays} days to go`, cls: "ok" };
}

function relativeCreated(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDueDate(isoDate) {
  const dt = new Date(isoDate + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function normalizeTags(raw) {
  return raw.split(",").map(t => t.trim().toLowerCase().replace(/[^a-z\s\-]/g,"")).filter(Boolean);
}
function isNumberOnly(str) { return /^\s*[\d\s]+\s*$/.test(str); }
function announce(msg) { document.getElementById("liveRegion").textContent = msg; }

/* ── DOM Refs ─────────────────────────────────────── */
const taskGrid = document.getElementById("taskGrid");
const emptyState = document.getElementById("emptyState");
const btnOpenModal = document.getElementById("btnOpenModal");
const modalBackdrop = document.getElementById("modalBackdrop");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelModal = document.getElementById("btnCancelModal");
const taskForm = document.getElementById("taskForm");
const modalTitle = document.getElementById("modalTitle");
const btnSubmitForm = document.getElementById("btnSubmitForm");
const inputTitle = document.getElementById("inputTitle");
const inputDesc = document.getElementById("inputDesc");
const inputDue = document.getElementById("inputDue");
const inputPriority = document.getElementById("inputPriority");
const inputTags = document.getElementById("inputTags");
const titleError = document.getElementById("titleError");
const descError = document.getElementById("descError");
const dueError = document.getElementById("dueError");
const tagsError = document.getElementById("tagsError");
const deleteBackdrop = document.getElementById("deleteBackdrop");
const btnCancelDelete = document.getElementById("btnCancelDelete");
const btnConfirmDelete = document.getElementById("btnConfirmDelete");
const deleteTaskName = document.getElementById("deleteTaskName");

let pendingDeleteId = null;

/* ── Render ───────────────────────────────────────── */
function render() {
  taskGrid.innerHTML = "";
  if (tasks.length === 0) { emptyState.hidden = false; return; }
  emptyState.hidden = true;

  tasks.forEach(task => {
    const isOverdue = task.status !== STATUS.DONE && new Date(task.due + "T17:00:00Z").getTime() < Date.now();
    const displayStatus = isOverdue ? "overdue" : task.status;
    const isExpanded = expandedCards.has(task.id);
    const { text: cdText, cls: cdCls } = task.status === STATUS.DONE
      ? { text: "Completed", cls: "done" }
      : countdown(task.due);

    const article = document.createElement("article");
    article.className = "task-card";
    article.dataset.id = task.id;
    article.dataset.status = displayStatus;
    article.dataset.priority = task.priority || "medium";
    article.setAttribute("aria-label", `Task: ${task.title}, ${STATUS_LABELS[displayStatus]}, ${PRIORITY_LABELS[task.priority||"medium"]} priority`);
    article.setAttribute("tabindex", "0");

    const tagsHTML = (task.tags||[]).map(t => `<span class="task-tag">#${t}</span>`).join("");

    const statusBtnsHTML = ["pending","in-progress","done"].map(s => {
      const isCurrent = s === task.status;
      const allowed = ALLOWED_NEXT[task.status]?.includes(s);
      const disabled = isCurrent || !allowed;
      const activeClass = isCurrent ? " status-bar__btn--active" : "";
      const titleAttr = !isCurrent && !allowed ? ` title="${getBlockedMsg(task.status, s)}"` : "";
      return `<button class="status-bar__btn${activeClass}" data-target="${s}"${disabled ? " disabled aria-disabled=\"true\"" : ""}${titleAttr} aria-label="Set status to ${STATUS_LABELS[s]}">${STATUS_LABELS[s]}</button>`;
    }).join("");

    const priorityBtnsHTML = ["low","medium","high","critical"].map(p => {
      const isCurrent = (task.priority||"medium") === p;
      return `<button class="priority-bar__btn${isCurrent?" priority-bar__btn--active":""}" data-p="${p}" aria-label="Set priority to ${PRIORITY_LABELS[p]}"${isCurrent?" aria-current=\"true\"":""}>${PRIORITY_LABELS[p]}</button>`;
    }).join("");

    article.innerHTML = `
      <div class="task-card__inner">
        <header class="task-card__header">
          <div class="task-card__title-row">
            <label class="task-card__checkbox-label">
              <input class="task-card__checkbox" type="checkbox" ${task.status===STATUS.DONE?"checked":""} aria-label="Mark &quot;${task.title}&quot; ${task.status===STATUS.DONE?"incomplete":"complete"}" />
              <span class="task-card__checkbox-custom" aria-hidden="true"></span>
            </label>
            <h3 class="task-card__title">${escHTML(task.title)}</h3>
          </div>
          <div class="task-card__actions">
            <button class="task-card__action-btn task-card__action-btn--expand" aria-expanded="${isExpanded}" aria-label="${isExpanded?"Collapse":"Expand"} task details">
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
            <button class="task-card__action-btn task-card__action-btn--edit" aria-label="Edit task" data-test-id="test-todo-edit-btn">
              <i class="bi bi-pencil" aria-hidden="true"></i>
            </button>
            <button class="task-card__action-btn task-card__action-btn--delete" aria-label="Delete task">
              <i class="bi bi-trash3" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <div class="task-card__meta">
          <span class="task-card__priority-badge" aria-label="Priority: ${PRIORITY_LABELS[task.priority||"medium"]}">
            <i class="bi bi-flag-fill" aria-hidden="true" style="font-size:.6rem"></i>
            ${PRIORITY_LABELS[task.priority||"medium"]}
          </span>
          <span class="task-card__status-pill" aria-label="Status: ${STATUS_LABELS[displayStatus]}">
            <span class="task-card__status-dot" aria-hidden="true"></span>
            <span class="task-card__status-text">${STATUS_LABELS[displayStatus]}</span>
          </span>
          <time class="task-card__due" datetime="${task.due}" aria-label="Due ${formatDueDate(task.due)}">Due: ${formatDueDate(task.due)}</time>
        </div>

        <div class="task-card__countdown-row" aria-live="polite">
          <i class="bi ${task.status===STATUS.DONE?"bi-check2-circle":"bi-clock"}" aria-hidden="true"></i>
          <span class="task-card__countdown task-card__countdown--${cdCls}">${cdText}${task.status===STATUS.DONE?" ✓":""}</span>
        </div>

        <div class="task-card__progress" aria-hidden="true"><div class="task-card__progress-fill"></div></div>

        <div class="task-card__collapsible" data-expanded="${isExpanded}" aria-hidden="${!isExpanded}">
          <div class="task-card__collapsible-inner">
            <p class="task-card__desc">${escHTML(task.description||"")}</p>
            <div class="task-card__tags" aria-label="Tags">${tagsHTML}</div>
            <span class="task-card__time-detail">Created ${relativeCreated(task.createdAt)}</span>

            <div class="task-card__priority-bar">
              <span class="priority-bar__label">Priority:</span>
              <div class="priority-bar__btns" role="group" aria-label="Change task priority">${priorityBtnsHTML}</div>
            </div>

            <div class="task-card__status-bar">
              <span class="status-bar__label">Move to:</span>
              <div class="status-bar__btns" role="group" aria-label="Change task status">${statusBtnsHTML}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="task-card__edit-form" data-active="false" data-test-id="test-todo-edit-form" aria-label="Edit task form" role="form">
        <div class="edit-form__group">
          <label class="edit-form__label" for="edit-title-${task.id}">Title <span aria-hidden="true">*</span></label>
          <input class="edit-form__input" type="text" id="edit-title-${task.id}" value="${escAttr(task.title)}" data-test-id="test-todo-edit-title-input" aria-required="true" aria-describedby="edit-title-err-${task.id}" />
          <span class="edit-form__error" id="edit-title-err-${task.id}" role="alert" aria-live="assertive"></span>
        </div>
        <div class="edit-form__group">
          <label class="edit-form__label" for="edit-desc-${task.id}">Description <span class="edit-form__label--optional">(optional)</span></label>
          <textarea class="edit-form__input edit-form__input--textarea" id="edit-desc-${task.id}" rows="2" data-test-id="test-todo-edit-desc-input" aria-describedby="edit-desc-err-${task.id}">${escHTML(task.description||"")}</textarea>
          <span class="edit-form__error" id="edit-desc-err-${task.id}" role="alert" aria-live="assertive"></span>
        </div>
        <div class="edit-form__group">
          <label class="edit-form__label" for="edit-due-${task.id}">Due date <span aria-hidden="true">*</span></label>
          <input class="edit-form__input" type="date" id="edit-due-${task.id}" value="${task.due}" data-test-id="test-todo-edit-due-input" aria-required="true" aria-describedby="edit-due-err-${task.id}" />
          <span class="edit-form__error" id="edit-due-err-${task.id}" role="alert" aria-live="assertive"></span>
        </div>
        <div class="edit-form__group">
          <label class="edit-form__label" for="edit-tags-${task.id}">Tags <span class="edit-form__label--optional">(comma-separated)</span></label>
          <input class="edit-form__input" type="text" id="edit-tags-${task.id}" value="${escAttr((task.tags||[]).join(", "))}" data-test-id="test-todo-edit-tags-input" aria-describedby="edit-tags-err-${task.id}" />
          <span class="edit-form__error" id="edit-tags-err-${task.id}" role="alert" aria-live="assertive"></span>
        </div>
        <div class="edit-form__actions">
          <button type="button" class="edit-form__btn-cancel" data-test-id="test-todo-edit-cancel" aria-label="Cancel editing">Cancel</button>
          <button type="button" class="edit-form__btn-save" data-test-id="test-todo-edit-save" aria-label="Save changes">Save</button>
        </div>
      </div>
    `;

    taskGrid.appendChild(article);
  });

  bindCardEvents();
}

function escHTML(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function getBlockedMsg(current, target) {
  if (current === STATUS.PENDING && target === STATUS.DONE) return "Move to In Progress before marking Done.";
  return "This transition is not allowed.";
}

/* ── Card Events ──────────────────────────────────── */
function bindCardEvents() {

  /* Expand / Collapse */
  taskGrid.querySelectorAll(".task-card__action-btn--expand").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest("article").dataset.id;
      const collapsible = btn.closest("article").querySelector(".task-card__collapsible");
      const isExp = expandedCards.has(id);
      if (isExp) { expandedCards.delete(id); } else { expandedCards.add(id); }
      collapsible.dataset.expanded = !isExp;
      collapsible.setAttribute("aria-hidden", isExp);
      btn.setAttribute("aria-expanded", !isExp);
      btn.setAttribute("aria-label", (!isExp ? "Collapse" : "Expand") + " task details");
    });
  });

  /* Edit (inline) */
  taskGrid.querySelectorAll(".task-card__action-btn--edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const article = btn.closest("article");
      const editForm = article.querySelector(".task-card__edit-form");
      const isActive = editForm.dataset.active === "true";
      // Close all other edit forms first
      taskGrid.querySelectorAll(".task-card__edit-form[data-active='true']").forEach(f => { f.dataset.active = "false"; });
      if (!isActive) {
        editForm.dataset.active = "true";
        const titleInput = editForm.querySelector("[data-test-id='test-todo-edit-title-input']");
        titleInput.focus();
        announce("Edit mode opened for task.");
      } else {
        announce("Edit mode closed.");
      }
    });
  });

  /* Edit Cancel */
  taskGrid.querySelectorAll(".edit-form__btn-cancel").forEach(btn => {
    btn.addEventListener("click", () => {
      const article = btn.closest("article");
      const id = article.dataset.id;
      const task = tasks.find(t => t.id === id);
      const editForm = article.querySelector(".task-card__edit-form");
      // Reset values
      editForm.querySelector("[data-test-id='test-todo-edit-title-input']").value = task.title;
      editForm.querySelector("[data-test-id='test-todo-edit-desc-input']").value = task.description || "";
      editForm.querySelector("[data-test-id='test-todo-edit-due-input']").value = task.due;
      editForm.querySelector("[data-test-id='test-todo-edit-tags-input']").value = (task.tags||[]).join(", ");
      editForm.querySelectorAll(".edit-form__error").forEach(e => e.textContent = "");
      editForm.dataset.active = "false";
      announce("Edit cancelled.");
    });
  });

  /* Edit Save */
  taskGrid.querySelectorAll(".edit-form__btn-save").forEach(btn => {
    btn.addEventListener("click", () => {
      const article = btn.closest("article");
      const id = article.dataset.id;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const editForm = article.querySelector(".task-card__edit-form");
      const titleInput = editForm.querySelector("[data-test-id='test-todo-edit-title-input']");
      const descInput = editForm.querySelector("[data-test-id='test-todo-edit-desc-input']");
      const dueInput = editForm.querySelector("[data-test-id='test-todo-edit-due-input']");
      const tagsInput = editForm.querySelector("[data-test-id='test-todo-edit-tags-input']");

      // Clear errors
      editForm.querySelectorAll(".edit-form__error").forEach(e => e.textContent = "");

      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      const due = dueInput.value;
      const tags = tagsInput.value;
      let valid = true;

      if (!title) {
        editForm.querySelector(`#edit-title-err-${id}`).textContent = "Title is required.";
        valid = false;
      } else if (isNumberOnly(title)) {
        editForm.querySelector(`#edit-title-err-${id}`).textContent = "Title must contain text, not just numbers.";
        valid = false;
      }
      // Duplicate check
      const dup = tasks.find(t => t.title.trim().toLowerCase() === title.toLowerCase() && t.id !== id);
      if (dup && valid) {
        editForm.querySelector(`#edit-title-err-${id}`).textContent = "A task with this title already exists.";
        valid = false;
      }
      if (desc && isNumberOnly(desc)) {
        editForm.querySelector(`#edit-desc-err-${id}`).textContent = "Description must contain text.";
        valid = false;
      }
      if (!due) {
        editForm.querySelector(`#edit-due-err-${id}`).textContent = "Due date is required.";
        valid = false;
      }
      if (tags.trim()) {
        const parsed = normalizeTags(tags);
        if (parsed.some(t => isNumberOnly(t) || /\d/.test(t))) {
          editForm.querySelector(`#edit-tags-err-${id}`).textContent = "Tags must contain only letters.";
          valid = false;
        }
      }

      if (!valid) return;

      task.title = title;
      task.description = desc;
      task.due = due;
      task.tags = normalizeTags(tags);
      saveTasks();
      render();
      showToast("Task updated.", "ok");
      announce("Task saved successfully.");
    });
  });

  /* Delete */
  taskGrid.querySelectorAll(".task-card__action-btn--delete").forEach(btn => {
    btn.addEventListener("click", () => {
      const article = btn.closest("article");
      pendingDeleteId = article.dataset.id;
      const task = tasks.find(t => t.id === pendingDeleteId);
      deleteTaskName.textContent = task ? `"${task.title}"` : "this task";
      deleteBackdrop.hidden = false;
      btnConfirmDelete.focus();
    });
  });

  /* Checkbox */
  taskGrid.querySelectorAll(".task-card__checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.closest("article").dataset.id;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      if (cb.checked) {
        if (task.status === STATUS.PENDING) {
          cb.checked = false;
          showToast("Move to In Progress before marking done.", "warn");
          return;
        }
        task.status = STATUS.DONE;
        announce(`${task.title} marked complete.`);
      } else {
        task.status = STATUS.IN_PROGRESS;
        announce(`${task.title} moved back to In Progress.`);
      }
      saveTasks(); render();
    });
  });

  /* Status bar */
  taskGrid.querySelectorAll(".status-bar__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest("article").dataset.id;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const target = btn.dataset.target;
      if (!ALLOWED_NEXT[task.status]?.includes(target)) {
        showToast(getBlockedMsg(task.status, target), "warn"); return;
      }
      task.status = target;
      saveTasks(); render();
      showToast(`Moved to ${STATUS_LABELS[target]}.`, "ok");
      announce(`Task status changed to ${STATUS_LABELS[target]}.`);
    });
  });

  /* Priority bar */
  taskGrid.querySelectorAll(".priority-bar__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest("article").dataset.id;
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const p = btn.dataset.p;
      task.priority = p;
      saveTasks(); render();
      showToast(`Priority set to ${PRIORITY_LABELS[p]}.`, "info");
      announce(`Priority changed to ${PRIORITY_LABELS[p]}.`);
    });
  });

  /* Keyboard: Enter to expand */
  taskGrid.querySelectorAll(".task-card").forEach(card => {
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === card) {
        card.querySelector(".task-card__action-btn--expand")?.click();
      }
    });
  });
}

/* ── Create Modal ─────────────────────────────────── */
function openCreateModal() {
  taskForm.reset();
  clearErrors();
  modalTitle.textContent = "New Task";
  btnSubmitForm.textContent = "Create Task";
  inputDue.min = new Date().toISOString().slice(0,10);
  modalBackdrop.hidden = false;
  inputTitle.focus();
}
function closeModal() {
  modalBackdrop.hidden = true;
  taskForm.reset();
  clearErrors();
}
function clearErrors() {
  titleError.textContent = ""; descError.textContent = "";
  dueError.textContent = ""; tagsError.textContent = "";
}
function validate(title, desc, due, tags) {
  let valid = true;
  if (!title.trim()) { titleError.textContent = "Task title is required."; valid = false; }
  else if (isNumberOnly(title)) { titleError.textContent = "Title must contain descriptive text."; valid = false; }
  const dup = tasks.find(t => t.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (dup && !titleError.textContent) { titleError.textContent = "A task with this title already exists."; valid = false; }
  if (desc.trim() && isNumberOnly(desc)) { descError.textContent = "Description must contain text."; valid = false; }
  if (!due) { dueError.textContent = "Please pick a due date."; valid = false; }
  if (tags.trim()) {
    const parsed = normalizeTags(tags);
    if (parsed.some(t => isNumberOnly(t) || /\d/.test(t))) { tagsError.textContent = "Tags must contain only letters."; valid = false; }
  }
  return valid;
}

taskForm.addEventListener("submit", (e) => {
  e.preventDefault(); clearErrors();
  const title = inputTitle.value.trim();
  const desc = inputDesc.value.trim();
  const due = inputDue.value;
  const tags = inputTags.value;
  const priority = inputPriority.value;
  if (!validate(title, desc, due, tags)) return;
  tasks.unshift({
    id: uid(), title, description: desc, due,
    tags: normalizeTags(tags), priority,
    status: STATUS.PENDING, createdAt: new Date().toISOString()
  });
  saveTasks(); render(); closeModal();
  showToast("Task created!", "ok");
  announce("New task created.");
});

/* ── Delete ────────────────────────────────────────── */
btnConfirmDelete.addEventListener("click", () => {
  if (!pendingDeleteId) return;
  tasks = tasks.filter(t => t.id !== pendingDeleteId);
  pendingDeleteId = null;
  saveTasks(); render();
  deleteBackdrop.hidden = true;
  showToast("Task deleted.", "warn");
  announce("Task deleted.");
});
btnCancelDelete.addEventListener("click", () => { pendingDeleteId = null; deleteBackdrop.hidden = true; });

/* ── Modal Events ─────────────────────────────────── */
btnOpenModal.addEventListener("click", openCreateModal);
btnCloseModal.addEventListener("click", closeModal);
btnCancelModal.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });
deleteBackdrop.addEventListener("click", (e) => { if (e.target === deleteBackdrop) { pendingDeleteId = null; deleteBackdrop.hidden = true; }});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalBackdrop.hidden) closeModal();
    if (!deleteBackdrop.hidden) { pendingDeleteId = null; deleteBackdrop.hidden = true; }
    // Close any open edit forms
    taskGrid.querySelectorAll(".task-card__edit-form[data-active='true']").forEach(f => { f.dataset.active = "false"; });
  }
});

/* ── Live countdown (every 30s) ───────────────────── */
setInterval(() => render(), 30000);

/* ── Toast ─────────────────────────────────────────── */
function showToast(msg, type = "ok") {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "toast"; toast.setAttribute("role","status"); toast.setAttribute("aria-live","polite");
  const colors = { ok: "#2d7d46", warn: "#c0392b", info: "#2563a8" };
  Object.assign(toast.style, {
    position:"fixed", bottom:"1.5rem", left:"50%", transform:"translateX(-50%)",
    background: colors[type]||colors.ok, color:"#fff", fontFamily:"var(--font-body)",
    fontSize:".86rem", fontWeight:"600", padding:".6rem 1.3rem", borderRadius:"100px",
    boxShadow:"0 4px 20px rgba(0,0,0,.18)", zIndex:"9999", whiteSpace:"nowrap",
    opacity:"0", transition:"opacity .2s ease"
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; });
  setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2800);
}

/* ── Boot ──────────────────────────────────────────── */
loadTasks();
render();