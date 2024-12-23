const confirmationModal = document.getElementById("confirmation-modal");
const addLogModal = document.getElementById("add-log-modal");

document.addEventListener("DOMContentLoaded", function () {
  rebuildTable();
});

function clearTable() {
  const logTableBody = document.querySelector("#task-log-table tbody");
  logTableBody.innerHTML = "";
}

function rebuildTable() {
  getSessionsFromBackground((sessions) => {
    const logDisplay = document.getElementById("log-display");
    const logTableBody = document.querySelector("#task-log-table tbody");

    sessions.sort((a, b) => b.duration - a.duration);
    if (sessions.length === 0) {
      logDisplay.innerText = "No recorded sessions yet.";
    } else {
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
        lastSavedCell.innerText = session.lastSaved;
        row.appendChild(lastSavedCell);

        logTableBody.appendChild(row);
      });
    }
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

function transformDatetime(isoDatetime) {
  const date = new Date(isoDatetime);

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = "00"; // Adding seconds as "00" since not provided in the input

  // Combine into the desired format
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

document
  .getElementById("clear-log-button")
  .addEventListener("click", function () {
    confirmationModal.style.display = "block";
  });

document.getElementById("yes-button").addEventListener("click", () => {
  clearSessionsInBackground();
  document.getElementById("log-display").innerText = "Log cleared."; // Update display
  confirmationModal.style.display = "none"; // Hide modal
  const logTableBody = document.querySelector("#task-log-table tbody");
  logTableBody.innerHTML = ""; // Remove all rows from the table
});

document.getElementById("no-button").addEventListener("click", () => {
  confirmationModal.style.display = "none"; // Just hide modal
});

document
  .getElementById("add-log-button")
  .addEventListener("click", function () {
    addLogModal.style.display = "block";
    const hoursSelect = document.getElementById("task-duration-hours");
    generateOptions(hoursSelect, 0, 12);

    const minutesSelect = document.getElementById("task-duration-minutes");
    generateOptions(minutesSelect, 0, 59);
  });

document.getElementById("save-log-button").addEventListener("click", () => {
  const taskNameInput = document.getElementById("task-name");
  const taskDurationHoursInput = document.getElementById("task-duration-hours");
  const taskDurationMinutesInput = document.getElementById(
    "task-duration-minutes"
  );
  const taskDateInput = document.getElementById("task-timedate");

  const taskName = taskNameInput.value.trim();
  const taskDurationHours = taskDurationHoursInput.value;
  const taskDurationMinutes = taskDurationMinutesInput.value;
  let taskDate = taskDateInput.value;

  if (taskName == "" || (taskDurationHours == 0 && taskDurationMinutes == 0)) {
    alert("Task name and task duration fields must be filled in!");
    return;
  }

  if (taskDate != "") {
    taskDate = transformDatetime(taskDate);
  }

  // convert duration to miliseconds
  let totalDuration =
    taskDurationHours * 60 * 60 * 1000 + taskDurationMinutes * 60 * 1000;

  const taskData = {
    taskName: taskName,
    taskDuration: totalDuration,
    startTime: taskDate,
  };

  chrome.runtime.sendMessage(
    { action: "saveManualSession", taskData },
    (response) => {
      if (response.status === "success") {
        console.log("Manual session successfully added.");
      }
    }
  );

  alert("Task saved successfully!");

  taskNameInput.value = "";
  taskDurationHoursInput.value = 0;
  taskDurationMinutesInput.value = 0;
  taskDateInput.value = "";
});

document.getElementById("cancel-log-button").addEventListener("click", () => {
  addLogModal.style.display = "none"; // Just hide modal
  clearTable();
  rebuildTable();
});

function getSessionsFromBackground(callback) {
  chrome.runtime.sendMessage({ action: "getSessions" }, (response) => {
    if (response.status === "success") {
      const sessions = response.data;
      callback(sessions);
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
