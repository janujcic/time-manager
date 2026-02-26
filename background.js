const TIME_BLOCKS_KEY = "timeBlocks";
const LEGACY_SESSIONS_KEY = "timeSessions";
const SN_CONFIG_KEY = "sn_config";
const SN_TIMECARDS_CACHE_KEY = "sn_timecards_cache";
const SN_LAST_SYNC_REPORT_KEY = "sn_last_sync_report";

const DEFAULT_SN_CONFIG = {
  enabled: false,
  instanceUrl: "",
};

let timerData = {
  savedTaskName: "",
  isRunning: false,
  elapsedTime: 0,
  lastSaved: "",
};
let timerInterval = null;
let activeBlockStartMs = null;
let elapsedBeforeActiveMs = 0;

initializeStorage();

function initializeStorage() {
  chrome.storage.local.get(
    [TIME_BLOCKS_KEY, SN_CONFIG_KEY, SN_TIMECARDS_CACHE_KEY, SN_LAST_SYNC_REPORT_KEY],
    (result) => {
      const updatePayload = {};
      if (!Array.isArray(result[TIME_BLOCKS_KEY])) {
        updatePayload[TIME_BLOCKS_KEY] = [];
      }
      if (!result[SN_CONFIG_KEY] || typeof result[SN_CONFIG_KEY] !== "object") {
        updatePayload[SN_CONFIG_KEY] = { ...DEFAULT_SN_CONFIG };
      }
      if (
        !result[SN_TIMECARDS_CACHE_KEY] ||
        typeof result[SN_TIMECARDS_CACHE_KEY] !== "object"
      ) {
        updatePayload[SN_TIMECARDS_CACHE_KEY] = { fetchedAtMs: 0, items: [] };
      }
      if (
        !result[SN_LAST_SYNC_REPORT_KEY] ||
        typeof result[SN_LAST_SYNC_REPORT_KEY] !== "object"
      ) {
        updatePayload[SN_LAST_SYNC_REPORT_KEY] = { syncedAtMs: 0, results: [] };
      }
      if (Object.keys(updatePayload).length > 0) {
        chrome.storage.local.set(updatePayload);
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

function executeScriptOnTab(tabId, func, args = []) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func,
        args,
      },
      (injectionResults) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(injectionResults?.[0]?.result);
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
    return parsed.origin;
  } catch {
    return null;
  }
}

function withServiceNowMetadata(base, taskData) {
  const sysId = (taskData?.snTimecardSysId || "").trim();
  const label = (taskData?.snTimecardLabel || "").trim();

  if (!sysId) {
    return {
      ...base,
      snTimecardSysId: "",
      snTimecardLabel: "",
      snSyncState: "not_linked",
      snLastSyncedAtMs: null,
      snLastSyncedHours: null,
      snLastSyncError: "",
    };
  }

  return {
    ...base,
    snTimecardSysId: sysId,
    snTimecardLabel: label || sysId,
    snSyncState: "pending",
    snLastSyncedAtMs: null,
    snLastSyncedHours: null,
    snLastSyncError: "",
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
    taskData
  );

  if (existing.snTimecardSysId && updated.snTimecardSysId === existing.snTimecardSysId) {
    updated.snSyncState = existing.snSyncState || "pending";
    updated.snLastSyncedAtMs = existing.snLastSyncedAtMs || null;
    updated.snLastSyncedHours = existing.snLastSyncedHours || null;
    updated.snLastSyncError = existing.snLastSyncError || "";
  }

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

async function startTimer(taskName) {
  if (timerData.isRunning || timerInterval !== null) {
    return { status: "started" };
  }

  const normalizedTaskName = (taskName || timerData.savedTaskName || "").trim();
  if (!normalizedTaskName) {
    return { status: "error", message: "Task name is required." };
  }

  if (timerData.savedTaskName !== normalizedTaskName) {
    timerData.savedTaskName = normalizedTaskName;
  }

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
    "timer"
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

async function getMergedAggregatedSessions() {
  const [blocks, legacyResult] = await Promise.all([
    getTimeBlocks(),
    storageGet([LEGACY_SESSIONS_KEY]),
  ]);

  const aggregated = aggregateBlocksByTask(blocks);
  const mergedByTask = new Map(
    aggregated.map((session) => [session.task, { ...session }])
  );
  const legacySessions = Array.isArray(legacyResult[LEGACY_SESSIONS_KEY])
    ? legacyResult[LEGACY_SESSIONS_KEY]
    : [];

  for (const session of legacySessions) {
    const existing = mergedByTask.get(session.task);
    if (existing) {
      existing.duration += Number(session.duration) || 0;
      if (!existing.lastSaved && session.lastSaved) {
        existing.lastSaved = session.lastSaved;
      }
    } else {
      mergedByTask.set(session.task, {
        task: session.task,
        duration: Number(session.duration) || 0,
        lastSaved: session.lastSaved || "",
      });
    }
  }

  return Array.from(mergedByTask.values()).sort((a, b) => b.duration - a.duration);
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

  const block = createTimeBlock(task, startMs, endMs, "manual", taskData);
  await appendTimeBlock(block);

  if (!timerData.isRunning && timerData.savedTaskName === task) {
    await refreshElapsedTimeForTask(task);
  }

  return { status: "success" };
}

async function saveSession(task, newTime) {
  const taskName = (task || "").trim();
  const durationMs = Number(newTime);

  if (!taskName || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { status: "error", message: "Invalid task or duration." };
  }

  const endMs = Date.now();
  const startMs = endMs - durationMs;
  const block = createTimeBlock(taskName, startMs, endMs, "manual");
  await appendTimeBlock(block);
  return { status: "success" };
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
  const instanceUrl = normalizeInstanceUrl(configInput?.instanceUrl || "");

  if (enabled && !instanceUrl) {
    return {
      status: "error",
      code: "SN_NO_CONFIG",
      message: "A valid HTTPS ServiceNow instance URL is required.",
    };
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
    return {
      status: "error",
      code: "SN_NO_CONFIG",
      message: "A valid HTTPS ServiceNow instance URL is required.",
    };
  }

  const originPattern = `${normalized}/*`;
  const permissionPayload = { origins: [originPattern] };

  const hasPermission = await permissionsContains(permissionPayload);
  if (hasPermission) {
    return { status: "success" };
  }

  const granted = await permissionsRequest(permissionPayload);
  if (!granted) {
    return {
      status: "error",
      code: "SN_NO_CONFIG",
      message: "Permission for the ServiceNow instance was not granted.",
    };
  }

  return { status: "success" };
}

async function findActiveSessionTab(config) {
  if (!config.enabled || !config.instanceUrl) {
    return {
      status: "error",
      code: "SN_NO_CONFIG",
      message: "ServiceNow integration is not configured.",
    };
  }

  const tabs = await queryTabs({ url: `${config.instanceUrl}/*` });
  if (!tabs || tabs.length === 0) {
    return {
      status: "error",
      code: "SN_NO_TAB",
      message: `Open and log in to ${config.instanceUrl} in a browser tab, then retry.`,
    };
  }

  return { status: "success", data: tabs[0] };
}

function serviceNowCheckSessionPage() {
  const userId = window.NOW?.user?.userID || window.g_user?.userID || null;
  if (!userId) {
    return {
      status: "error",
      code: "SN_NOT_LOGGED_IN",
      message: "No active ServiceNow session found in this tab.",
    };
  }

  return {
    status: "success",
    data: {
      userId,
      userName:
        window.NOW?.user?.name ||
        window.NOW?.user?.user_name ||
        window.g_user?.userName ||
        "",
    },
  };
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

function serviceNowFetchTimecardsPage() {
  const userId = window.NOW?.user?.userID || window.g_user?.userID || null;
  if (!userId) {
    return Promise.resolve({
      status: "error",
      code: "SN_NOT_LOGGED_IN",
      message: "No active ServiceNow session found in this tab.",
    });
  }

  const query = `user=${encodeURIComponent(userId)}`;
  const endpoint = `/api/now/table/time_card?sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=500&sysparm_query=${query}`;

  return fetch(endpoint, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  })
    .then(async (response) => {
      if (response.status === 401 || response.status === 403) {
        return {
          status: "error",
          code: "SN_NOT_LOGGED_IN",
          message: "ServiceNow session is not authenticated.",
        };
      }

      if (!response.ok) {
        return {
          status: "error",
          code: "SN_API_ERROR",
          message: `Failed to fetch timecards (${response.status}).`,
        };
      }

      const payload = await response.json();
      const rawItems = Array.isArray(payload.result) ? payload.result : [];

      const items = rawItems
        .map((item) => {
          const stateDisplay = String(readDisplayValue(item.state) || "");
          return {
            sys_id: readDisplayValue(item.sys_id),
            number: String(readDisplayValue(item.number) || ""),
            short_description: String(readDisplayValue(item.short_description) || ""),
            state: String(readDisplayValue(item.state) || ""),
            stateDisplay,
          };
        })
        .filter((item) => item.sys_id)
        .filter((item) => {
          const stateText = `${item.state} ${item.stateDisplay}`.toLowerCase();
          return !stateText.includes("closed") && !stateText.includes("resolved");
        });

      return { status: "success", data: items };
    })
    .catch((error) => ({
      status: "error",
      code: "SN_API_ERROR",
      message: error?.message || "Unexpected ServiceNow fetch error.",
    }));
}

function serviceNowUpdateTimecardsPage(updatePayloads) {
  const csrfToken =
    window.g_ck ||
    window.NOW?.g_ck ||
    document.querySelector("meta[name='sysparm_ck']")?.getAttribute("content") ||
    "";

  const userId = window.NOW?.user?.userID || window.g_user?.userID || null;
  if (!userId) {
    return Promise.resolve({
      status: "error",
      code: "SN_NOT_LOGGED_IN",
      message: "No active ServiceNow session found in this tab.",
    });
  }

  if (!csrfToken) {
    return Promise.resolve({
      status: "error",
      code: "SN_CSRF_MISSING",
      message: "ServiceNow CSRF token is not available in the active session.",
    });
  }

  const updates = Array.isArray(updatePayloads) ? updatePayloads : [];

  return Promise.all(
    updates.map(async (update) => {
      try {
        const response = await fetch(
          `/api/now/table/time_card/${encodeURIComponent(update.sys_id)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "X-UserToken": csrfToken,
            },
            body: JSON.stringify({
              hours: String(update.hours),
            }),
          }
        );

        if (!response.ok) {
          return {
            sys_id: update.sys_id,
            status: "error",
            message: `Update failed (${response.status}).`,
          };
        }

        return {
          sys_id: update.sys_id,
          status: "success",
        };
      } catch (error) {
        return {
          sys_id: update.sys_id,
          status: "error",
          message: error?.message || "Unexpected update error.",
        };
      }
    })
  ).then((results) => ({ status: "success", data: results }));
}

async function serviceNowCheckSession() {
  const config = await getServiceNowConfig();
  const tabResponse = await findActiveSessionTab(config);
  if (tabResponse.status !== "success") {
    return tabResponse;
  }

  try {
    const pageResponse = await executeScriptOnTab(
      tabResponse.data.id,
      serviceNowCheckSessionPage
    );
    if (!pageResponse || pageResponse.status !== "success") {
      return (
        pageResponse || {
          status: "error",
          code: "SN_NOT_LOGGED_IN",
          message: "Unable to validate ServiceNow session.",
        }
      );
    }

    return {
      status: "success",
      data: {
        tabId: tabResponse.data.id,
        ...pageResponse.data,
      },
    };
  } catch (error) {
    return {
      status: "error",
      code: "SN_API_ERROR",
      message: error?.message || "Unable to validate ServiceNow session.",
    };
  }
}

async function serviceNowFetchTimecards() {
  const config = await getServiceNowConfig();
  const tabResponse = await findActiveSessionTab(config);
  if (tabResponse.status !== "success") {
    return tabResponse;
  }

  try {
    const pageResponse = await executeScriptOnTab(
      tabResponse.data.id,
      serviceNowFetchTimecardsPage
    );

    if (!pageResponse || pageResponse.status !== "success") {
      return (
        pageResponse || {
          status: "error",
          code: "SN_API_ERROR",
          message: "Failed to fetch ServiceNow timecards.",
        }
      );
    }

    const cache = {
      fetchedAtMs: Date.now(),
      items: pageResponse.data,
    };

    await storageSet({ [SN_TIMECARDS_CACHE_KEY]: cache });
    return { status: "success", data: cache };
  } catch (error) {
    return {
      status: "error",
      code: "SN_API_ERROR",
      message: error?.message || "Failed to fetch ServiceNow timecards.",
    };
  }
}

async function getCachedTimecards() {
  const result = await storageGet([SN_TIMECARDS_CACHE_KEY]);
  const cache = result[SN_TIMECARDS_CACHE_KEY] || { fetchedAtMs: 0, items: [] };
  if (!Array.isArray(cache.items)) {
    return { fetchedAtMs: 0, items: [] };
  }
  return cache;
}

async function linkBlockTimecard(blockId, snData) {
  if (!blockId) {
    return { status: "error", message: "Block id is required." };
  }

  const blocks = await getTimeBlocks();
  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  if (blockIndex === -1) {
    return { status: "error", message: "Time block not found." };
  }

  blocks[blockIndex] = withServiceNowMetadata(blocks[blockIndex], snData);
  await saveTimeBlocks(blocks);
  return { status: "success", data: blocks[blockIndex] };
}

function durationToRoundedHours(durationMs) {
  const hours = durationMs / (1000 * 60 * 60);
  return Number(hours.toFixed(2));
}

async function serviceNowSync() {
  const config = await getServiceNowConfig();
  if (!config.enabled) {
    return {
      status: "error",
      code: "SN_NO_CONFIG",
      message: "ServiceNow integration is disabled.",
    };
  }

  const tabResponse = await findActiveSessionTab(config);
  if (tabResponse.status !== "success") {
    return tabResponse;
  }

  const blocks = await getTimeBlocks();
  const linkedBlocks = blocks.filter((block) => block.snTimecardSysId);

  if (linkedBlocks.length === 0) {
    const report = { syncedAtMs: Date.now(), results: [] };
    await storageSet({ [SN_LAST_SYNC_REPORT_KEY]: report });
    return { status: "success", data: report };
  }

  const grouped = new Map();
  for (const block of linkedBlocks) {
    if (!grouped.has(block.snTimecardSysId)) {
      grouped.set(block.snTimecardSysId, {
        sys_id: block.snTimecardSysId,
        label: block.snTimecardLabel || block.snTimecardSysId,
        totalDurationMs: 0,
      });
    }
    grouped.get(block.snTimecardSysId).totalDurationMs += block.durationMs;
  }

  const updates = Array.from(grouped.values()).map((entry) => ({
    sys_id: entry.sys_id,
    hours: durationToRoundedHours(entry.totalDurationMs),
  }));

  let pageResult;
  try {
    pageResult = await executeScriptOnTab(
      tabResponse.data.id,
      serviceNowUpdateTimecardsPage,
      [updates]
    );
  } catch (error) {
    return {
      status: "error",
      code: "SN_API_ERROR",
      message: error?.message || "Failed to sync ServiceNow timecards.",
    };
  }

  if (!pageResult || pageResult.status !== "success") {
    return (
      pageResult || {
        status: "error",
        code: "SN_API_ERROR",
        message: "Failed to sync ServiceNow timecards.",
      }
    );
  }

  const results = Array.isArray(pageResult.data) ? pageResult.data : [];
  const resultById = new Map(results.map((item) => [item.sys_id, item]));

  const nowMs = Date.now();
  const updatedBlocks = blocks.map((block) => {
    if (!block.snTimecardSysId) {
      return block;
    }
    const remoteResult = resultById.get(block.snTimecardSysId);
    if (!remoteResult) {
      return {
        ...block,
        snSyncState: "error",
        snLastSyncError: "No sync response for linked timecard.",
      };
    }
    if (remoteResult.status === "success") {
      const updateInfo = grouped.get(block.snTimecardSysId);
      return {
        ...block,
        snSyncState: "synced",
        snLastSyncedAtMs: nowMs,
        snLastSyncedHours: durationToRoundedHours(updateInfo.totalDurationMs),
        snLastSyncError: "",
      };
    }
    return {
      ...block,
      snSyncState: "error",
      snLastSyncError: remoteResult.message || "Sync failed for linked timecard.",
    };
  });

  await saveTimeBlocks(updatedBlocks);

  const report = {
    syncedAtMs: nowMs,
    results: Array.from(grouped.values()).map((entry) => {
      const remoteResult = resultById.get(entry.sys_id);
      return {
        sys_id: entry.sys_id,
        label: entry.label,
        hours: durationToRoundedHours(entry.totalDurationMs),
        status: remoteResult?.status || "error",
        message: remoteResult?.message || "No response",
      };
    }),
  };
  await storageSet({ [SN_LAST_SYNC_REPORT_KEY]: report });

  const hasFailure = report.results.some((item) => item.status !== "success");
  if (hasFailure) {
    return {
      status: "error",
      code: "SN_SYNC_PARTIAL",
      message: "Some ServiceNow timecards failed to sync.",
      data: report,
    };
  }

  return { status: "success", data: report };
}

async function getServiceNowLastSyncReport() {
  const result = await storageGet([SN_LAST_SYNC_REPORT_KEY]);
  return result[SN_LAST_SYNC_REPORT_KEY] || { syncedAtMs: 0, results: [] };
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
    [LEGACY_SESSIONS_KEY]: [],
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === "start") {
      const response = await startTimer(request.taskName);
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
    } else if (request.action === "saveSession") {
      const response = await saveSession(request.task, request.newTime);
      sendResponse(response);
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
      const sessions = await getMergedAggregatedSessions();
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
    } else if (request.action === "servicenow/ensurePermission") {
      const config = await getServiceNowConfig();
      const response = await ensureServiceNowPermission(config.instanceUrl);
      sendResponse(response);
    } else if (request.action === "servicenow/findActiveSessionTab") {
      const config = await getServiceNowConfig();
      const response = await findActiveSessionTab(config);
      sendResponse(response);
    } else if (request.action === "servicenow/checkSession") {
      const response = await serviceNowCheckSession();
      sendResponse(response);
    } else if (request.action === "servicenow/fetchTimecards") {
      const config = await getServiceNowConfig();
      const permissionResponse = await ensureServiceNowPermission(config.instanceUrl);
      if (permissionResponse.status !== "success") {
        sendResponse(permissionResponse);
        return;
      }
      const response = await serviceNowFetchTimecards();
      sendResponse(response);
    } else if (request.action === "servicenow/getCachedTimecards") {
      sendResponse({ status: "success", data: await getCachedTimecards() });
    } else if (request.action === "servicenow/linkBlockTimecard") {
      const response = await linkBlockTimecard(request.blockId, request.snData || {});
      sendResponse(response);
    } else if (request.action === "servicenow/sync") {
      const config = await getServiceNowConfig();
      const permissionResponse = await ensureServiceNowPermission(config.instanceUrl);
      if (permissionResponse.status !== "success") {
        sendResponse(permissionResponse);
        return;
      }
      const response = await serviceNowSync();
      sendResponse(response);
    } else if (request.action === "servicenow/getLastSyncReport") {
      sendResponse({ status: "success", data: await getServiceNowLastSyncReport() });
    } else {
      sendResponse({ status: "error", message: "Unsupported action." });
    }
  })().catch((error) => {
    console.error("Background message handling error:", error);
    sendResponse({ status: "error", message: "Unexpected error." });
  });

  return true;
});
