document.addEventListener("DOMContentLoaded", function () {
  getSessionsFromBackground((sessions) => {
    const logDisplay = document.getElementById("log-display");
    logDisplay.innerHTML = ""; // Clear existing entries

    if (sessions.length === 0) {
      logDisplay.innerText = "No recorded sessions yet.";
    } else {
      sessions.forEach((session, index) => {
        const sessionEntry = document.createElement("p");
        sessionEntry.innerText = `Task ${index + 1}: ${
          session.task
        } - ${transformMilisecondsToTime(session.duration)}`;
        logDisplay.appendChild(sessionEntry);
      });
    }
  });
});

function transformMilisecondsToTime(miliseconds) {
  // convert to seconds
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

document
  .getElementById("clear-log-button")
  .addEventListener("click", function () {
    clearSessionsInBackground();
    document.getElementById("log-display").innerText = "Log cleared."; // Update display

    isLogVisible = false; // Reset visibility state
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
