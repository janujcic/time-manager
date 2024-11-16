const confirmationModal = document.getElementById("confirmation-modal");

document.addEventListener("DOMContentLoaded", function () {
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
});

function transformMilisecondsToTime(miliseconds) {
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
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
