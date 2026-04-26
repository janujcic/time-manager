let currentTaskName = "";
let currentTaskNotes = "";
let snConfig = { enabled: false, instanceUrl: "", defaultRateTypeSysId: "", notesSuggestionWeeks: 4 };
let snLookupCache = { fetchedAtMs: 0, tasks: [], categories: [], timeCodes: [], rateTypes: [] };
let mainAllBlocks = [];

const taskNameError = document.getElementById("task-name-error");
const enterStartTask = document.querySelector(".enter-start-task");
const runningTask = document.querySelector(".running-task");
const runningTaskMessage = document.getElementById("running-task-message");
const runningTaskTitle = document.getElementById("running-task-title");
const runningTaskNotes = document.getElementById("running-task-notes");
const elapsedTimeDisplay = document.getElementById("elapsed-time");
const startButton = document.getElementById("start-button");
const resumeButton = document.getElementById("resume-button");
const stopButton = document.getElementById("stop-button");
const finishButton = document.getElementById("finish-button");
const mainSnAssignmentWrap = document.getElementById("main-sn-assignment-wrap");
const mainSnAssignmentInput = document.getElementById("main-sn-assignment-input");
const mainSnAssignmentList = document.getElementById("main-sn-assignment-list");
const mainSnAssignmentError = document.getElementById("main-sn-assignment-error");
const mainSnCodeWrap = document.getElementById("main-sn-code-wrap");
const mainSnCodeSelect = document.getElementById("main-sn-code-select");
const mainSnCodeError = document.getElementById("main-sn-code-error");
const mainSnRateTypeWrap = document.getElementById("main-sn-rate-type-wrap");
const mainSnRateTypeSelect = document.getElementById("main-sn-rate-type-select");
const mainSnRateTypeError = document.getElementById("main-sn-rate-type-error");
const mainSnNotesWrap = document.getElementById("main-sn-notes-wrap");
const mainSnNotesInput = document.getElementById("main-sn-notes-input");
const mainSnNotesSuggestionList = document.getElementById("main-sn-notes-suggestion-list");
const mainSnNotesError = document.getElementById("main-sn-notes-error");

function showTaskNameError(message) {
  mainSnAssignmentError.textContent = message;
  mainSnAssignmentInput.classList.add("input-error");
}

function clearTaskNameError() {
  taskNameError.textContent = "";
  mainSnAssignmentError.textContent = "";
}

function showMainAssignmentError(message) {
  mainSnAssignmentError.textContent = message;
  mainSnAssignmentInput.classList.add("input-error");
}

function showMainCodeError(message) {
  mainSnCodeError.textContent = message;
  mainSnCodeSelect.classList.add("input-error");
}

function showMainNotesError(message) {
  mainSnNotesError.textContent = message;
  mainSnNotesInput.classList.add("input-error");
}

function showMainSnRateTypeError(message) {
  mainSnRateTypeError.textContent = message || "";
  mainSnRateTypeSelect.classList.add("input-error");
}

function clearMainSnError() {
  mainSnAssignmentInput.classList.remove("input-error");
  mainSnCodeSelect.classList.remove("input-error");
  mainSnRateTypeSelect.classList.remove("input-error");
  mainSnNotesInput.classList.remove("input-error");
  mainSnAssignmentError.textContent = "";
  mainSnCodeError.textContent = "";
  mainSnNotesError.textContent = "";
  mainSnRateTypeError.textContent = "";
  taskNameError.textContent = "";
}

function normalizeNotesSuggestionWeeks(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 4;
  }
  return Math.min(52, Math.max(1, Math.floor(numeric)));
}

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function formatTaskTitle(taskName) {
  const trimmed = String(taskName || "").trim();
  if (!trimmed) {
    return "No active task";
  }
  if (trimmed.length <= 70) {
    return trimmed;
  }
  return `${trimmed.slice(0, 67)}...`;
}

function updateRunningMessage(isRunning) {
  runningTaskTitle.textContent = formatTaskTitle(currentTaskName);
  runningTaskTitle.title = currentTaskName || "";
  const trimmedNotes = String(currentTaskNotes || "").trim();
  if (trimmedNotes) {
    runningTaskNotes.textContent = `Extra notes: ${trimmedNotes}`;
    runningTaskNotes.style.display = "block";
  } else {
    runningTaskNotes.textContent = "";
    runningTaskNotes.style.display = "none";
  }
  runningTaskMessage.textContent = isRunning ? "Status: Running" : "Status: Paused";
}

function showRunningState(isRunning) {
  enterStartTask.style.display = "none";
  startButton.style.display = "none";
  runningTask.style.display = "block";

  resumeButton.style.display = isRunning ? "none" : "inline-block";
  stopButton.style.display = isRunning ? "inline-block" : "none";
  finishButton.style.display = "inline-block";
  updateRunningMessage(isRunning);
}

function showRegistrationState() {
  runningTask.style.display = "none";
  enterStartTask.style.display = "block";
  startButton.style.display = "inline-block";
  elapsedTimeDisplay.textContent = "0h 0m 0s";
  currentTaskName = "";
  currentTaskNotes = "";
  runningTaskNotes.textContent = "";
  runningTaskNotes.style.display = "none";
  mainSnNotesInput.value = "";
  renderMainRateTypeOptions(snConfig.defaultRateTypeSysId || "");
  refreshMainCommentSuggestions();
  clearMainSnError();
}

function updateMainSnVisibility() {
  mainSnAssignmentWrap.style.display = "flex";
  mainSnCodeWrap.style.display = snConfig.enabled ? "flex" : "none";
  mainSnRateTypeWrap.style.display = snConfig.enabled ? "flex" : "none";
  mainSnNotesWrap.style.display = snConfig.enabled ? "flex" : "none";
}

function getAllAssignmentOptions() {
  const taskOptions = (Array.isArray(snLookupCache.tasks) ? snLookupCache.tasks : []).map((task) => ({
    id: `task:${task.sys_id}`,
    label: `[Task] ${task.number || task.sys_id} - ${task.short_description || ""}`,
    kind: "task",
    data: task,
  }));

  const categoryOptions = (Array.isArray(snLookupCache.categories) ? snLookupCache.categories : [])
    .filter((category) => category.value !== "task_work")
    .map((category) => ({
      id: `category:${category.sys_id}`,
      label: `[Category] ${category.label || category.value} (${category.value || ""})`,
      kind: "category",
      data: category,
    }));

  return [...taskOptions, ...categoryOptions];
}

function filterAssignmentOptions(queryText) {
  const query = String(queryText || "").trim().toLowerCase();
  if (!query) {
    return getAllAssignmentOptions();
  }

  return getAllAssignmentOptions().filter((item) => {
    if (item.kind === "task") {
      const haystack = `${item.data.number || ""} ${item.data.short_description || ""}`.toLowerCase();
      return haystack.includes(query);
    }

    const haystack = `${item.data.label || ""} ${item.data.value || ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderMainAssignmentOptions(selectedLabel = "") {
  const query = mainSnAssignmentInput.value;
  const options = filterAssignmentOptions(query);
  mainSnAssignmentList.innerHTML = "";

  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.label;
    mainSnAssignmentList.appendChild(option);
  });

  if (selectedLabel) {
    mainSnAssignmentInput.value = selectedLabel;
  }
}

function renderMainCodeOptions(selectedCodeSysId = "") {
  const timeCodes = Array.isArray(snLookupCache.timeCodes) ? [...snLookupCache.timeCodes] : [];
  timeCodes.sort((a, b) => {
    const codeA = String(a?.u_time_card_code || "").toLowerCase();
    const codeB = String(b?.u_time_card_code || "").toLowerCase();
    const codeCompare = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: "base" });
    if (codeCompare !== 0) {
      return codeCompare;
    }
    const descA = String(a?.u_description || "").toLowerCase();
    const descB = String(b?.u_description || "").toLowerCase();
    return descA.localeCompare(descB, undefined, { numeric: true, sensitivity: "base" });
  });

  mainSnCodeSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = timeCodes.length === 0 ? "No time codes available" : "Select time code";
  mainSnCodeSelect.appendChild(placeholder);

  timeCodes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code.sys_id;
    option.textContent = code.label || code.u_time_card_code || code.sys_id;
    mainSnCodeSelect.appendChild(option);
  });

  if (selectedCodeSysId) {
    mainSnCodeSelect.value = selectedCodeSysId;
  }
}

function renderMainRateTypeOptions(selectedRateTypeSysId = "") {
  const rateTypes = Array.isArray(snLookupCache.rateTypes) ? [...snLookupCache.rateTypes] : [];
  rateTypes.sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  mainSnRateTypeSelect.innerHTML = "";
  if (rateTypes.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "No rate types available";
    mainSnRateTypeSelect.appendChild(placeholder);
  } else if (!selectedRateTypeSysId) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select rate type";
    mainSnRateTypeSelect.appendChild(placeholder);
  }

  rateTypes.forEach((rateType) => {
    const option = document.createElement("option");
    option.value = rateType.sys_id;
    option.textContent = rateType.label || rateType.name || rateType.sys_id;
    mainSnRateTypeSelect.appendChild(option);
  });

  if (selectedRateTypeSysId) {
    mainSnRateTypeSelect.value = selectedRateTypeSysId;
  }
}

function getSelectedAssignment() {
  const typedValue = String(mainSnAssignmentInput.value || "").trim();
  if (!typedValue) {
    return null;
  }

  return getAllAssignmentOptions().find((item) => item.label === typedValue) || null;
}

function getCategoryKeyFromAssignment(assignment) {
  if (!assignment || assignment.kind !== "category") {
    return "";
  }
  const sysId = String(assignment.data?.sys_id || "").trim();
  if (sysId) {
    return `sys:${sysId}`;
  }
  const categoryValue = String(assignment.data?.value || "").trim();
  return categoryValue ? `value:${categoryValue}` : "";
}

function getCategoryKeyFromBlock(block) {
  if (!block || block.snSelectionType !== "category") {
    return "";
  }
  const sysId = String(block.snCategorySysId || "").trim();
  if (sysId) {
    return `sys:${sysId}`;
  }
  const categoryValue = String(block.snCategoryValue || "").trim();
  return categoryValue ? `value:${categoryValue}` : "";
}

function buildCategoryNoteSuggestions(blocks, categoryKey, queryText, weeks) {
  if (!categoryKey) {
    return [];
  }

  const normalizedQuery = String(queryText || "").trim().toLowerCase();
  const cutoffMs = Date.now() - normalizeNotesSuggestionWeeks(weeks) * 7 * 24 * 60 * 60 * 1000;
  const dedupeByText = new Map();

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (getCategoryKeyFromBlock(block) !== categoryKey) {
      continue;
    }
    const blockStartMs = Number(block.startMs);
    if (!Number.isFinite(blockStartMs) || blockStartMs < cutoffMs) {
      continue;
    }
    const note = String(block.snCommentText || "").trim();
    if (!note) {
      continue;
    }
    if (normalizedQuery && !note.toLowerCase().includes(normalizedQuery)) {
      continue;
    }

    const dedupeKey = note.toLowerCase();
    const existing = dedupeByText.get(dedupeKey);
    if (!existing || blockStartMs > existing.lastUsedMs) {
      dedupeByText.set(dedupeKey, { text: note, lastUsedMs: blockStartMs });
    }
  }

  return Array.from(dedupeByText.values())
    .sort((a, b) => b.lastUsedMs - a.lastUsedMs || a.text.localeCompare(b.text))
    .map((item) => item.text);
}

function renderMainCommentSuggestions(suggestions) {
  if (!mainSnNotesSuggestionList) {
    return;
  }
  mainSnNotesSuggestionList.innerHTML = "";
  for (const suggestion of suggestions) {
    const option = document.createElement("option");
    option.value = suggestion;
    mainSnNotesSuggestionList.appendChild(option);
  }
}

function refreshMainCommentSuggestions() {
  const selectedAssignment = getSelectedAssignment();
  const categoryKey = getCategoryKeyFromAssignment(selectedAssignment);
  if (!categoryKey) {
    renderMainCommentSuggestions([]);
    return;
  }

  const suggestions = buildCategoryNoteSuggestions(
    mainAllBlocks,
    categoryKey,
    mainSnNotesInput.value,
    snConfig.notesSuggestionWeeks
  );
  renderMainCommentSuggestions(suggestions);
}

function loadMainBlocksForSuggestions() {
  chrome.runtime.sendMessage({ action: "getTimeBlocks" }, (response) => {
    if (response?.status === "success") {
      mainAllBlocks = Array.isArray(response.data) ? response.data : [];
    } else {
      mainAllBlocks = [];
    }
    refreshMainCommentSuggestions();
  });
}

function getSelectedCodeData() {
  const selectedCodeSysId = mainSnCodeSelect.value;
  if (!selectedCodeSysId) {
    return null;
  }

  const timeCodes = Array.isArray(snLookupCache.timeCodes) ? snLookupCache.timeCodes : [];
  return timeCodes.find((item) => item.sys_id === selectedCodeSysId) || null;
}

function getAssignmentLabelFromTimerData(timerData) {
  if (!timerData) {
    return "";
  }

  if (timerData.snSelectionType === "task" && timerData.snTaskSysId) {
    const matched = getAllAssignmentOptions().find((item) => item.id === `task:${timerData.snTaskSysId}`);
    return matched?.label || timerData.savedTaskName || "";
  }

  if (timerData.snSelectionType === "category" && timerData.snCategorySysId) {
    const matched = getAllAssignmentOptions().find(
      (item) => item.id === `category:${timerData.snCategorySysId}`
    );
    return matched?.label || timerData.savedTaskName || "";
  }

  return timerData.savedTaskName || "";
}

function loadMainSnConfigAndLookups() {
  chrome.runtime.sendMessage({ action: "servicenow/getConfig" }, (configResponse) => {
    if (configResponse?.status === "success") {
      snConfig = configResponse.data || {
        enabled: false,
        instanceUrl: "",
        defaultRateTypeSysId: "",
        notesSuggestionWeeks: 4,
      };
      snConfig.defaultRateTypeSysId = snConfig.defaultRateTypeSysId || "";
      snConfig.notesSuggestionWeeks = normalizeNotesSuggestionWeeks(snConfig.notesSuggestionWeeks);
      updateMainSnVisibility();
      renderMainRateTypeOptions(snConfig.defaultRateTypeSysId);
      refreshMainCommentSuggestions();
    }
  });

  chrome.runtime.sendMessage({ action: "servicenow/getCachedLookups" }, (cacheResponse) => {
    if (cacheResponse?.status === "success") {
      snLookupCache = cacheResponse.data || {
        fetchedAtMs: 0,
        tasks: [],
        categories: [],
        timeCodes: [],
        rateTypes: [],
      };
      renderMainAssignmentOptions();
      renderMainCodeOptions();
      renderMainRateTypeOptions(snConfig.defaultRateTypeSysId || "");
      refreshMainCommentSuggestions();
    }
  });
}

function refreshFromBackground() {
  chrome.runtime.sendMessage({ action: "checkStatus" }, (response) => {
    const timerData = response?.timerData;
    if (!timerData) {
      showRegistrationState();
      return;
    }

    currentTaskName = timerData.savedTaskName || "";
    currentTaskNotes = timerData.snCommentText || "";
    mainSnAssignmentInput.value = currentTaskName;
    mainSnNotesInput.value = currentTaskNotes;
    elapsedTimeDisplay.textContent = transformMilisecondsToTime(timerData.elapsedTime || 0);

    renderMainAssignmentOptions(getAssignmentLabelFromTimerData(timerData));
    renderMainCodeOptions(timerData.snCodeSysId || "");
    renderMainRateTypeOptions(timerData.snRateTypeSysId || snConfig.defaultRateTypeSysId || "");
    refreshMainCommentSuggestions();

    if (currentTaskName) {
      showRunningState(Boolean(timerData.isRunning));
    } else {
      showRegistrationState();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadMainSnConfigAndLookups();
  loadMainBlocksForSuggestions();
  mainSnAssignmentInput.addEventListener("input", () => {
    if (mainSnAssignmentInput.value.trim()) {
      clearTaskNameError();
    }
    clearMainSnError();
    renderMainAssignmentOptions();
    refreshMainCommentSuggestions();
  });
  mainSnCodeSelect.addEventListener("change", () => {
    clearMainSnError();
  });
  mainSnRateTypeSelect.addEventListener("change", () => {
    clearMainSnError();
  });
  mainSnNotesInput.addEventListener("input", () => {
    clearMainSnError();
    refreshMainCommentSuggestions();
  });
  refreshFromBackground();
});

startButton.addEventListener("click", () => {
  let taskName = mainSnAssignmentInput.value.trim();
  if (!taskName) {
    showTaskNameError("Please enter a task before starting the timer.");
    return;
  }

  const taskData = {};

  if (snConfig.enabled) {
    const selectedAssignment = getSelectedAssignment();
    const selectedCode = getSelectedCodeData();
    const snCommentText = mainSnNotesInput.value.trim();

    if (!selectedAssignment) {
      showMainAssignmentError("Please select an assigned task or category.");
      return;
    }

    if (!selectedCode) {
      showMainCodeError("Please select a time code.");
      return;
    }

    const selectedRateTypeSysId = mainSnRateTypeSelect.value || snConfig.defaultRateTypeSysId || "";
    if (!selectedRateTypeSysId) {
      showMainSnRateTypeError("Please select a rate type or set a default in Settings.");
      return;
    }

    if (selectedAssignment?.kind === "task") {
      taskData.snSelectionType = "task";
      taskData.snTaskSysId = selectedAssignment.data.sys_id || "";
      taskData.snTaskNumber = selectedAssignment.data.number || "";
      taskData.snTaskShortDescription = selectedAssignment.data.short_description || "";
      taskName = `${selectedAssignment.data.number || ""} - ${
        selectedAssignment.data.short_description || ""
      }`.trim();
      taskData.snCategoryValue = "task_work";
      taskData.snCategoryLabel = "Task Work";
      const taskWorkCategory = (snLookupCache.categories || []).find(
        (category) => category.value === "task_work"
      );
      taskData.snCategorySysId = taskWorkCategory?.sys_id || "";
      taskData.snCommentText = snCommentText;
    } else if (selectedAssignment?.kind === "category") {
      taskData.snSelectionType = "category";
      taskData.snCategorySysId = selectedAssignment.data.sys_id || "";
      taskData.snCategoryValue = selectedAssignment.data.value || "";
      taskData.snCategoryLabel = selectedAssignment.data.label || "";
      taskName = selectedAssignment.data.label || selectedAssignment.data.value || taskName;
      if (!snCommentText) {
        showMainNotesError("Extra notes are required when category is selected.");
        return;
      }
      taskData.snCommentText = snCommentText;
    } else {
      taskData.snCommentText = snCommentText;
    }

    taskData.snCodeSysId = selectedCode.sys_id || "";
    taskData.snCodeValue = selectedCode.u_time_card_code || "";
    taskData.snCodeDescription = selectedCode.u_description || "";
    taskData.snRateTypeSysId = selectedRateTypeSysId;
  }

  clearTaskNameError();
  clearMainSnError();
  chrome.runtime.sendMessage({ action: "start", taskName, taskData }, (response) => {
    if (response?.status === "started") {
      currentTaskName = taskName;
      currentTaskNotes = taskData.snCommentText || "";
      showRunningState(true);
      refreshFromBackground();
    } else {
      showTaskNameError(response?.message || "Unable to start timer.");
    }
  });
});

resumeButton.addEventListener("click", () => {
  if (!currentTaskName) {
    showRegistrationState();
    return;
  }

  chrome.runtime.sendMessage({ action: "start", taskName: currentTaskName }, (response) => {
    if (response?.status === "started") {
      showRunningState(true);
      refreshFromBackground();
    }
  });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" }, (response) => {
    if (response?.status === "stopped") {
      showRunningState(false);
      loadMainBlocksForSuggestions();
      refreshFromBackground();
    }
  });
});

finishButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "finish" }, (response) => {
    if (response?.status === "finished") {
      showRegistrationState();
      mainSnAssignmentInput.value = "";
      mainSnCodeSelect.value = "";
      mainSnRateTypeSelect.value = "";
      mainSnNotesInput.value = "";
      clearTaskNameError();
      renderMainAssignmentOptions();
      renderMainCodeOptions();
      renderMainRateTypeOptions(snConfig.defaultRateTypeSysId || "");
      loadMainBlocksForSuggestions();
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "updateTime" && runningTask.style.display !== "none") {
    elapsedTimeDisplay.textContent = message.elapsedTime;
  }
});

document.getElementById("show-log-button").addEventListener("click", () => {
  openTimeManagerWindow();
  window.close();
});

function openTimeManagerWindow() {
  const width = 980;
  const height = 760;
  chrome.windows.create({
    url: "time_manager.html",
    type: "popup",
    width,
    height,
    left: Math.round((screen.availWidth - width) / 2),
    top: Math.round((screen.availHeight - height) / 2),
    focused: true,
  });
}
