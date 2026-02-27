const TIME_BLOCKS_KEY = "timeBlocks";
const SN_CONFIG_KEY = "sn_config";
const SN_LOOKUP_CACHE_KEY = "sn_lookup_cache";
const DEPRECATED_STORAGE_KEYS = ["timeSessions", "sn_timecards_cache", "sn_last_sync_report"];

const DEFAULT_SN_CONFIG = {
  enabled: false,
  instanceUrl: "",
};

let timerData = {
  savedTaskName: "",
  isRunning: false,
  elapsedTime: 0,
  lastSaved: "",
  snSelectionType: "",
  snTaskSysId: "",
  snTaskNumber: "",
  snTaskShortDescription: "",
  snCategorySysId: "",
  snCategoryValue: "",
  snCategoryLabel: "",
  snCodeSysId: "",
  snCodeValue: "",
  snCodeDescription: "",
  snCommentText: "",
};
let timerInterval = null;
let activeBlockStartMs = null;
let elapsedBeforeActiveMs = 0;
let lastConnectedSnTabId = null;
let lastConnectedSnUserId = "";

initializeStorage();

function initializeStorage() {
  chrome.storage.local.get(
    [TIME_BLOCKS_KEY, SN_CONFIG_KEY, SN_LOOKUP_CACHE_KEY, ...DEPRECATED_STORAGE_KEYS],
    (result) => {
      const updatePayload = {};
      if (!Array.isArray(result[TIME_BLOCKS_KEY])) {
        updatePayload[TIME_BLOCKS_KEY] = [];
      }
      if (!result[SN_CONFIG_KEY] || typeof result[SN_CONFIG_KEY] !== "object") {
        updatePayload[SN_CONFIG_KEY] = { ...DEFAULT_SN_CONFIG };
      }
      if (!result[SN_LOOKUP_CACHE_KEY] || typeof result[SN_LOOKUP_CACHE_KEY] !== "object") {
        updatePayload[SN_LOOKUP_CACHE_KEY] = {
          fetchedAtMs: 0,
          tasks: [],
          categories: [],
          timeCodes: [],
        };
      }
      if (Object.keys(updatePayload).length > 0) {
        chrome.storage.local.set(updatePayload);
      }

      const keysToRemove = DEPRECATED_STORAGE_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(result, key)
      );
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove);
      }
    }
  );
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

function permissionsContains(permissions) {
  return new Promise((resolve) => {
    chrome.permissions.contains(permissions, resolve);
  });
}

function permissionsRequest(permissions) {
  return new Promise((resolve) => {
    chrome.permissions.request(permissions, resolve);
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, resolve);
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeScriptFileOnTab(tabId, files) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files,
      },
      (injectionResults) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(injectionResults || []);
      }
    );
  });
}

function normalizeInstanceUrl(rawUrl) {
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

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeServiceNowMetadata(taskData = {}) {
  let snSelectionType = readString(taskData.snSelectionType);
  const snTaskSysId = readString(taskData.snTaskSysId);
  const snTaskNumber = readString(taskData.snTaskNumber);
  const snTaskShortDescription = readString(taskData.snTaskShortDescription);
  const snCategorySysId = readString(taskData.snCategorySysId);
  const snCategoryValue = readString(taskData.snCategoryValue);
  const snCategoryLabel = readString(taskData.snCategoryLabel);
  const snCodeSysId = readString(taskData.snCodeSysId);
  const snCodeValue = readString(taskData.snCodeValue);
  const snCodeDescription = readString(taskData.snCodeDescription);
  const snCommentText = readString(taskData.snCommentText);

  if (snSelectionType !== "task" && snSelectionType !== "category") {
    if (snTaskSysId) {
      snSelectionType = "task";
    } else if (snCategorySysId || snCategoryValue) {
      snSelectionType = "category";
    } else {
      snSelectionType = "";
    }
  }

  if (snSelectionType === "task") {
    return {
      snSelectionType,
      snTaskSysId,
      snTaskNumber,
      snTaskShortDescription,
      snCategorySysId: snCategorySysId || "",
      snCategoryValue: snCategoryValue || "task_work",
      snCategoryLabel: snCategoryLabel || "Task Work",
      snCodeSysId,
      snCodeValue,
      snCodeDescription,
      snCommentText,
    };
  }

  if (snSelectionType === "category") {
    return {
      snSelectionType,
      snTaskSysId: "",
      snTaskNumber: "",
      snTaskShortDescription: "",
      snCategorySysId,
      snCategoryValue,
      snCategoryLabel,
      snCodeSysId,
      snCodeValue,
      snCodeDescription,
      snCommentText,
    };
  }

  return {
    snSelectionType: "",
    snTaskSysId: "",
    snTaskNumber: "",
    snTaskShortDescription: "",
    snCategorySysId: "",
    snCategoryValue: "",
    snCategoryLabel: "",
    snCodeSysId: "",
    snCodeValue: "",
    snCodeDescription: "",
    snCommentText,
  };
}

async function validateServiceNowMetadata(taskData = {}) {
  const config = await getServiceNowConfig();
  if (!config.enabled) {
    return { status: "success" };
  }

  const metadata = normalizeServiceNowMetadata(taskData);
  if (!metadata.snCodeSysId) {
    return { status: "error", message: "Time code selection is required." };
  }

  if (metadata.snSelectionType === "task" && !metadata.snTaskSysId) {
    return { status: "error", message: "Please select an assigned task suggestion." };
  }

  if (metadata.snSelectionType === "category") {
    if (!metadata.snCategorySysId || !metadata.snCategoryValue) {
      return { status: "error", message: "Please select a category suggestion." };
    }
    if (metadata.snCategoryValue === "task_work") {
      return { status: "error", message: "task_work is reserved for task-linked entries." };
    }
  }

  return { status: "success" };
}

function withServiceNowMetadata(base, taskData, fallbackComment = "") {
  const metadata = normalizeServiceNowMetadata(taskData);
  if (!metadata.snSelectionType && !metadata.snCommentText) {
    metadata.snCommentText = readString(fallbackComment);
  }
  return {
    ...base,
    ...metadata,
  };
}

async function getTimeBlocks() {
  const result = await storageGet([TIME_BLOCKS_KEY]);
  return Array.isArray(result[TIME_BLOCKS_KEY]) ? result[TIME_BLOCKS_KEY] : [];
}

async function saveTimeBlocks(blocks) {
  await storageSet({ [TIME_BLOCKS_KEY]: blocks });
}

async function appendTimeBlock(block) {
  const existingBlocks = await getTimeBlocks();
  existingBlocks.push(block);
  await saveTimeBlocks(existingBlocks);
}

async function updateTimeBlock(blockId, taskData) {
  const task = (taskData.taskName || "").trim();
  const startMs = Number(taskData.startTimeMs);
  const endMs = Number(taskData.endTimeMs);

  if (!blockId) {
    return { status: "error", message: "Block id is required." };
  }
  if (!task) {
    return { status: "error", message: "Task name is required." };
  }
  if (!Number.isFinite(startMs)) {
    return { status: "error", message: "Start time is required." };
  }
  if (!Number.isFinite(endMs)) {
    return { status: "error", message: "End time is required." };
  }
  if (endMs <= startMs) {
    return { status: "error", message: "End time must be after start time." };
  }

  const snValidation = await validateServiceNowMetadata(taskData || {});
  if (snValidation.status !== "success") {
    return snValidation;
  }

  const blocks = await getTimeBlocks();
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  if (blockIndex === -1) {
    return { status: "error", message: "Time block not found." };
  }

  const existing = blocks[blockIndex];
  const updated = withServiceNowMetadata(
    {
      ...existing,
      task,
      startMs,
      endMs,
      durationMs: endMs - startMs,
    },
    taskData,
    task
  );

  blocks[blockIndex] = updated;
  await saveTimeBlocks(blocks);

  if (!timerData.isRunning && timerData.savedTaskName) {
    await refreshElapsedTimeForTask(timerData.savedTaskName);
  }

  return { status: "success" };
}

async function deleteTimeBlock(blockId) {
  if (!blockId) {
    return { status: "error", message: "Block id is required." };
  }

  const blocks = await getTimeBlocks();
  const filteredBlocks = blocks.filter((block) => block.id !== blockId);
  if (filteredBlocks.length === blocks.length) {
    return { status: "error", message: "Time block not found." };
  }

  await saveTimeBlocks(filteredBlocks);

  if (!timerData.isRunning && timerData.savedTaskName) {
    await refreshElapsedTimeForTask(timerData.savedTaskName);
  }

  return { status: "success" };
}

function createTimeBlock(task, startMs, endMs, source, taskData = {}) {
  const base = {
    id: generateBlockId(),
    task,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    source,
    createdAtMs: Date.now(),
  };

  return withServiceNowMetadata(base, taskData, task);
}

function generateBlockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sumDurationForTask(blocks, taskName) {
  return blocks
    .filter((block) => block.task === taskName)
    .reduce((sum, block) => sum + block.durationMs, 0);
}

async function refreshElapsedTimeForTask(taskName) {
  if (!taskName) {
    timerData.elapsedTime = 0;
    elapsedBeforeActiveMs = 0;
    return;
  }

  const blocks = await getTimeBlocks();
  elapsedBeforeActiveMs = sumDurationForTask(blocks, taskName);
  timerData.elapsedTime = elapsedBeforeActiveMs;
}

function broadcastTimerUpdate() {
  chrome.runtime.sendMessage({
    action: "updateTime",
    elapsedTime: transformMilisecondsToTime(timerData.elapsedTime),
  });
}

async function startTimer(taskName, taskData = {}) {
  if (timerData.isRunning || timerInterval !== null) {
    return { status: "started" };
  }

  const previousTaskName = timerData.savedTaskName;
  const normalizedTaskName = (taskName || timerData.savedTaskName || "").trim();
  if (!normalizedTaskName) {
    return { status: "error", message: "Task name is required." };
  }

  const isSameTask = previousTaskName === normalizedTaskName;
  const hasIncomingMetadata = Boolean(
    taskData &&
      (taskData.snSelectionType ||
        taskData.snTaskSysId ||
        taskData.snCategorySysId ||
        taskData.snCodeSysId)
  );
  const candidateMetadata = hasIncomingMetadata
    ? taskData
    : isSameTask
      ? {
          snSelectionType: timerData.snSelectionType,
          snTaskSysId: timerData.snTaskSysId,
          snTaskNumber: timerData.snTaskNumber,
          snTaskShortDescription: timerData.snTaskShortDescription,
          snCategorySysId: timerData.snCategorySysId,
          snCategoryValue: timerData.snCategoryValue,
          snCategoryLabel: timerData.snCategoryLabel,
          snCodeSysId: timerData.snCodeSysId,
          snCodeValue: timerData.snCodeValue,
          snCodeDescription: timerData.snCodeDescription,
          snCommentText: timerData.snCommentText,
        }
      : {};

  const snValidation = await validateServiceNowMetadata(candidateMetadata);
  if (snValidation.status !== "success") {
    return snValidation;
  }

  timerData.savedTaskName = normalizedTaskName;
  Object.assign(timerData, normalizeServiceNowMetadata(candidateMetadata));

  await refreshElapsedTimeForTask(timerData.savedTaskName);

  activeBlockStartMs = Date.now();
  timerData.isRunning = true;

  timerInterval = setInterval(() => {
    if (!timerData.isRunning || activeBlockStartMs === null) {
      return;
    }
    timerData.elapsedTime = elapsedBeforeActiveMs + (Date.now() - activeBlockStartMs);
    broadcastTimerUpdate();
  }, 1000);

  return { status: "started" };
}

async function stopTimer() {
  if (!timerData.isRunning) {
    return { status: "stopped" };
  }

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (activeBlockStartMs === null) {
    timerData.isRunning = false;
    return { status: "stopped" };
  }

  const endMs = Date.now();
  const newBlock = createTimeBlock(
    timerData.savedTaskName,
    activeBlockStartMs,
    endMs,
    "timer",
    {
      snSelectionType: timerData.snSelectionType,
      snTaskSysId: timerData.snTaskSysId,
      snTaskNumber: timerData.snTaskNumber,
      snTaskShortDescription: timerData.snTaskShortDescription,
      snCategorySysId: timerData.snCategorySysId,
      snCategoryValue: timerData.snCategoryValue,
      snCategoryLabel: timerData.snCategoryLabel,
      snCodeSysId: timerData.snCodeSysId,
      snCodeValue: timerData.snCodeValue,
      snCodeDescription: timerData.snCodeDescription,
      snCommentText: timerData.snCommentText,
    }
  );
  await appendTimeBlock(newBlock);

  activeBlockStartMs = null;
  timerData.isRunning = false;
  elapsedBeforeActiveMs += newBlock.durationMs;
  timerData.elapsedTime = elapsedBeforeActiveMs;
  timerData.lastSaved = getTimeStringFromMs(endMs);
  broadcastTimerUpdate();

  return { status: "stopped" };
}

async function finishTimer() {
  if (timerData.isRunning) {
    await stopTimer();
  }

  const elapsedTime = timerData.elapsedTime;
  timerData = {
    savedTaskName: "",
    isRunning: false,
    elapsedTime: 0,
    lastSaved: "",
    snSelectionType: "",
    snTaskSysId: "",
    snTaskNumber: "",
    snTaskShortDescription: "",
    snCategorySysId: "",
    snCategoryValue: "",
    snCategoryLabel: "",
    snCodeSysId: "",
    snCodeValue: "",
    snCodeDescription: "",
    snCommentText: "",
  };
  elapsedBeforeActiveMs = 0;
  activeBlockStartMs = null;

  return elapsedTime;
}

function aggregateBlocksByTask(blocks) {
  const grouped = new Map();

  for (const block of blocks) {
    if (!grouped.has(block.task)) {
      grouped.set(block.task, {
        task: block.task,
        duration: 0,
        lastSavedMs: 0,
        lastSaved: "",
      });
    }

    const current = grouped.get(block.task);
    current.duration += block.durationMs;
    if (block.endMs > current.lastSavedMs) {
      current.lastSavedMs = block.endMs;
      current.lastSaved = getTimeStringFromMs(block.endMs);
    }
  }

  return Array.from(grouped.values())
    .map(({ lastSavedMs, ...session }) => session)
    .sort((a, b) => b.duration - a.duration);
}

function getStartOfWeek(date) {
  const localDate = new Date(date);
  const dayOfWeek = localDate.getDay();
  const sundayBasedOffset = -dayOfWeek;
  localDate.setHours(0, 0, 0, 0);
  localDate.setDate(localDate.getDate() + sundayBasedOffset);
  return localDate;
}

function getPeriodKey(ms, periodType) {
  const date = new Date(ms);
  if (periodType === "day") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;
  }

  const weekStart = getStartOfWeek(date);
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(weekStart.getDate()).padStart(2, "0")}`;
}

function aggregateBlocksByPeriod(blocks, periodType = "day") {
  const grouped = new Map();

  for (const block of blocks) {
    const periodKey = getPeriodKey(block.startMs, periodType);
    if (!grouped.has(periodKey)) {
      grouped.set(periodKey, { period: periodKey, duration: 0 });
    }
    grouped.get(periodKey).duration += block.durationMs;
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );
}

async function getAggregatedSessions() {
  const blocks = await getTimeBlocks();
  return aggregateBlocksByTask(blocks);
}

async function saveManualSession(taskData) {
  const task = (taskData.taskName || "").trim();
  const rawStartMs = taskData.startTimeMs ?? taskData.startTime;
  const rawEndMs = taskData.endTimeMs;
  const startMs = Number(rawStartMs);
  const endMsFromInput = Number(rawEndMs);
  const durationFromInput = Number(taskData.taskDuration);

  if (!task) {
    return { status: "error", message: "Task name is required." };
  }
  if (!Number.isFinite(startMs)) {
    return { status: "error", message: "Start time is required." };
  }

  let endMs;
  if (Number.isFinite(endMsFromInput)) {
    endMs = endMsFromInput;
  } else if (Number.isFinite(durationFromInput) && durationFromInput > 0) {
    endMs = startMs + durationFromInput;
  } else {
    return { status: "error", message: "End time is required." };
  }

  if (endMs <= startMs) {
    return { status: "error", message: "End time must be after start time." };
  }

  const snValidation = await validateServiceNowMetadata(taskData || {});
  if (snValidation.status !== "success") {
    return snValidation;
  }

  const block = createTimeBlock(task, startMs, endMs, "manual", taskData);
  await appendTimeBlock(block);

  if (!timerData.isRunning && timerData.savedTaskName === task) {
    await refreshElapsedTimeForTask(task);
  }

  return { status: "success" };
}

const SN_BRIDGE_TIMEOUT_MS = 15000;

function createSnError(code, message, recoveryHint = "") {
  const payload = { status: "error", code, message };
  if (recoveryHint) {
    payload.data = { recoveryHint };
  }
  return payload;
}

function createSnRequestId() {
  return `sn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getServiceNowConfig() {
  const result = await storageGet([SN_CONFIG_KEY]);
  const config = result[SN_CONFIG_KEY] || DEFAULT_SN_CONFIG;
  return {
    enabled: Boolean(config.enabled),
    instanceUrl: config.instanceUrl || "",
  };
}

async function saveServiceNowConfig(configInput) {
  const enabled = Boolean(configInput?.enabled);
  const rawUrl = configInput?.instanceUrl || "";
  const instanceUrl = normalizeInstanceUrl(rawUrl);

  if (enabled && !instanceUrl) {
    return createSnError(
      "SN_NO_CONFIG",
      "ServiceNow URL must be HTTPS origin only (for example, https://your-instance.service-now.com).",
      "Remove any path, query, or hash from the URL."
    );
  }

  const config = {
    enabled,
    instanceUrl: instanceUrl || "",
  };

  await storageSet({ [SN_CONFIG_KEY]: config });
  return { status: "success", data: config };
}

async function ensureServiceNowPermission(instanceUrl) {
  const normalized = normalizeInstanceUrl(instanceUrl || "");
  if (!normalized) {
    return createSnError(
      "SN_NO_CONFIG",
      "A valid HTTPS ServiceNow instance URL is required.",
      "Set the instance URL in ServiceNow settings first."
    );
  }

  const originPattern = `${normalized}/*`;
  const permissionPayload = { origins: [originPattern] };
  const hasPermission = await permissionsContains(permissionPayload);
  if (hasPermission) {
    return { status: "success" };
  }

  const granted = await permissionsRequest(permissionPayload);
  if (!granted) {
    return createSnError(
      "SN_PERMISSION_DENIED",
      "ServiceNow host permission was not granted.",
      `Approve access for ${normalized}, then retry Connect.`
    );
  }

  return { status: "success" };
}

async function findActiveSessionTab(config) {
  if (!config.enabled || !config.instanceUrl) {
    return createSnError(
      "SN_NO_CONFIG",
      "ServiceNow integration is not configured.",
      "Enable integration and save a valid instance URL first."
    );
  }

  const tabs = await queryTabs({ url: `${config.instanceUrl}/*` });
  if (!tabs || tabs.length === 0) {
    return createSnError(
      "SN_NO_TAB",
      `No active tab for ${config.instanceUrl} was found.`,
      `Open and log in to ${config.instanceUrl} in a browser tab, then retry.`
    );
  }

  const preferredTabs = [...tabs].sort((a, b) => {
    if (a.id === lastConnectedSnTabId) {
      return -1;
    }
    if (b.id === lastConnectedSnTabId) {
      return 1;
    }
    if (a.active && !b.active) {
      return -1;
    }
    if (!a.active && b.active) {
      return 1;
    }
    const aLastAccessed = Number(a.lastAccessed) || 0;
    const bLastAccessed = Number(b.lastAccessed) || 0;
    return bLastAccessed - aLastAccessed;
  });

  return { status: "success", data: preferredTabs };
}

async function ensureSnBridgeReady(tabId) {
  try {
    const ping = await tabsSendMessage(tabId, { action: "sn_bridge_ping" });
    if (ping?.status === "success") {
      return { status: "success" };
    }
  } catch {
    // Continue with bootstrap fallback.
  }

  try {
    await executeScriptFileOnTab(tabId, ["sn_content_bridge.js"]);
    const ping = await tabsSendMessage(tabId, { action: "sn_bridge_ping" });
    if (ping?.status === "success") {
      return { status: "success" };
    }
    return createSnError(
      "SN_API_ERROR",
      "ServiceNow bridge is not ready in the active tab.",
      "Reload the ServiceNow tab and retry."
    );
  } catch (error) {
    return createSnError(
      "SN_API_ERROR",
      error?.message || "Unable to initialize ServiceNow bridge.",
      "Reload the ServiceNow tab and retry Connect."
    );
  }
}

async function sendSnBridgeRequest(tabId, instanceOrigin, action, payload = {}) {
  const bridgeReady = await ensureSnBridgeReady(tabId);
  if (bridgeReady.status !== "success") {
    return bridgeReady;
  }

  const envelope = {
    requestId: createSnRequestId(),
    action,
    payload,
    timeoutMs: SN_BRIDGE_TIMEOUT_MS,
  };

  try {
    const response = await tabsSendMessage(tabId, {
      action: "sn_bridge_request",
      instanceOrigin,
      envelope,
    });

    if (!response) {
      return createSnError(
        "SN_API_ERROR",
        "ServiceNow bridge did not return a response.",
        "Reload the ServiceNow tab and retry."
      );
    }

    if (response.status === "success") {
      return response;
    }

    return createSnError(
      response.code || "SN_API_ERROR",
      response.message || "ServiceNow request failed.",
      response.data?.recoveryHint || "Retry after reloading the ServiceNow tab."
    );
  } catch (error) {
    return createSnError(
      "SN_API_ERROR",
      error?.message || "Failed to communicate with ServiceNow tab.",
      "Ensure the ServiceNow tab is open and reload it."
    );
  }
}

async function connectServiceNowSession() {
  const config = await getServiceNowConfig();
  if (!config.enabled || !config.instanceUrl) {
    return createSnError(
      "SN_NO_CONFIG",
      "ServiceNow integration is disabled or missing URL.",
      "Enable integration and save a valid instance URL."
    );
  }

  const permissionResponse = await ensureServiceNowPermission(config.instanceUrl);
  if (permissionResponse.status !== "success") {
    return permissionResponse;
  }

  const tabResponse = await findActiveSessionTab(config);
  if (tabResponse.status !== "success") {
    return tabResponse;
  }

  const tabCandidates = Array.isArray(tabResponse.data) ? tabResponse.data : [];
  let lastSessionError = null;

  for (const tab of tabCandidates) {
    const sessionResponse = await sendSnBridgeRequest(tab.id, config.instanceUrl, "checkSession");
    if (sessionResponse.status === "success") {
      lastConnectedSnTabId = tab.id;
      lastConnectedSnUserId = sessionResponse.data?.userId || "";
      return {
        status: "success",
        data: {
          instanceUrl: config.instanceUrl,
          tabId: tab.id,
          userId: sessionResponse.data?.userId || "",
          userName: sessionResponse.data?.userName || "",
        },
      };
    }

    lastSessionError = sessionResponse;
  }

  lastConnectedSnTabId = null;
  lastConnectedSnUserId = "";
  return (
    lastSessionError ||
    createSnError(
      "SN_NOT_LOGGED_IN",
      "No active ServiceNow session was found in open instance tabs.",
      `Open and log in to ${config.instanceUrl} and retry.`
    )
  );
}

function readDisplayValue(value) {
  if (value && typeof value === "object") {
    if (typeof value.display_value === "string") {
      return value.display_value;
    }
    if (typeof value.value === "string") {
      return value.value;
    }
  }
  return value || "";
}

async function serviceNowCheckSession() {
  return connectServiceNowSession();
}

async function serviceNowFetchLookups() {
  const connectResponse = await connectServiceNowSession();
  if (connectResponse.status !== "success") {
    return connectResponse;
  }

  const pageResponse = await sendSnBridgeRequest(
    connectResponse.data.tabId,
    connectResponse.data.instanceUrl,
    "fetchLookups",
    {
      userId: connectResponse.data.userId || lastConnectedSnUserId || "",
    }
  );
  if (pageResponse.status !== "success") {
    return pageResponse;
  }

  const tasks = Array.isArray(pageResponse.data?.tasks)
    ? pageResponse.data.tasks
        .map((item) => ({
          sys_id: readDisplayValue(item.sys_id),
          number: String(readDisplayValue(item.number) || ""),
          short_description: String(readDisplayValue(item.short_description) || ""),
          state: String(readDisplayValue(item.state) || ""),
        }))
        .filter((item) => item.sys_id)
    : [];

  const categories = Array.isArray(pageResponse.data?.categories)
    ? pageResponse.data.categories
        .map((item) => {
          const sequenceValue = Number(readDisplayValue(item.sequence));
          return {
            sys_id: readDisplayValue(item.sys_id),
            value: String(readDisplayValue(item.value) || ""),
            label: String(readDisplayValue(item.label) || ""),
            language: String(readDisplayValue(item.language) || ""),
            sequence: Number.isFinite(sequenceValue) ? sequenceValue : 0,
          };
        })
        .filter((item) => item.sys_id && item.value)
        .filter((item) => item.language === "en")
        .sort((a, b) => a.sequence - b.sequence)
    : [];

  const timeCodes = Array.isArray(pageResponse.data?.timeCodes)
    ? pageResponse.data.timeCodes
        .map((item) => {
          const codeValue = String(readDisplayValue(item.u_time_card_code) || "");
          const descriptionValue = String(readDisplayValue(item.u_description) || "");
          return {
            sys_id: readDisplayValue(item.sys_id),
            u_time_card_code: codeValue,
            u_description: descriptionValue,
            label: descriptionValue ? `${codeValue} | ${descriptionValue}` : codeValue,
          };
        })
        .filter((item) => item.sys_id && item.u_time_card_code)
    : [];

  const cache = {
    fetchedAtMs: Date.now(),
    tasks,
    categories,
    timeCodes,
  };

  await storageSet({ [SN_LOOKUP_CACHE_KEY]: cache });
  return { status: "success", data: cache };
}

async function getCachedLookups() {
  const result = await storageGet([SN_LOOKUP_CACHE_KEY]);
  const cache = result[SN_LOOKUP_CACHE_KEY] || {
    fetchedAtMs: 0,
    tasks: [],
    categories: [],
    timeCodes: [],
  };

  return {
    fetchedAtMs: Number(cache.fetchedAtMs) || 0,
    tasks: Array.isArray(cache.tasks) ? cache.tasks : [],
    categories: Array.isArray(cache.categories) ? cache.categories : [],
    timeCodes: Array.isArray(cache.timeCodes) ? cache.timeCodes : [],
  };
}

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function getTimeStringFromMs(ms) {
  const date = new Date(ms);
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };

  return date.toLocaleString(undefined, options).replace(",", "");
}

async function clearSessions() {
  await storageSet({
    [TIME_BLOCKS_KEY]: [],
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === "start") {
      const response = await startTimer(request.taskName, request.taskData || {});
      sendResponse(response);
    } else if (request.action === "stop") {
      const response = await stopTimer();
      sendResponse(response);
    } else if (request.action === "finish") {
      const elapsedTime = await finishTimer();
      sendResponse({ status: "finished", elapsedTime });
    } else if (request.action === "checkStatus") {
      if (timerData.isRunning && activeBlockStartMs !== null) {
        timerData.elapsedTime = elapsedBeforeActiveMs + (Date.now() - activeBlockStartMs);
      }
      sendResponse({ timerData });
    } else if (request.action === "saveManualSession") {
      const response = await saveManualSession(request.taskData);
      sendResponse(response);
    } else if (request.action === "updateTimeBlock") {
      const response = await updateTimeBlock(request.blockId, request.taskData);
      sendResponse(response);
    } else if (request.action === "deleteTimeBlock") {
      const response = await deleteTimeBlock(request.blockId);
      sendResponse(response);
    } else if (request.action === "getSessions" || request.action === "getAggregatedSessions") {
      const sessions = await getAggregatedSessions();
      sendResponse({ status: "success", data: sessions });
    } else if (request.action === "getTimeBlocks") {
      const blocks = await getTimeBlocks();
      sendResponse({ status: "success", data: blocks });
    } else if (request.action === "getAggregatedByPeriod") {
      const blocks = await getTimeBlocks();
      const periodType = request.periodType === "week" ? "week" : "day";
      const aggregated = aggregateBlocksByPeriod(blocks, periodType);
      sendResponse({ status: "success", data: aggregated });
    } else if (request.action === "clearSessions") {
      await clearSessions();
      sendResponse({ status: "cleared" });
    } else if (request.action === "servicenow/getConfig") {
      sendResponse({ status: "success", data: await getServiceNowConfig() });
    } else if (request.action === "servicenow/saveConfig") {
      const response = await saveServiceNowConfig(request.config);
      sendResponse(response);
    } else if (request.action === "servicenow/connect") {
      const response = await connectServiceNowSession();
      sendResponse(response);
    } else if (request.action === "servicenow/checkSession") {
      const response = await serviceNowCheckSession();
      sendResponse(response);
    } else if (request.action === "servicenow/fetchLookups") {
      const response = await serviceNowFetchLookups();
      sendResponse(response);
    } else if (request.action === "servicenow/getCachedLookups") {
      sendResponse({ status: "success", data: await getCachedLookups() });
    } else {
      sendResponse({ status: "error", message: "Unsupported action." });
    }
  })().catch((error) => {
    console.error("Background message handling error:", error);
    sendResponse({ status: "error", message: "Unexpected error." });
  });

  return true;
});
