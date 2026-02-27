const addLogModal = document.getElementById("add-log-modal");
const addLogModalTitle = document.getElementById("add-log-modal-title");
const saveLogButton = document.getElementById("save-log-button");
const manualLogError = document.getElementById("manual-log-error");
const taskNameInput = document.getElementById("task-name");
const taskStartDatetimeInput = document.getElementById("task-start-datetime");
const taskEndDatetimeInput = document.getElementById("task-end-datetime");
const snAssignmentWrap = document.getElementById("sn-assignment-wrap");
const snAssignmentSelect = document.getElementById("sn-assignment-select");
const snCodeWrap = document.getElementById("sn-code-wrap");
const snCodeSelect = document.getElementById("sn-code-select");
const snCommentWrap = document.getElementById("sn-comment-wrap");
const snCommentInput = document.getElementById("sn-comment-input");
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
const snConnectButton = document.getElementById("sn-connect-button");
const snRefreshLookupsButton = document.getElementById("sn-refresh-lookups-button");
const snSyncButton = document.getElementById("sn-sync-button");
const snStatus = document.getElementById("sn-status");
const snConnectionBadge = document.getElementById("sn-connection-badge");

let allBlocks = [];
let filteredBlocks = [];
let editingBlockId = null;
let snConfig = { enabled: false, instanceUrl: "" };
let snLookupCache = { fetchedAtMs: 0, tasks: [], categories: [], timeCodes: [] };
let snConnectionState = { connected: false, code: "", message: "" };

document.addEventListener("DOMContentLoaded", () => {
  bindDashboardEvents();
  loadServiceNowConfig();
  refreshServiceNowLookupsFromCache();
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
  snConnectButton.addEventListener("click", connectServiceNowSession);
  snRefreshLookupsButton.addEventListener("click", fetchServiceNowLookups);
  snSyncButton.addEventListener("click", syncVisibleRangeToServiceNow);
  taskNameInput.addEventListener("input", onTaskNameInputChanged);
  snAssignmentSelect.addEventListener("change", clearManualInputBorders);
  snCodeSelect.addEventListener("change", clearManualInputBorders);
  snCommentInput.addEventListener("input", clearManualInputBorders);
}

function setSnStatus(message) {
  snStatus.textContent = message || "";
}

function updateServiceNowUiVisibility() {
  const visible = Boolean(snConfig.enabled);
  snAssignmentWrap.style.display = visible ? "flex" : "none";
  snCodeWrap.style.display = visible ? "flex" : "none";
  snCommentWrap.style.display = visible ? "flex" : "none";
  snSyncButton.style.display = visible && rangePresetSelect.value !== "all" ? "inline-block" : "none";
  updateServiceNowActionStates();
  updateSnConnectionBadge();
}

function updateSnConnectionBadge() {
  if (!snConfig.enabled) {
    snConnectionBadge.textContent = "Disabled";
    snConnectionBadge.className = "sn-connection-badge disabled";
    return;
  }

  if (snConnectionState.connected) {
    snConnectionBadge.textContent = "Connected";
    snConnectionBadge.className = "sn-connection-badge connected";
    return;
  }

  snConnectionBadge.textContent = "Disconnected";
  snConnectionBadge.className = "sn-connection-badge disconnected";
}

function updateServiceNowActionStates() {
  const enabled = Boolean(snConfig.enabled);
  const connected = enabled && snConnectionState.connected;
  const canSyncRange = enabled && rangePresetSelect.value !== "all";
  snConnectButton.disabled = !enabled;
  snRefreshLookupsButton.disabled = !connected;
  snSyncButton.disabled = !canSyncRange || !connected || filteredBlocks.length === 0;
}

function setSnConnectionState(nextState) {
  snConnectionState = {
    connected: Boolean(nextState?.connected),
    code: nextState?.code || "",
    message: nextState?.message || "",
  };
  updateServiceNowActionStates();
  updateSnConnectionBadge();
}

function normalizeInstanceOrigin(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") {
      return null;
    }
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function requestHostPermission(originPattern) {
  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: [originPattern] }, (granted) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function getAssignmentOptions(filterText = "") {
  const query = String(filterText || "").trim().toLowerCase();

  const taskOptions = (Array.isArray(snLookupCache.tasks) ? snLookupCache.tasks : [])
    .filter((task) => {
      if (!query) {
        return true;
      }
      const haystack = `${task.number || ""} ${task.short_description || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    .map((task) => ({
      value: `task:${task.sys_id}`,
      label: `[Task] ${task.number || task.sys_id} - ${task.short_description || ""}`,
      kind: "task",
      data: task,
    }));

  const categoryOptions = (Array.isArray(snLookupCache.categories) ? snLookupCache.categories : [])
    .filter((category) => category.value !== "task_work")
    .filter((category) => {
      if (!query) {
        return true;
      }
      const haystack = `${category.label || ""} ${category.value || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    .map((category) => ({
      value: `category:${category.sys_id}`,
      label: `[Category] ${category.label || category.value} (${category.value || ""})`,
      kind: "category",
      data: category,
    }));

  return [...taskOptions, ...categoryOptions];
}

function renderAssignmentOptions(selectedValue = "") {
  const options = getAssignmentOptions(taskNameInput.value);
  if (selectedValue && !options.some((item) => item.value === selectedValue)) {
    const fallback = getAssignmentOptions("").find((item) => item.value === selectedValue);
    if (fallback) {
      options.unshift(fallback);
    }
  }
  snAssignmentSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent =
    options.length === 0 ? "No matching task/category suggestions" : "Select task or category";
  snAssignmentSelect.appendChild(placeholder);

  options.forEach((optionData) => {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    snAssignmentSelect.appendChild(option);
  });

  if (selectedValue && options.some((item) => item.value === selectedValue)) {
    snAssignmentSelect.value = selectedValue;
  }
}

function renderCodeOptions(selectedCodeSysId = "") {
  const codes = Array.isArray(snLookupCache.timeCodes) ? snLookupCache.timeCodes : [];
  snCodeSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = codes.length === 0 ? "No time codes available" : "Select time code";
  snCodeSelect.appendChild(placeholder);

  codes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code.sys_id;
    option.textContent = code.label || code.u_time_card_code || code.sys_id;
    snCodeSelect.appendChild(option);
  });

  if (selectedCodeSysId) {
    snCodeSelect.value = selectedCodeSysId;
  }
}

function refreshServiceNowLookupsFromCache() {
  chrome.runtime.sendMessage({ action: "servicenow/getCachedLookups" }, (response) => {
    if (response?.status === "success") {
      snLookupCache = response.data || {
        fetchedAtMs: 0,
        tasks: [],
        categories: [],
        timeCodes: [],
      };
      renderAssignmentOptions();
      renderCodeOptions();
    }
  });
}

function onTaskNameInputChanged() {
  renderAssignmentOptions(snAssignmentSelect.value);
}

function getSelectedAssignment() {
  const selectedValue = snAssignmentSelect.value;
  if (!selectedValue) {
    return null;
  }
  const options = getAssignmentOptions(taskNameInput.value);
  return options.find((item) => item.value === selectedValue) || null;
}

function getSelectedCode() {
  const selectedCodeSysId = snCodeSelect.value;
  if (!selectedCodeSysId) {
    return null;
  }
  const codes = Array.isArray(snLookupCache.timeCodes) ? snLookupCache.timeCodes : [];
  return codes.find((item) => item.sys_id === selectedCodeSysId) || null;
}

function loadServiceNowConfig() {
  chrome.runtime.sendMessage({ action: "servicenow/getConfig" }, (response) => {
    if (response?.status === "success") {
      snConfig = response.data || { enabled: false, instanceUrl: "" };
      snEnabledInput.checked = Boolean(snConfig.enabled);
      snInstanceUrlInput.value = snConfig.instanceUrl || "";
      setSnConnectionState({ connected: false, code: "", message: "" });
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
    setSnConnectionState({ connected: false, code: "", message: "" });
    updateServiceNowUiVisibility();
    setSnStatus("ServiceNow configuration saved. Click Connect ServiceNow.");
  });
}

function handleConnectResponse(response) {
  if (!response || response.status !== "success") {
    setSnConnectionState({
      connected: false,
      code: response?.code || "",
      message: response?.message || "",
    });
    setSnStatus(
      response?.message ||
        "ServiceNow connection failed. Open and log in to your instance tab, then retry."
    );
    return;
  }

  setSnConnectionState({ connected: true, code: "", message: "" });
  setSnStatus(
    `Connected to ${response.data.instanceUrl} as ${
      response.data.userName || response.data.userId || "active session user"
    }.`
  );
}

function connectServiceNowSession() {
  const rawUrl = snInstanceUrlInput.value.trim();
  const instanceOrigin = normalizeInstanceOrigin(rawUrl);

  if (snEnabledInput.checked && !instanceOrigin) {
    setSnConnectionState({
      connected: false,
      code: "SN_NO_CONFIG",
      message: "Invalid ServiceNow instance URL.",
    });
    setSnStatus(
      "ServiceNow URL must be HTTPS origin only (for example, https://your-instance.service-now.com)."
    );
    return;
  }

  if (!snEnabledInput.checked) {
    chrome.runtime.sendMessage({ action: "servicenow/connect" }, handleConnectResponse);
    return;
  }

  requestHostPermission(`${instanceOrigin}/*`)
    .then((granted) => {
      if (!granted) {
        setSnConnectionState({
          connected: false,
          code: "SN_PERMISSION_DENIED",
          message: "ServiceNow host permission was not granted.",
        });
        setSnStatus(
          `Permission denied for ${instanceOrigin}. Allow host access in the browser prompt, then retry Connect ServiceNow.`
        );
        return;
      }

      chrome.runtime.sendMessage({ action: "servicenow/connect" }, handleConnectResponse);
    })
    .catch((error) => {
      setSnConnectionState({
        connected: false,
        code: "SN_PERMISSION_DENIED",
        message: error?.message || "Host permission request failed.",
      });
      setSnStatus(
        `Permission request failed: ${
          error?.message || "Unable to request host permission in this browser context."
        }`
      );
    });
}

function fetchServiceNowLookups() {
  if (!snConfig.enabled) {
    setSnStatus("Enable ServiceNow integration first.");
    return;
  }
  if (!snConnectionState.connected) {
    setSnStatus("Connect ServiceNow before refreshing ServiceNow data.");
    return;
  }

  chrome.runtime.sendMessage({ action: "servicenow/fetchLookups" }, (response) => {
    if (!response || response.status !== "success") {
      if (response?.code === "SN_NO_TAB" || response?.code === "SN_NOT_LOGGED_IN") {
        setSnConnectionState({ connected: false, code: response.code, message: response.message });
      }
      setSnStatus(response?.message || "Failed to fetch ServiceNow data.");
      return;
    }
    snLookupCache = response.data || { fetchedAtMs: 0, tasks: [], categories: [], timeCodes: [] };
    renderAssignmentOptions();
    renderCodeOptions();
    const taskCount = snLookupCache.tasks?.length || 0;
    const categoryCount = (snLookupCache.categories || []).filter(
      (category) => category.value !== "task_work"
    ).length;
    const codeCount = snLookupCache.timeCodes?.length || 0;
    setSnStatus(
      `Fetched ${taskCount} tasks, ${categoryCount} categories, and ${codeCount} time codes.`
    );
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
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
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
  updateServiceNowActionStates();
  if (snConfig.enabled) {
    snSyncButton.style.display = rangePresetSelect.value === "all" ? "none" : "inline-block";
  }
}

function syncVisibleRangeToServiceNow() {
  if (!snConfig.enabled) {
    setSnStatus("Enable ServiceNow integration first.");
    return;
  }
  if (!snConnectionState.connected) {
    setSnStatus("Connect ServiceNow before syncing.");
    return;
  }
  if (rangePresetSelect.value === "all") {
    setSnStatus("Select a specific date range before syncing.");
    return;
  }

  const blockIds = filteredBlocks.map((block) => block.id).filter(Boolean);
  if (blockIds.length === 0) {
    setSnStatus("No time blocks in the selected range to sync.");
    return;
  }

  chrome.runtime.sendMessage(
    {
      action: "servicenow/syncVisibleBlocks",
      data: {
        rangePreset: rangePresetSelect.value,
        blockIds,
      },
    },
    (response) => {
      if (!response || response.status !== "success") {
        setSnStatus(response?.message || "Sync is not available yet.");
        return;
      }
      setSnStatus("Sync completed.");
    }
  );
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
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
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

  const taskRows = aggregateBlocksByTask(filteredBlocks);

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
      <td>${taskRow.lastSavedMs ? formatDateTime(taskRow.lastSavedMs) : "-"}</td>
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
    const assignmentLabel =
      block.snSelectionType === "task"
        ? `task ${block.snTaskNumber || block.snTaskSysId || "-"}`
        : block.snSelectionType === "category"
          ? `category ${block.snCategoryLabel || block.snCategoryValue || "-"}`
          : block.snCommentText
            ? `comment ${block.snCommentText}`
            : "not linked";
    const codeLabel = block.snCodeValue ? `code ${block.snCodeValue}` : "no code";
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${block.task}</td>
      <td>${formatDateTime(block.startMs)}</td>
      <td>${formatDateTime(block.endMs)}</td>
      <td>${transformMilisecondsToTime(block.durationMs)}</td>
      <td>${block.source}<br /><small>${assignmentLabel}; ${codeLabel}</small></td>
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
  snAssignmentSelect.classList.remove("input-error");
  snCodeSelect.classList.remove("input-error");
  snCommentInput.classList.remove("input-error");
}

function resetManualForm() {
  taskNameInput.value = "";
  taskStartDatetimeInput.value = "";
  taskEndDatetimeInput.value = "";
  snCommentInput.value = "";
  renderAssignmentOptions();
  renderCodeOptions();
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
  const assignmentValue =
    block.snSelectionType === "task" && block.snTaskSysId
      ? `task:${block.snTaskSysId}`
      : block.snSelectionType === "category" && block.snCategorySysId
        ? `category:${block.snCategorySysId}`
        : "";
  renderAssignmentOptions(assignmentValue);
  renderCodeOptions(block.snCodeSysId || "");
  snCommentInput.value = block.snCommentText || "";
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

  const totalDuration = taskEndMs - taskStartMs;
  const payload = {
    taskName,
    taskDuration: totalDuration,
    startTimeMs: taskStartMs,
    endTimeMs: taskEndMs,
  };

  if (snConfig.enabled) {
    const selectedAssignment = getSelectedAssignment();
    const selectedCode = getSelectedCode();
    const snCommentText = snCommentInput.value.trim();

    if (!selectedAssignment) {
      snAssignmentSelect.classList.add("input-error");
      setManualError("Please select an assigned task or category.");
      return;
    }

    if (!selectedCode) {
      snCodeSelect.classList.add("input-error");
      setManualError("Please select a time code.");
      return;
    }

    if (selectedAssignment?.kind === "task") {
      payload.snSelectionType = "task";
      payload.snTaskSysId = selectedAssignment.data.sys_id || "";
      payload.snTaskNumber = selectedAssignment.data.number || "";
      payload.snTaskShortDescription = selectedAssignment.data.short_description || "";
      payload.snCategoryValue = "task_work";
      payload.snCategoryLabel = "Task Work";
      const taskWorkCategory = (snLookupCache.categories || []).find(
        (category) => category.value === "task_work"
      );
      payload.snCategorySysId = taskWorkCategory?.sys_id || "";
    } else if (selectedAssignment?.kind === "category") {
      payload.snSelectionType = "category";
      payload.snCategorySysId = selectedAssignment.data.sys_id || "";
      payload.snCategoryValue = selectedAssignment.data.value || "";
      payload.snCategoryLabel = selectedAssignment.data.label || "";
      if (!snCommentText) {
        snCommentInput.classList.add("input-error");
        setManualError("Extra notes are required when category is selected.");
        return;
      }
    }

    payload.snCommentText = snCommentText;
    payload.snCodeSysId = selectedCode.sys_id || "";
    payload.snCodeValue = selectedCode.u_time_card_code || "";
    payload.snCodeDescription = selectedCode.u_description || "";
  }

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
