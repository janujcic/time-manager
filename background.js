const TIME_BLOCKS_KEY = "timeBlocks";
const SN_CONFIG_KEY = "sn_config";
const SN_LOOKUP_CACHE_KEY = "sn_lookup_cache";
const TIMER_RUNTIME_KEY = "timer_runtime";
const DEPRECATED_STORAGE_KEYS = ["timeSessions", "sn_timecards_cache", "sn_last_sync_report"];

const DEFAULT_SN_CONFIG = {
  enabled: false,
  instanceUrl: "",
};
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_FIELDS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const ACTION_DEFAULT_TITLE = "Time Manager";
const ACTION_RUNNING_BADGE_COLOR = [46, 125, 50, 255];
const ACTION_PAUSED_BADGE_COLOR = [245, 124, 0, 255];
const ACTION_UPDATE_THROTTLE_MS = 15000;
const ACTION_TITLE_TASK_MAX_LENGTH = 60;

function createDefaultTimerData() {
  return {
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
}

let timerData = createDefaultTimerData();
let timerInterval = null;
let activeBlockStartMs = null;
let elapsedBeforeActiveMs = 0;
let lastConnectedSnTabId = null;
let lastConnectedSnUserId = "";
let lastActionIndicatorUpdateMs = 0;
let lastActionIndicatorMinute = -1;

const initializationPromise = initializeStorage().catch((error) => {
  console.error("Storage initialization failed:", error);
});

async function initializeStorage() {
  const result = await storageGet([
    TIME_BLOCKS_KEY,
    SN_CONFIG_KEY,
    SN_LOOKUP_CACHE_KEY,
    TIMER_RUNTIME_KEY,
    ...DEPRECATED_STORAGE_KEYS,
  ]);
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
    await storageSet(updatePayload);
  }

  const keysToRemove = DEPRECATED_STORAGE_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(result, key)
  );
  if (keysToRemove.length > 0) {
    await storageRemove(keysToRemove);
  }

  await restoreTimerRuntime(result[TIMER_RUNTIME_KEY]);
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

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
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

function truncateText(text, maxLength) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getRunningBadgeText(elapsedMs) {
  const safeElapsed = Math.max(0, Number(elapsedMs) || 0);
  const minutes = Math.floor(safeElapsed / (60 * 1000));
  return minutes > 99 ? "99m+" : `${minutes}m`;
}

function buildActionTitle(stateLabel, taskName, elapsedMs) {
  const compactTask = truncateText(taskName, ACTION_TITLE_TASK_MAX_LENGTH) || "No active task";
  const elapsedText = transformMilisecondsToTime(Math.max(0, Number(elapsedMs) || 0));
  return `${stateLabel}: ${compactTask}\nElapsed: ${elapsedText}`;
}

function runActionApi(methodName, details) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.action || typeof chrome.action[methodName] !== "function") {
        resolve();
        return;
      }
      chrome.action[methodName](details, () => {
        resolve();
      });
    } catch (error) {
      console.warn(`Action API call failed: ${methodName}`, error);
      resolve();
    }
  });
}

async function clearActionIndicator() {
  lastActionIndicatorUpdateMs = 0;
  lastActionIndicatorMinute = -1;
  await runActionApi("setBadgeText", { text: "" });
  await runActionApi("setTitle", { title: ACTION_DEFAULT_TITLE });
}

async function updateActionIndicator(force = false) {
  const hasTask = Boolean(readString(timerData.savedTaskName));
  if (!hasTask) {
    await clearActionIndicator();
    return;
  }

  if (timerData.isRunning) {
    const elapsedMs =
      elapsedBeforeActiveMs +
      (activeBlockStartMs !== null ? Math.max(0, Date.now() - activeBlockStartMs) : 0);
    const elapsedMinute = Math.floor(elapsedMs / (60 * 1000));
    const now = Date.now();
    const shouldSkip =
      !force &&
      elapsedMinute === lastActionIndicatorMinute &&
      now - lastActionIndicatorUpdateMs < ACTION_UPDATE_THROTTLE_MS;
    if (shouldSkip) {
      return;
    }

    await runActionApi("setBadgeBackgroundColor", { color: ACTION_RUNNING_BADGE_COLOR });
    await runActionApi("setBadgeText", { text: getRunningBadgeText(elapsedMs) });
    await runActionApi("setTitle", {
      title: buildActionTitle("Running", timerData.savedTaskName, elapsedMs),
    });
    lastActionIndicatorUpdateMs = now;
    lastActionIndicatorMinute = elapsedMinute;
    return;
  }

  const pausedElapsed = Math.max(0, Number(timerData.elapsedTime) || 0);
  await runActionApi("setBadgeBackgroundColor", { color: ACTION_PAUSED_BADGE_COLOR });
  await runActionApi("setBadgeText", { text: "PAUSE" });
  await runActionApi("setTitle", {
    title: buildActionTitle("Paused", timerData.savedTaskName, pausedElapsed),
  });
  lastActionIndicatorUpdateMs = Date.now();
  lastActionIndicatorMinute = Math.floor(pausedElapsed / (60 * 1000));
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
  if (metadata.snSelectionType !== "task" && metadata.snSelectionType !== "category") {
    return { status: "error", message: "Task or category selection is required." };
  }

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
    if (!metadata.snCommentText) {
      return { status: "error", message: "Extra notes are required for category entries." };
    }
  }

  return { status: "success" };
}

function withServiceNowMetadata(base, taskData) {
  const metadata = normalizeServiceNowMetadata(taskData);
  return {
    ...base,
    ...metadata,
  };
}

function getPersistableTimerRuntime() {
  const metadata = normalizeServiceNowMetadata(timerData);
  return {
    savedTaskName: timerData.savedTaskName || "",
    isRunning: Boolean(timerData.isRunning),
    lastSaved: timerData.lastSaved || "",
    elapsedBeforeActiveMs: Number(elapsedBeforeActiveMs) || 0,
    activeBlockStartMs: Number.isFinite(activeBlockStartMs) ? activeBlockStartMs : null,
    ...metadata,
  };
}

async function persistTimerRuntime() {
  await storageSet({ [TIMER_RUNTIME_KEY]: getPersistableTimerRuntime() });
}

async function clearTimerRuntime() {
  await storageSet({ [TIMER_RUNTIME_KEY]: null });
}

function ensureTimerIntervalRunning() {
  if (timerInterval !== null) {
    return;
  }
  timerInterval = setInterval(() => {
    if (!timerData.isRunning || activeBlockStartMs === null) {
      return;
    }
    timerData.elapsedTime = elapsedBeforeActiveMs + (Date.now() - activeBlockStartMs);
    broadcastTimerUpdate();
    void updateActionIndicator(false);
  }, 1000);
}

async function restoreTimerRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    timerData = createDefaultTimerData();
    activeBlockStartMs = null;
    elapsedBeforeActiveMs = 0;
    await clearActionIndicator();
    return;
  }

  const restoredTask = readString(runtime.savedTaskName);
  if (!restoredTask) {
    timerData = createDefaultTimerData();
    activeBlockStartMs = null;
    elapsedBeforeActiveMs = 0;
    await clearActionIndicator();
    return;
  }

  timerData = {
    ...createDefaultTimerData(),
    savedTaskName: restoredTask,
    isRunning: Boolean(runtime.isRunning),
    lastSaved: readString(runtime.lastSaved),
    ...normalizeServiceNowMetadata(runtime),
  };

  await refreshElapsedTimeForTask(restoredTask);
  const storedElapsed = Number(runtime.elapsedBeforeActiveMs);
  if (Number.isFinite(storedElapsed) && storedElapsed >= 0) {
    elapsedBeforeActiveMs = storedElapsed;
    timerData.elapsedTime = storedElapsed;
  }

  const storedStart = Number(runtime.activeBlockStartMs);
  if (timerData.isRunning && Number.isFinite(storedStart) && storedStart > 0) {
    activeBlockStartMs = storedStart;
    timerData.elapsedTime = elapsedBeforeActiveMs + (Date.now() - activeBlockStartMs);
    ensureTimerIntervalRunning();
  } else {
    activeBlockStartMs = null;
    timerData.isRunning = false;
  }
  await updateActionIndicator(true);
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
  const updated = withServiceNowMetadata({
    ...existing,
    task,
    startMs,
    endMs,
    durationMs: endMs - startMs,
  }, taskData);

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

  return withServiceNowMetadata(base, taskData);
}

function generateBlockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function refreshElapsedTimeForTask() {
  elapsedBeforeActiveMs = 0;
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
  await persistTimerRuntime();
  ensureTimerIntervalRunning();
  await updateActionIndicator(true);

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
    await persistTimerRuntime();
    await updateActionIndicator(true);
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
  await persistTimerRuntime();
  await updateActionIndicator(true);
  broadcastTimerUpdate();

  return { status: "stopped" };
}

async function finishTimer() {
  if (timerData.isRunning) {
    await stopTimer();
  }

  const elapsedTime = timerData.elapsedTime;
  timerData = createDefaultTimerData();
  elapsedBeforeActiveMs = 0;
  activeBlockStartMs = null;
  await clearTimerRuntime();
  await clearActionIndicator();

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
  const mondayBasedOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  localDate.setHours(0, 0, 0, 0);
  localDate.setDate(localDate.getDate() + mondayBasedOffset);
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

function roundHours(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatDateKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function getWeekdayFieldName(ms) {
  const day = new Date(ms).getDay();
  if (day === 0) {
    return "sunday";
  }
  return WEEKDAY_FIELDS[day - 1];
}

function splitBlockByDay(block) {
  const startMs = Number(block.startMs);
  const endMs = Number(block.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const slices = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const cursorDate = new Date(cursor);
    cursorDate.setHours(0, 0, 0, 0);
    const nextDayMs = cursorDate.getTime() + DAY_MS;
    const sliceEnd = Math.min(endMs, nextDayMs);
    if (sliceEnd > cursor) {
      slices.push({
        startMs: cursor,
        endMs: sliceEnd,
        durationMs: sliceEnd - cursor,
      });
    }
    cursor = sliceEnd;
  }

  return slices;
}

function buildSyncGroupKey(block, weekStartDate) {
  const selectionType = block.snSelectionType || "";
  const selectionKey =
    selectionType === "task"
      ? `task:${block.snTaskSysId || ""}`
      : selectionType === "category"
        ? `category:${block.snCategorySysId || block.snCategoryValue || ""}`
        : "none";
  return `${weekStartDate}|${selectionType}|${selectionKey}|${block.snCodeSysId || ""}`;
}

function aggregateBlocksForSync(blocks, blockIds = []) {
  const allowedIds = new Set(
    (Array.isArray(blockIds) ? blockIds : []).map((id) => String(id || "")).filter(Boolean)
  );
  const useFilter = allowedIds.size > 0;
  const groups = new Map();
  const invalidBlocks = [];

  for (const block of blocks) {
    const blockId = String(block.id || "");
    if (useFilter && !allowedIds.has(blockId)) {
      continue;
    }

    if (!block.snSelectionType || !block.snCodeSysId) {
      invalidBlocks.push({ blockId, reason: "missing assignment or time code" });
      continue;
    }
    if (block.snSelectionType === "task" && !block.snTaskSysId) {
      invalidBlocks.push({ blockId, reason: "missing task sys_id" });
      continue;
    }
    if (block.snSelectionType === "category") {
      if (!block.snCategoryValue) {
        invalidBlocks.push({ blockId, reason: "missing category value" });
        continue;
      }
      if (!String(block.snCommentText || "").trim()) {
        invalidBlocks.push({ blockId, reason: "missing category notes" });
        continue;
      }
    }

    const slices = splitBlockByDay(block);
    if (slices.length === 0) {
      invalidBlocks.push({ blockId, reason: "invalid block duration" });
      continue;
    }

    for (const slice of slices) {
      const weekStartDate = formatDateKey(getStartOfWeek(slice.startMs).getTime());
      const groupKey = buildSyncGroupKey(block, weekStartDate);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          weekStartDate,
          snSelectionType: block.snSelectionType || "",
          snTaskSysId: block.snTaskSysId || "",
          snTaskNumber: block.snTaskNumber || "",
          snTaskShortDescription: block.snTaskShortDescription || "",
          snCategorySysId: block.snCategorySysId || "",
          snCategoryValue: block.snCategoryValue || "",
          snCategoryLabel: block.snCategoryLabel || "",
          snCodeSysId: block.snCodeSysId || "",
          snCodeValue: block.snCodeValue || "",
          snCodeDescription: block.snCodeDescription || "",
          dayHours: {
            monday: 0,
            tuesday: 0,
            wednesday: 0,
            thursday: 0,
            friday: 0,
            saturday: 0,
            sunday: 0,
          },
          totalHours: 0,
          comments: [],
          blockIds: [],
        });
      }

      const group = groups.get(groupKey);
      const weekdayField = getWeekdayFieldName(slice.startMs);
      const sliceHours = slice.durationMs / (60 * 60 * 1000);
      group.dayHours[weekdayField] += sliceHours;
      group.totalHours += sliceHours;
      if (!group.blockIds.includes(blockId)) {
        group.blockIds.push(blockId);
      }
      const trimmedComment = String(block.snCommentText || "").trim();
      if (trimmedComment && !group.comments.includes(trimmedComment)) {
        group.comments.push(trimmedComment);
      }
    }
  }

  const normalizedGroups = Array.from(groups.values()).map((group) => {
    const dayHours = {};
    for (const field of WEEKDAY_FIELDS) {
      dayHours[field] = roundHours(group.dayHours[field]);
    }
    const totalHours = roundHours(
      WEEKDAY_FIELDS.reduce((sum, field) => sum + dayHours[field], 0)
    );

    return {
      ...group,
      dayHours,
      totalHours,
    };
  });

  return {
    groups: normalizedGroups,
    invalidBlocks,
    requestedBlockCount: useFilter ? allowedIds.size : blocks.length,
  };
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

function compareTimeCodes(a, b) {
  const codeA = String(a?.u_time_card_code || "").toLowerCase();
  const codeB = String(b?.u_time_card_code || "").toLowerCase();
  const codeCompare = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: "base" });
  if (codeCompare !== 0) {
    return codeCompare;
  }

  const descA = String(a?.u_description || "").toLowerCase();
  const descB = String(b?.u_description || "").toLowerCase();
  return descA.localeCompare(descB, undefined, { numeric: true, sensitivity: "base" });
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
        .sort(compareTimeCodes)
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
    timeCodes: Array.isArray(cache.timeCodes) ? [...cache.timeCodes].sort(compareTimeCodes) : [],
  };
}

function createSyncReportSkeleton(rangePreset, aggregation) {
  return {
    rangePreset,
    requestedBlockCount: Number(aggregation.requestedBlockCount) || 0,
    groupCount: Array.isArray(aggregation.groups) ? aggregation.groups.length : 0,
    invalidBlocks: Array.isArray(aggregation.invalidBlocks) ? aggregation.invalidBlocks : [],
    skippedInvalid: Array.isArray(aggregation.invalidBlocks) ? aggregation.invalidBlocks.length : 0,
    synced: 0,
    created: 0,
    updated: 0,
    skippedSubmitted: 0,
    failed: 0,
    details: [],
  };
}

function mergeSyncResultIntoReport(report, result) {
  const normalized = {
    groupKey: String(result?.groupKey || ""),
    weekStartDate: String(result?.weekStartDate || ""),
    status: String(result?.status || ""),
    code: String(result?.code || ""),
    action: String(result?.action || ""),
    message: String(result?.message || ""),
    timeCardSysId: String(result?.timeCardSysId || ""),
  };
  report.details.push(normalized);

  if (normalized.action === "created") {
    report.created += 1;
    report.synced += 1;
    return;
  }
  if (normalized.action === "updated") {
    report.updated += 1;
    report.synced += 1;
    return;
  }
  if (normalized.code === "SYNC_SUBMITTED_SKIP") {
    report.skippedSubmitted += 1;
    return;
  }
  if (normalized.status === "error" || normalized.code) {
    report.failed += 1;
  }
}

async function serviceNowSyncVisibleBlocks(requestData = {}) {
  const rangePreset = readString(requestData.rangePreset);
  if (!rangePreset || rangePreset === "all") {
    return createSnError(
      "SN_API_ERROR",
      "Sync is only available for a bounded range (today/week/month/custom).",
      "Switch from All Time to a specific range and retry."
    );
  }

  const blockIds = Array.isArray(requestData.blockIds)
    ? requestData.blockIds.map((id) => String(id || "")).filter(Boolean)
    : [];
  if (blockIds.length === 0) {
    return createSnError(
      "SN_API_ERROR",
      "No time blocks were provided for sync.",
      "Select a range with visible blocks, then retry."
    );
  }

  const connectResponse = await connectServiceNowSession();
  if (connectResponse.status !== "success") {
    return connectResponse;
  }

  const allBlocks = await getTimeBlocks();
  const aggregation = aggregateBlocksForSync(allBlocks, blockIds);
  const report = createSyncReportSkeleton(rangePreset, aggregation);
  if (aggregation.groups.length === 0) {
    return { status: "success", data: report };
  }

  const bridgeResponse = await sendSnBridgeRequest(
    connectResponse.data.tabId,
    connectResponse.data.instanceUrl,
    "syncTimeCards",
    {
      userId: connectResponse.data.userId || lastConnectedSnUserId || "",
      groups: aggregation.groups,
    }
  );
  if (bridgeResponse.status !== "success") {
    return bridgeResponse;
  }

  const bridgeResults = Array.isArray(bridgeResponse.data?.results)
    ? bridgeResponse.data.results
    : [];
  for (const result of bridgeResults) {
    mergeSyncResultIntoReport(report, result);
  }

  return {
    status: "success",
    data: report,
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
    await initializationPromise;
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
      await updateActionIndicator(false);
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
    } else if (request.action === "servicenow/syncVisibleBlocks") {
      const response = await serviceNowSyncVisibleBlocks(request.data || {});
      sendResponse(response);
    } else {
      sendResponse({ status: "error", message: "Unsupported action." });
    }
  })().catch((error) => {
    console.error("Background message handling error:", error);
    sendResponse({ status: "error", message: "Unexpected error." });
  });

  return true;
});
