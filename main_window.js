let startTime;
let elapsedTime = 0;
let taskName;
let isLogVisible = false;

document.addEventListener("DOMContentLoaded", function () {
  chrome.runtime.sendMessage({ action: "checkStatus" }, (response) => {
    const { savedTaskName, isRunning } = response.timerData;
    if (isRunning) {
      taskName = savedTaskName;
      document.getElementById("task_name").value = taskName;
      document.getElementById("start-button").style.display = "none";
      document.getElementById("finish-button").style.display = "inline";
    }
  });
});

document.getElementById("start-button").addEventListener("click", function () {
  taskName = document.getElementById("task_name").value.trim();
  if (!taskName) {
    alert("Please enter a task name before starting the timer.");
    return;
  }

  // Send a message to start the timer in the background
  chrome.runtime.sendMessage({ action: "start", taskName }, (response) => {
    console.log(response);
    if (response.status === "started") {
      document.getElementById("start-button").style.display = "none";
      document.getElementById("finish-button").style.display = "inline";
    }
  });

  // Send a message to start the timer in the background
  chrome.runtime.sendMessage({ action: "start", taskName }, (response) => {
    if (response.status === "started") {
      // Open the standalone timer window
      window.open("timer_window.html", "Task Timer", "width=300,height=200");
      window.close(); // Close the popup
    }
  });
});

document.getElementById("finish-button").addEventListener("click", function () {
  // Send a message to stop the timer in the background
  chrome.runtime.sendMessage({ action: "finish" }, (response) => {
    if (response.status === "finished") {
      document.getElementById("finish-button").style.display = "none";
      document.getElementById("start-button").style.display = "inline";

      // Display elapsed time
      const resultDisplay = document.createElement("p");
      resultDisplay.innerText = `Elapsed time for ${taskName}: ${transferSecondsToTime(
        response.elapsedTime
      )}`;
      document.body.appendChild(resultDisplay);

      // Save session to local storage with summing if task matches
      saveSessionInBackground(taskName, response.elapsedTime);
    }
  });
});

function saveSessionInBackground(task, newTime) {
  chrome.runtime.sendMessage(
    { action: "saveSession", task, newTime },
    (response) => {
      if (response.status === "success") {
        console.log("Session saved successfully in background.");
      }
    }
  );
}

document
  .getElementById("show-log-button")
  .addEventListener("click", function () {
    const logDisplay = document.getElementById("log-display");

    window.open("time_manager.html", "Time Manager", "width=300,height=200");
    window.close(); // Close the popup
  });
