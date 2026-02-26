const confirmationModal = document.getElementById("confirmation-modal");
const addLogModal = document.getElementById("add-log-modal");
const manualLogError = document.getElementById("manual-log-error");
const manualLogSuccess = document.getElementById("manual-log-success");
const taskNameInput = document.getElementById("task-name");
const taskDurationHoursInput = document.getElementById("task-duration-hours");
const taskDurationMinutesInput = document.getElementById("task-duration-minutes");
const taskDateInput = document.getElementById("task-timedate");

let durationOptionsInitialized = false;

document.addEventListener("DOMContentLoaded", function () {
  initializeDurationOptions();
  rebuildTable();
});

function clearTable() {
  const logTableBody = document.querySelector("#task-log-table tbody");
  logTableBody.innerHTML = "";
}

function rebuildTable() {
  clearTable();
  getSessionsFromBackground((sessions) => {
    const logDisplay = document.getElementById("log-display");
    const logTableBody = document.querySelector("#task-log-table tbody");

    sessions.sort((a, b) => b.duration - a.duration);
    if (sessions.length === 0) {
      logDisplay.innerText = "No recorded sessions yet.";
      return;
    }

    logDisplay.innerText = "";
    sessions.forEach((session, index) => {
      const row = document.createElement("tr");
      const taskNumberCell = document.createElement("td");
      taskNumberCell.innerText = index + 1;
      row.appendChild(taskNumberCell);

      const taskNameCell = document.createElement("td");
      taskNameCell.innerText = session.task;
      row.appendChild(taskNameCell);

      const durationCell = document.createElement("td");
      durationCell.innerText = transformMilisecondsToTime(session.duration);
      row.appendChild(durationCell);

      const lastSavedCell = document.createElement("td");
      lastSavedCell.innerText = session.lastSaved || "-";
      row.appendChild(lastSavedCell);

      logTableBody.appendChild(row);
    });
  });
}

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
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

document
  .getElementById("clear-log-button")
  .addEventListener("click", function () {
    confirmationModal.style.display = "block";
  });

document.getElementById("yes-button").addEventListener("click", () => {
  clearSessionsInBackground();
  document.getElementById("log-display").innerText = "Log cleared.";
  confirmationModal.style.display = "none";
  clearTable();
});

document.getElementById("no-button").addEventListener("click", () => {
  confirmationModal.style.display = "none";
});

document
  .getElementById("add-log-button")
  .addEventListener("click", function () {
    clearManualMessages();
    clearManualInputBorders();
    initializeDurationOptions();
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
  const taskData = {
    taskName,
    taskDuration: totalDuration,
    startTimeMs: taskStartMs,
  };

  chrome.runtime.sendMessage({ action: "saveManualSession", taskData }, (response) => {
    if (!response || response.status !== "success") {
      setManualError(response?.message || "Unable to save manual session.");
      return;
    }

    resetManualForm();
    setManualSuccess("Task saved successfully.");
    rebuildTable();
  });
});

document.getElementById("cancel-log-button").addEventListener("click", () => {
  addLogModal.style.display = "none";
  clearManualMessages();
  resetManualForm();
  rebuildTable();
});

function getSessionsFromBackground(callback) {
  chrome.runtime.sendMessage({ action: "getAggregatedSessions" }, (response) => {
    if (response && response.status === "success") {
      callback(response.data);
    } else {
      callback([]);
    }
  });
}

function clearSessionsInBackground() {
  chrome.runtime.sendMessage({ action: "clearSessions" }, (response) => {
    if (response.status === "cleared") {
      console.log("Sessions cleared from storage.");
    }
  });
}
