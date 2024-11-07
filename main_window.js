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

  const formattedTime = transferSecondsToTime(elapsedTime);
  console.log("Timer stopped at:", endTime);
  console.log("Elapsed time:", formattedTime);

  saveSession(taskName, elapsedTime);

  const resultDisplay = document.createElement("p");
  resultDisplay.innerText = `Last session for ${taskName}: ${formattedTime}`;
  document.body.appendChild(resultDisplay);

  startTime = null;

  document.getElementById("stop-button").style.display = "none";
  document.getElementById("start-button").style.display = "inline";
});

function saveSession(task, newTime) {
  const existingSessions =
    JSON.parse(localStorage.getItem("timeSessions")) || [];
  const taskIndex = existingSessions.findIndex(
    (session) => session.task === task
  );

  if (taskIndex !== -1) {
    // If task exists, sum the times
    const existingTime = existingSessions[taskIndex].duration;
    const totalDuration = existingTime + newTime;
    existingSessions[taskIndex].duration = totalDuration;
  } else {
    // If task doesn't exist, add as new entry
    existingSessions.push({ task, duration: newTime });
  }

  // Save updated sessions back to local storage
  localStorage.setItem("timeSessions", JSON.stringify(existingSessions));
}

function transferSecondsToTime(miliseconds) {
  // convert to seconds
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
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
        sessionEntry.innerText =
          `Task ${index + 1}: ${session.task} - ` +
          transferSecondsToTime(session.duration);
        logDisplay.appendChild(sessionEntry);
      });
    }
  });
