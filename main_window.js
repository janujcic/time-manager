let startTime;
let elapsedTime = 0;
let taskName;
let isLogVisible = false;
const taskNameInput = document.getElementById("task_name");
const taskNameError = document.getElementById("task-name-error");

function showTaskNameError(message) {
  taskNameError.textContent = message;
  taskNameInput.classList.add("input-error");
}

function clearTaskNameError() {
  taskNameError.textContent = "";
  taskNameInput.classList.remove("input-error");
}

document.addEventListener("DOMContentLoaded", function () {
  chrome.runtime.sendMessage({ action: "checkStatus" }, (response) => {
    const { savedTaskName, isRunning } = response.timerData;
    if (isRunning) {
      document.querySelector(".enter-start-task").style.display = "none";
      document.querySelector("#start-button").style.display = "none";
      document.querySelector(".running-task").style.display = "block";
      document.querySelector(
        ".running-task"
      ).textContent = `Task timer for "${savedTaskName}" is currently running. Focus on that task or conclude it by clicking "Finish."`;
    }
  });
});

document.getElementById("start-button").addEventListener("click", function () {
  taskName = taskNameInput.value.trim();
  if (!taskName) {
    showTaskNameError("Please enter a task name before starting the timer.");
    return;
  }
  clearTaskNameError();

  // Send a message to start the timer in the background
  chrome.runtime.sendMessage({ action: "start", taskName }, (response) => {
    if (response.status === "started") {
      // Open the standalone timer window
      openTimerWindow();
      window.close(); // Close the popup
    }
  });
});

taskNameInput.addEventListener("input", () => {
  if (taskNameInput.value.trim()) {
    clearTaskNameError();
  }
});

function openTimerWindow() {
  chrome.windows.create({
    url: "timer_window.html",
    type: "popup",
    width: 300,
    height: 200,
    left: screen.availWidth - 320, // Position 20px from the right
    top: screen.availHeight - 240, // Position 40px from the bottom
    focused: true,
  });
}

document
  .getElementById("show-log-button")
  .addEventListener("click", function () {
    const logDisplay = document.getElementById("log-display");
    openTimeManagerWindow();
    window.close(); // Close the popup
  });

function openTimeManagerWindow() {
  const width = 500;
  const height = 400;
  chrome.windows.create({
    url: "time_manager.html",
    type: "popup",
    width: width,
    height: height,
    left: Math.round((screen.availWidth - width) / 2),
    top: Math.round((screen.availHeight - height) / 2),
    focused: true,
  });
}
