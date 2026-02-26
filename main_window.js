let currentTaskName = "";

const taskNameInput = document.getElementById("task_name");
const taskNameError = document.getElementById("task-name-error");
const enterStartTask = document.querySelector(".enter-start-task");
const runningTask = document.querySelector(".running-task");
const runningTaskMessage = document.getElementById("running-task-message");
const elapsedTimeDisplay = document.getElementById("elapsed-time");
const startButton = document.getElementById("start-button");
const resumeButton = document.getElementById("resume-button");
const stopButton = document.getElementById("stop-button");
const finishButton = document.getElementById("finish-button");

function showTaskNameError(message) {
  taskNameError.textContent = message;
  taskNameInput.classList.add("input-error");
}

function clearTaskNameError() {
  taskNameError.textContent = "";
  taskNameInput.classList.remove("input-error");
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
}

function refreshFromBackground() {
  chrome.runtime.sendMessage({ action: "checkStatus" }, (response) => {
    const timerData = response?.timerData;
    if (!timerData) {
      showRegistrationState();
      return;
    }

    currentTaskName = timerData.savedTaskName || "";
    elapsedTimeDisplay.textContent = transformMilisecondsToTime(
      timerData.elapsedTime || 0
    );

    if (currentTaskName) {
      showRunningState(Boolean(timerData.isRunning));
    } else {
      showRegistrationState();
    }
  });
}

document.addEventListener("DOMContentLoaded", function () {
  refreshFromBackground();
});

startButton.addEventListener("click", function () {
  const taskName = taskNameInput.value.trim();
  if (!taskName) {
    showTaskNameError("Please enter a task name before starting the timer.");
    return;
  }

  clearTaskNameError();
  chrome.runtime.sendMessage({ action: "start", taskName }, (response) => {
    if (response?.status === "started") {
      currentTaskName = taskName;
      showRunningState(true);
      refreshFromBackground();
    } else {
      showTaskNameError(response?.message || "Unable to start timer.");
    }
  });
});

resumeButton.addEventListener("click", function () {
  if (!currentTaskName) {
    showRegistrationState();
    return;
  }

  chrome.runtime.sendMessage(
    { action: "start", taskName: currentTaskName },
    (response) => {
      if (response?.status === "started") {
        showRunningState(true);
        refreshFromBackground();
      }
    }
  );
});

stopButton.addEventListener("click", function () {
  chrome.runtime.sendMessage({ action: "stop" }, (response) => {
    if (response?.status === "stopped") {
      showRunningState(false);
      refreshFromBackground();
    }
  });
});

finishButton.addEventListener("click", function () {
  chrome.runtime.sendMessage({ action: "finish" }, (response) => {
    if (response?.status === "finished") {
      showRegistrationState();
      taskNameInput.value = "";
      clearTaskNameError();
    }
  });
});

taskNameInput.addEventListener("input", () => {
  if (taskNameInput.value.trim()) {
    clearTaskNameError();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "updateTime" && runningTask.style.display !== "none") {
    elapsedTimeDisplay.textContent = message.elapsedTime;
  }
});

document
  .getElementById("show-log-button")
  .addEventListener("click", function () {
    openTimeManagerWindow();
    window.close();
  });

function openTimeManagerWindow() {
  const width = 500;
  const height = 400;
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
