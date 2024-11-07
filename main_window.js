let startTime;
let elapsedTime = 0;
let taskName;

document.getElementById("start-button").addEventListener("click", function () {
  startTime = new Date();
  taskName = document.getElementById("task_name").value;
  console.log("Timer started at: " + startTime + " for task " + taskName);

  // button visibility
  document.getElementById("start-button").style.display = "none";
  document.getElementById("stop-button").style.display = "inline";
});

document.getElementById("stop-button").addEventListener("click", function () {
  const endTime = new Date();
  elapsedTime = endTime - startTime;

  // convert to seconds
  const seconds = Math.floor(elapsedTime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const formattedTime = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  console.log("Timer stopped at:", endTime);
  console.log("Elapsed time:", formattedTime);

  saveSession(taskName, formattedTime);

  const resultDisplay = document.createElement("p");
  resultDisplay.innerText = `Last session for ${taskName}: ${formattedTime}`;
  document.body.appendChild(resultDisplay);

  startTime = null;

  document.getElementById("stop-button").style.display = "none";
  document.getElementById("start-button").style.display = "inline";
});

function saveSession(task, duration) {
  const existingSessions =
    JSON.parse(localStorage.getItem("timeSessions")) || [];
  existingSessions.push({ task, duration });
  localStorage.setItem("timeSessions", JSON.stringify(existingSessions));
}

document
  .getElementById("show-log-button")
  .addEventListener("click", function () {
    const logDisplay = document.getElementById("log-display");
    logDisplay.innerHTML = ""; // Clear any existing entries

    // Retrieve saved sessions from local storage
    const sessions = JSON.parse(localStorage.getItem("timeSessions")) || [];

    if (sessions.length === 0) {
      logDisplay.innerText = "No recorded sessions yet.";
    } else {
      sessions.forEach((session, index) => {
        const sessionEntry = document.createElement("p");
        sessionEntry.innerText = `Task ${index + 1}: ${session.task} - ${
          session.duration
        }`;
        logDisplay.appendChild(sessionEntry);
      });
    }
  });
