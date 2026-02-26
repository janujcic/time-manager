const TIME_BLOCKS_KEY = "timeBlocks";
const LEGACY_SESSIONS_KEY = "timeSessions";

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
  chrome.storage.local.get([TIME_BLOCKS_KEY], (result) => {
    if (!Array.isArray(result[TIME_BLOCKS_KEY])) {
      chrome.storage.local.set({ [TIME_BLOCKS_KEY]: [] });
    }
  });
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

async function getTimeBlocks() {
  const result = await storageGet([TIME_BLOCKS_KEY]);
  return Array.isArray(result[TIME_BLOCKS_KEY]) ? result[TIME_BLOCKS_KEY] : [];
}

async function appendTimeBlock(block) {
  const existingBlocks = await getTimeBlocks();
  existingBlocks.push(block);
  await storageSet({ [TIME_BLOCKS_KEY]: existingBlocks });
}

function createTimeBlock(task, startMs, endMs, source) {
  return {
    id: generateBlockId(),
    task,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    source,
    createdAtMs: Date.now(),
  };
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
  const durationMs = Number(taskData.taskDuration);
  const rawStartMs = taskData.startTimeMs ?? taskData.startTime;
  const startMs = Number(rawStartMs);

  if (!task) {
    return { status: "error", message: "Task name is required." };
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { status: "error", message: "Duration must be greater than zero." };
  }
  if (!Number.isFinite(startMs)) {
    return { status: "error", message: "Start time is required." };
  }

  const endMs = startMs + durationMs;
  const block = createTimeBlock(task, startMs, endMs, "manual");
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
    } else {
      sendResponse({ status: "error", message: "Unsupported action." });
    }
  })().catch((error) => {
    console.error("Background message handling error:", error);
    sendResponse({ status: "error", message: "Unexpected error." });
  });

  return true;
});
