const confirmationModal = document.getElementById("confirmation-modal");
const addLogModal = document.getElementById("add-log-modal");
const manualLogError = document.getElementById("manual-log-error");
const manualLogSuccess = document.getElementById("manual-log-success");
const taskNameInput = document.getElementById("task-name");
const taskDurationHoursInput = document.getElementById("task-duration-hours");
const taskDurationMinutesInput = document.getElementById("task-duration-minutes");
const taskDateInput = document.getElementById("task-timedate");

const rangePresetSelect = document.getElementById("range-preset");
const customRangeControls = document.getElementById("custom-range-controls");
const customStartDateInput = document.getElementById("custom-start-date");
const customEndDateInput = document.getElementById("custom-end-date");
const applyCustomRangeButton = document.getElementById("apply-custom-range-button");
const periodTypeSelect = document.getElementById("period-type");
const periodSummaryLabel = document.getElementById("period-summary-label");
const dashboardStatus = document.getElementById("log-display");

const kpiTotalTime = document.getElementById("kpi-total-time");
const kpiTaskCount = document.getElementById("kpi-task-count");
const kpiBlockCount = document.getElementById("kpi-block-count");
const kpiAvgBlock = document.getElementById("kpi-avg-block");

let durationOptionsInitialized = false;
let allBlocks = [];
let filteredBlocks = [];
let legacySessions = [];

document.addEventListener("DOMContentLoaded", () => {
  initializeDurationOptions();
  bindDashboardEvents();
  rebuildDashboard();
});

function bindDashboardEvents() {
  rangePresetSelect.addEventListener("change", () => {
    customRangeControls.style.display =
      rangePresetSelect.value === "custom" ? "flex" : "none";
    applyFiltersAndRender();
  });

  periodTypeSelect.addEventListener("change", () => {
    renderPeriodSummaryTable();
  });

  applyCustomRangeButton.addEventListener("click", () => {
    applyFiltersAndRender();
  });
}

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString();
}

function formatDateOnly(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getRangeBounds() {
  const now = Date.now();
  const preset = rangePresetSelect.value;

  if (preset === "today") {
    return { startMs: startOfToday(), endMs: now };
  }
  if (preset === "this-week") {
    return { startMs: startOfWeek(), endMs: now };
  }
  if (preset === "this-month") {
    return { startMs: startOfMonth(), endMs: now };
  }
  if (preset === "custom") {
    const startDateValue = customStartDateInput.value;
    const endDateValue = customEndDateInput.value;
    const startMs = startDateValue ? new Date(startDateValue).getTime() : null;
    const endMs = endDateValue
      ? new Date(endDateValue).getTime() + 24 * 60 * 60 * 1000 - 1
      : null;

    if (startMs === null || endMs === null || Number.isNaN(startMs) || Number.isNaN(endMs)) {
      dashboardStatus.textContent =
        "Please select both start and end dates for custom range.";
      return null;
    }
    if (endMs < startMs) {
      dashboardStatus.textContent = "Custom range end date must be after start date.";
      return null;
    }

    return { startMs, endMs };
  }

  return { startMs: null, endMs: null };
}

function applyFiltersAndRender() {
  dashboardStatus.textContent = "";

  const bounds = getRangeBounds();
  if (!bounds) {
    return;
  }

  filteredBlocks = allBlocks.filter((block) => {
    if (bounds.startMs !== null && block.startMs < bounds.startMs) {
      return false;
    }
    if (bounds.endMs !== null && block.startMs > bounds.endMs) {
      return false;
    }
    return true;
  });

  renderAllSections();
}

function aggregateBlocksByTask(blocks) {
  const grouped = new Map();

  for (const block of blocks) {
    if (!grouped.has(block.task)) {
      grouped.set(block.task, {
        task: block.task,
        duration: 0,
        blockCount: 0,
        lastSavedMs: 0,
      });
    }

    const current = grouped.get(block.task);
    current.duration += block.durationMs;
    current.blockCount += 1;
    current.lastSavedMs = Math.max(current.lastSavedMs, block.endMs);
  }

  return Array.from(grouped.values()).sort((a, b) => b.duration - a.duration);
}

function getWeekKey(ms) {
  const date = new Date(ms);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return formatDateOnly(date.getTime());
}

function aggregateByPeriod(blocks, periodType) {
  const grouped = new Map();

  for (const block of blocks) {
    const key = periodType === "week" ? getWeekKey(block.startMs) : formatDateOnly(block.startMs);
    grouped.set(key, (grouped.get(key) || 0) + block.durationMs);
  }

  return Array.from(grouped.entries())
    .map(([period, duration]) => ({ period, duration }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function renderKpis(taskRows) {
  const totalDuration = filteredBlocks.reduce((sum, block) => sum + block.durationMs, 0);
  const taskCount = taskRows.length;
  const blockCount = filteredBlocks.length;
  const avgBlock = blockCount === 0 ? 0 : Math.floor(totalDuration / blockCount);

  kpiTotalTime.textContent = transformMilisecondsToTime(totalDuration);
  kpiTaskCount.textContent = String(taskCount);
  kpiBlockCount.textContent = String(blockCount);
  kpiAvgBlock.textContent = transformMilisecondsToTime(avgBlock);
}

function clearTableBody(selector) {
  const tableBody = document.querySelector(selector);
  tableBody.innerHTML = "";
}

function renderTaskTable() {
  clearTableBody("#task-log-table tbody");
  const tableBody = document.querySelector("#task-log-table tbody");

  let taskRows = aggregateBlocksByTask(filteredBlocks);
  const isFallback =
    filteredBlocks.length === 0 && allBlocks.length === 0 && rangePresetSelect.value === "all";

  if (isFallback && legacySessions.length > 0) {
    taskRows = legacySessions.map((session) => ({
      task: session.task,
      duration: session.duration,
      blockCount: 0,
      lastSavedMs: session.lastSaved ? Date.parse(session.lastSaved) : 0,
      legacyLastSaved: session.lastSaved || "-",
    }));
    dashboardStatus.textContent =
      "Showing legacy totals. Date filters and block history need new block data.";
  }

  if (taskRows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No task data for selected range.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return taskRows;
  }

  taskRows.forEach((taskRow, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${taskRow.task}</td>
      <td>${transformMilisecondsToTime(taskRow.duration)}</td>
      <td>${taskRow.blockCount}</td>
      <td>${
        taskRow.legacyLastSaved ||
        (taskRow.lastSavedMs ? formatDateTime(taskRow.lastSavedMs) : "-")
      }</td>
    `;
    tableBody.appendChild(row);
  });

  return taskRows;
}

function renderPeriodSummaryTable() {
  clearTableBody("#period-summary-table tbody");
  const tableBody = document.querySelector("#period-summary-table tbody");
  const periodType = periodTypeSelect.value;
  periodSummaryLabel.textContent = periodType === "week" ? "Week Start" : "Day";

  const rows = aggregateByPeriod(filteredBlocks, periodType);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "No period data for selected range.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  rows.forEach((periodRow, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${periodRow.period}</td>
      <td>${transformMilisecondsToTime(periodRow.duration)}</td>
    `;
    tableBody.appendChild(row);
  });
}

function renderBlockTable() {
  clearTableBody("#block-log-table tbody");
  const tableBody = document.querySelector("#block-log-table tbody");

  const rows = [...filteredBlocks].sort((a, b) => b.startMs - a.startMs);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No time blocks for selected range.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  rows.forEach((block, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${block.task}</td>
      <td>${formatDateTime(block.startMs)}</td>
      <td>${formatDateTime(block.endMs)}</td>
      <td>${transformMilisecondsToTime(block.durationMs)}</td>
      <td>${block.source}</td>
    `;
    tableBody.appendChild(row);
  });
}

function renderAllSections() {
  const taskRows = renderTaskTable();
  renderKpis(taskRows);
  renderPeriodSummaryTable();
  renderBlockTable();
}

function rebuildDashboard() {
  dashboardStatus.textContent = "";
  chrome.runtime.sendMessage({ action: "getTimeBlocks" }, (response) => {
    if (response && response.status === "success") {
      allBlocks = response.data || [];
      applyFiltersAndRender();
    } else {
      allBlocks = [];
      applyFiltersAndRender();
    }
  });

  chrome.runtime.sendMessage({ action: "getAggregatedSessions" }, (response) => {
    if (response && response.status === "success") {
      legacySessions = response.data || [];
    } else {
      legacySessions = [];
    }
    applyFiltersAndRender();
  });
}

function generateOptions(selectElement, start, end) {
  for (let i = start; i <= end; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = i;
    selectElement.appendChild(option);
  }
}

function initializeDurationOptions() {
  if (durationOptionsInitialized) {
    return;
  }

  generateOptions(taskDurationHoursInput, 0, 12);
  generateOptions(taskDurationMinutesInput, 0, 59);
  taskDurationHoursInput.value = 0;
  taskDurationMinutesInput.value = 0;
  durationOptionsInitialized = true;
}

function setManualError(message) {
  manualLogError.textContent = message;
  manualLogSuccess.textContent = "";
}

function setManualSuccess(message) {
  manualLogSuccess.textContent = message;
  manualLogError.textContent = "";
}

function clearManualMessages() {
  manualLogError.textContent = "";
  manualLogSuccess.textContent = "";
}

function clearManualInputBorders() {
  taskNameInput.classList.remove("input-error");
  taskDurationHoursInput.classList.remove("input-error");
  taskDurationMinutesInput.classList.remove("input-error");
  taskDateInput.classList.remove("input-error");
}

function resetManualForm() {
  taskNameInput.value = "";
  taskDurationHoursInput.value = 0;
  taskDurationMinutesInput.value = 0;
  taskDateInput.value = "";
  clearManualInputBorders();
}

document.getElementById("clear-log-button").addEventListener("click", () => {
  confirmationModal.style.display = "block";
});

document.getElementById("yes-button").addEventListener("click", () => {
  clearSessionsInBackground();
  confirmationModal.style.display = "none";
});

document.getElementById("no-button").addEventListener("click", () => {
  confirmationModal.style.display = "none";
});

document.getElementById("add-log-button").addEventListener("click", () => {
  clearManualMessages();
  clearManualInputBorders();
  addLogModal.style.display = "block";
});

document.getElementById("save-log-button").addEventListener("click", () => {
  clearManualMessages();
  clearManualInputBorders();

  const taskName = taskNameInput.value.trim();
  const taskDurationHours = Number(taskDurationHoursInput.value);
  const taskDurationMinutes = Number(taskDurationMinutesInput.value);
  const taskDateValue = taskDateInput.value;
  const taskStartMs = Date.parse(taskDateValue);

  if (!taskName) {
    taskNameInput.classList.add("input-error");
    setManualError("Task name is required.");
    return;
  }
  if (taskDurationHours === 0 && taskDurationMinutes === 0) {
    taskDurationHoursInput.classList.add("input-error");
    taskDurationMinutesInput.classList.add("input-error");
    setManualError("Please enter a duration greater than zero.");
    return;
  }
  if (!taskDateValue || Number.isNaN(taskStartMs)) {
    taskDateInput.classList.add("input-error");
    setManualError("Start time is required for manual logs.");
    return;
  }

  const totalDuration =
    taskDurationHours * 60 * 60 * 1000 + taskDurationMinutes * 60 * 1000;

  chrome.runtime.sendMessage(
    {
      action: "saveManualSession",
      taskData: { taskName, taskDuration: totalDuration, startTimeMs: taskStartMs },
    },
    (response) => {
      if (!response || response.status !== "success") {
        setManualError(response?.message || "Unable to save manual session.");
        return;
      }

      resetManualForm();
      setManualSuccess("Task saved successfully.");
      rebuildDashboard();
    }
  );
});

document.getElementById("cancel-log-button").addEventListener("click", () => {
  addLogModal.style.display = "none";
  clearManualMessages();
  resetManualForm();
});

function clearSessionsInBackground() {
  chrome.runtime.sendMessage({ action: "clearSessions" }, (response) => {
    if (response && response.status === "cleared") {
      dashboardStatus.textContent = "Log cleared.";
      rebuildDashboard();
    }
  });
}
