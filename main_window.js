let currentTaskName = "";
let snConfig = { enabled: false, instanceUrl: "" };
let snLookupCache = { fetchedAtMs: 0, tasks: [], categories: [], timeCodes: [] };

const taskNameError = document.getElementById("task-name-error");
const enterStartTask = document.querySelector(".enter-start-task");
const runningTask = document.querySelector(".running-task");
const runningTaskMessage = document.getElementById("running-task-message");
const elapsedTimeDisplay = document.getElementById("elapsed-time");
const startButton = document.getElementById("start-button");
const resumeButton = document.getElementById("resume-button");
const stopButton = document.getElementById("stop-button");
const finishButton = document.getElementById("finish-button");
const mainSnAssignmentWrap = document.getElementById("main-sn-assignment-wrap");
const mainSnAssignmentInput = document.getElementById("main-sn-assignment-input");
const mainSnAssignmentList = document.getElementById("main-sn-assignment-list");
const mainSnCodeWrap = document.getElementById("main-sn-code-wrap");
const mainSnCodeSelect = document.getElementById("main-sn-code-select");

function showTaskNameError(message) {
  taskNameError.textContent = message;
  mainSnAssignmentInput.classList.add("input-error");
}

function clearTaskNameError() {
  taskNameError.textContent = "";
  mainSnAssignmentInput.classList.remove("input-error");
}

function showMainSnError(message) {
  taskNameError.textContent = message;
  mainSnAssignmentInput.classList.add("input-error");
  mainSnCodeSelect.classList.add("input-error");
}

function clearMainSnError() {
  mainSnAssignmentInput.classList.remove("input-error");
  mainSnCodeSelect.classList.remove("input-error");
}

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function updateRunningMessage(isRunning) {
  const stateText = isRunning ? "running" : "paused";
  runningTaskMessage.textContent = `Task timer for "${currentTaskName}" is ${stateText}.`;
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
  clearMainSnError();
}

function updateMainSnVisibility() {
  mainSnAssignmentWrap.style.display = "flex";
  mainSnCodeWrap.style.display = snConfig.enabled ? "flex" : "none";
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
  const timeCodes = Array.isArray(snLookupCache.timeCodes) ? snLookupCache.timeCodes : [];

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

function getSelectedAssignment() {
  const typedValue = String(mainSnAssignmentInput.value || "").trim();
  if (!typedValue) {
    return null;
  }

  return getAllAssignmentOptions().find((item) => item.label === typedValue) || null;
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
      snConfig = configResponse.data || { enabled: false, instanceUrl: "" };
      updateMainSnVisibility();
    }
  });

  chrome.runtime.sendMessage({ action: "servicenow/getCachedLookups" }, (cacheResponse) => {
    if (cacheResponse?.status === "success") {
      snLookupCache = cacheResponse.data || {
        fetchedAtMs: 0,
        tasks: [],
        categories: [],
        timeCodes: [],
      };
      renderMainAssignmentOptions();
      renderMainCodeOptions();
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
    mainSnAssignmentInput.value = currentTaskName;
    elapsedTimeDisplay.textContent = transformMilisecondsToTime(timerData.elapsedTime || 0);

    renderMainAssignmentOptions(getAssignmentLabelFromTimerData(timerData));
    renderMainCodeOptions(timerData.snCodeSysId || "");

    if (currentTaskName) {
      showRunningState(Boolean(timerData.isRunning));
    } else {
      showRegistrationState();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadMainSnConfigAndLookups();
  mainSnAssignmentInput.addEventListener("input", () => {
    if (mainSnAssignmentInput.value.trim()) {
      clearTaskNameError();
    }
    clearMainSnError();
    renderMainAssignmentOptions();
  });
  mainSnCodeSelect.addEventListener("change", () => {
    clearMainSnError();
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

    if (!selectedAssignment) {
      clearTaskNameError();
      showMainSnError("Please select an assigned task or category.");
      return;
    }

    if (!selectedCode) {
      clearTaskNameError();
      showMainSnError("Please select a time code.");
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
    } else if (selectedAssignment?.kind === "category") {
      taskData.snSelectionType = "category";
      taskData.snCategorySysId = selectedAssignment.data.sys_id || "";
      taskData.snCategoryValue = selectedAssignment.data.value || "";
      taskData.snCategoryLabel = selectedAssignment.data.label || "";
      taskName = selectedAssignment.data.label || selectedAssignment.data.value || taskName;
      taskData.snCommentText = taskName;
    }

    taskData.snCodeSysId = selectedCode.sys_id || "";
    taskData.snCodeValue = selectedCode.u_time_card_code || "";
    taskData.snCodeDescription = selectedCode.u_description || "";
  }

  clearTaskNameError();
  clearMainSnError();
  chrome.runtime.sendMessage({ action: "start", taskName, taskData }, (response) => {
    if (response?.status === "started") {
      currentTaskName = taskName;
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
      clearTaskNameError();
      renderMainAssignmentOptions();
      renderMainCodeOptions();
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
