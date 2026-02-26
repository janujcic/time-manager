const addLogModal = document.getElementById("add-log-modal");
const addLogModalTitle = document.getElementById("add-log-modal-title");
const saveLogButton = document.getElementById("save-log-button");
const manualLogError = document.getElementById("manual-log-error");
const taskNameInput = document.getElementById("task-name");
const taskStartDatetimeInput = document.getElementById("task-start-datetime");
const taskEndDatetimeInput = document.getElementById("task-end-datetime");
const snTimecardWrap = document.getElementById("sn-timecard-wrap");
const snTimecardSearchInput = document.getElementById("sn-timecard-search");
const snTimecardSelect = document.getElementById("sn-timecard-select");
const blockLogTableBody = document.querySelector("#block-log-table tbody");

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
const snEnabledInput = document.getElementById("sn-enabled");
const snInstanceUrlInput = document.getElementById("sn-instance-url");
const snSaveConfigButton = document.getElementById("sn-save-config-button");
const snCheckSessionButton = document.getElementById("sn-check-session-button");
const snRefreshTimecardsButton = document.getElementById("sn-refresh-timecards-button");
const snSyncButton = document.getElementById("sn-sync-button");
const snStatus = document.getElementById("sn-status");

let allBlocks = [];
let filteredBlocks = [];
let legacySessions = [];
let editingBlockId = null;
let snConfig = { enabled: false, instanceUrl: "" };
let snTimecardsCache = { fetchedAtMs: 0, items: [] };

document.addEventListener("DOMContentLoaded", () => {
  bindDashboardEvents();
  loadServiceNowConfig();
  refreshServiceNowTimecardsFromCache();
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

  blockLogTableBody.addEventListener("click", onBlockActionClick);
  snSaveConfigButton.addEventListener("click", saveServiceNowConfig);
  snCheckSessionButton.addEventListener("click", checkServiceNowSession);
  snRefreshTimecardsButton.addEventListener("click", fetchServiceNowTimecards);
  snSyncButton.addEventListener("click", syncServiceNowTimecards);
  snTimecardSearchInput.addEventListener("input", renderTimecardOptions);
}

function setSnStatus(message) {
  snStatus.textContent = message || "";
}

function updateServiceNowUiVisibility() {
  const visible = Boolean(snConfig.enabled);
  snTimecardWrap.style.display = visible ? "flex" : "none";
}

function renderTimecardOptions(selectedSysId = "") {
  const filterValue = (snTimecardSearchInput.value || "").trim().toLowerCase();
  const items = Array.isArray(snTimecardsCache.items) ? snTimecardsCache.items : [];

  const filtered = items.filter((item) => {
    if (!filterValue) {
      return true;
    }
    const haystack = `${item.number || ""} ${item.short_description || ""} ${item.stateDisplay || ""}`.toLowerCase();
    return haystack.includes(filterValue);
  });

  snTimecardSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = filtered.length === 0 ? "No matching timecards" : "Select a timecard";
  snTimecardSelect.appendChild(placeholder);

  filtered.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.sys_id;
    option.textContent = `${item.number || item.sys_id} - ${item.short_description || ""}`;
    snTimecardSelect.appendChild(option);
  });

  if (selectedSysId) {
    snTimecardSelect.value = selectedSysId;
  }
}

function refreshServiceNowTimecardsFromCache() {
  chrome.runtime.sendMessage({ action: "servicenow/getCachedTimecards" }, (response) => {
    if (response?.status === "success") {
      snTimecardsCache = response.data || { fetchedAtMs: 0, items: [] };
      renderTimecardOptions();
    }
  });
}

function loadServiceNowConfig() {
  chrome.runtime.sendMessage({ action: "servicenow/getConfig" }, (response) => {
    if (response?.status === "success") {
      snConfig = response.data || { enabled: false, instanceUrl: "" };
      snEnabledInput.checked = Boolean(snConfig.enabled);
      snInstanceUrlInput.value = snConfig.instanceUrl || "";
      updateServiceNowUiVisibility();
    }
  });
}

function saveServiceNowConfig() {
  const config = {
    enabled: snEnabledInput.checked,
    instanceUrl: snInstanceUrlInput.value.trim(),
  };

  chrome.runtime.sendMessage({ action: "servicenow/saveConfig", config }, (response) => {
    if (!response || response.status !== "success") {
      setSnStatus(response?.message || "Failed to save ServiceNow config.");
      return;
    }

    snConfig = response.data;
    updateServiceNowUiVisibility();
    setSnStatus("ServiceNow configuration saved.");
  });
}

function checkServiceNowSession() {
  chrome.runtime.sendMessage({ action: "servicenow/ensurePermission" }, (permResponse) => {
    if (!permResponse || permResponse.status !== "success") {
      setSnStatus(permResponse?.message || "Permission for ServiceNow tab access is required.");
      return;
    }
    chrome.runtime.sendMessage({ action: "servicenow/checkSession" }, (response) => {
      if (!response || response.status !== "success") {
        setSnStatus(response?.message || "ServiceNow session check failed.");
        return;
      }
      setSnStatus(
        `ServiceNow session active for user ${response.data.userName || response.data.userId}.`
      );
    });
  });
}

function fetchServiceNowTimecards() {
  chrome.runtime.sendMessage({ action: "servicenow/fetchTimecards" }, (response) => {
    if (!response || response.status !== "success") {
      setSnStatus(response?.message || "Failed to fetch ServiceNow timecards.");
      return;
    }
    snTimecardsCache = response.data || { fetchedAtMs: 0, items: [] };
    renderTimecardOptions();
    setSnStatus(`Fetched ${snTimecardsCache.items?.length || 0} open timecards.`);
  });
}

function syncServiceNowTimecards() {
  chrome.runtime.sendMessage({ action: "servicenow/sync" }, (response) => {
    if (!response || response.status === "error") {
      setSnStatus(response?.message || "ServiceNow sync failed.");
      rebuildDashboard();
      return;
    }

    const results = response.data?.results || [];
    setSnStatus(`ServiceNow sync complete. Updated ${results.length} timecards.`);
    rebuildDashboard();
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

function toDatetimeLocalValue(ms) {
  const date = new Date(ms);
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
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
    cell.colSpan = 7;
    cell.textContent = "No time blocks for selected range.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  rows.forEach((block, index) => {
    const syncLabel = block.snTimecardSysId
      ? `${block.snSyncState || "pending"}`
      : "not linked";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${block.task}</td>
      <td>${formatDateTime(block.startMs)}</td>
      <td>${formatDateTime(block.endMs)}</td>
      <td>${transformMilisecondsToTime(block.durationMs)}</td>
      <td>${block.source}<br /><small>${syncLabel}</small></td>
      <td class="block-actions">
        <button class="edit-block-button" data-action="edit" data-block-id="${block.id}">Edit</button>
        <button class="remove-block-button" data-action="remove" data-block-id="${block.id}">X</button>
      </td>
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

function setManualError(message) {
  manualLogError.textContent = message;
}

function clearManualMessages() {
  manualLogError.textContent = "";
}

function clearManualInputBorders() {
  taskNameInput.classList.remove("input-error");
  taskStartDatetimeInput.classList.remove("input-error");
  taskEndDatetimeInput.classList.remove("input-error");
  snTimecardSelect.classList.remove("input-error");
}

function resetManualForm() {
  taskNameInput.value = "";
  taskStartDatetimeInput.value = "";
  taskEndDatetimeInput.value = "";
  snTimecardSearchInput.value = "";
  renderTimecardOptions();
  editingBlockId = null;
  addLogModalTitle.textContent = "Add time block";
  saveLogButton.textContent = "Save Block";
  clearManualInputBorders();
}

function onBlockActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.getAttribute("data-action");
  const blockId = button.getAttribute("data-block-id");
  if (!blockId) {
    return;
  }

  if (action === "edit") {
    openEditBlockModal(blockId);
  } else if (action === "remove") {
    removeBlock(blockId);
  }
}

function openEditBlockModal(blockId) {
  const block = allBlocks.find((item) => item.id === blockId);
  if (!block) {
    dashboardStatus.textContent = "Unable to find selected block.";
    return;
  }

  editingBlockId = block.id;
  addLogModalTitle.textContent = "Edit time block";
  saveLogButton.textContent = "Save Changes";
  taskNameInput.value = block.task;
  taskStartDatetimeInput.value = toDatetimeLocalValue(block.startMs);
  taskEndDatetimeInput.value = toDatetimeLocalValue(block.endMs);
  snTimecardSearchInput.value = "";
  renderTimecardOptions(block.snTimecardSysId || "");
  clearManualMessages();
  clearManualInputBorders();
  addLogModal.style.display = "block";
}

function removeBlock(blockId) {
  chrome.runtime.sendMessage({ action: "deleteTimeBlock", blockId }, (response) => {
    if (!response || response.status !== "success") {
      dashboardStatus.textContent = response?.message || "Unable to remove block.";
      return;
    }
    dashboardStatus.textContent = "Time block removed.";
    rebuildDashboard();
  });
}

document.getElementById("add-log-button").addEventListener("click", () => {
  resetManualForm();
  clearManualMessages();
  updateServiceNowUiVisibility();
  addLogModal.style.display = "block";
});

saveLogButton.addEventListener("click", () => {
  clearManualMessages();
  clearManualInputBorders();

  const taskName = taskNameInput.value.trim();
  const taskStartValue = taskStartDatetimeInput.value;
  const taskEndValue = taskEndDatetimeInput.value;
  const taskStartMs = Date.parse(taskStartValue);
  const taskEndMs = Date.parse(taskEndValue);

  if (!taskName) {
    taskNameInput.classList.add("input-error");
    setManualError("Task name is required.");
    return;
  }
  if (!taskStartValue || Number.isNaN(taskStartMs)) {
    taskStartDatetimeInput.classList.add("input-error");
    setManualError("Start time is required.");
    return;
  }
  if (!taskEndValue || Number.isNaN(taskEndMs)) {
    taskEndDatetimeInput.classList.add("input-error");
    setManualError("End time is required.");
    return;
  }
  if (taskEndMs <= taskStartMs) {
    taskStartDatetimeInput.classList.add("input-error");
    taskEndDatetimeInput.classList.add("input-error");
    setManualError("End time must be after start time.");
    return;
  }

  const selectedTimecardSysId = snTimecardSelect.value;
  const selectedTimecardLabel =
    snTimecardSelect.selectedOptions?.[0]?.textContent || "";
  if (snConfig.enabled && !selectedTimecardSysId) {
    snTimecardSelect.classList.add("input-error");
    setManualError("ServiceNow timecard selection is required when integration is enabled.");
    return;
  }

  const totalDuration = taskEndMs - taskStartMs;

  const payload = {
    taskName,
    taskDuration: totalDuration,
    startTimeMs: taskStartMs,
    endTimeMs: taskEndMs,
    snTimecardSysId: selectedTimecardSysId,
    snTimecardLabel: selectedTimecardLabel,
  };

  const action = editingBlockId ? "updateTimeBlock" : "saveManualSession";
  const request = editingBlockId
    ? { action, blockId: editingBlockId, taskData: payload }
    : { action, taskData: payload };

  chrome.runtime.sendMessage(request, (response) => {
    if (!response || response.status !== "success") {
      setManualError(response?.message || "Unable to save time block.");
      return;
    }

    const wasEditing = Boolean(editingBlockId);
    resetManualForm();
    addLogModal.style.display = "none";
    dashboardStatus.textContent = wasEditing
      ? "Time block updated."
      : "Time block saved.";
    rebuildDashboard();
  });
});

document.getElementById("cancel-log-button").addEventListener("click", () => {
  addLogModal.style.display = "none";
  clearManualMessages();
  resetManualForm();
});
