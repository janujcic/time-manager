// default state when the window opens
let taskName = "";

document.addEventListener("DOMContentLoaded", function () {
  chrome.runtime.sendMessage({ action: "checkStatus" }, (response) => {
    taskName = response.timerData.savedTaskName;
    document.getElementById("task-name").innerText = taskName;

    if (response.timerData.isRunning) {
      document.getElementById("start-button").style.display = "none";
      document.getElementById("stop-button").style.display = "inline";
    }
  });
});

// Start button event
document.getElementById("start-button").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "start", taskName }, (response) => {
    console.log(response);
    if (response.status === "started") {
      document.getElementById("start-button").style.display = "none";
      document.getElementById("stop-button").style.display = "inline";
    }
  });
});

// Stop button event
document.getElementById("stop-button").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" }, (response) => {
    console.log(response);
    if (response.status === "stopped") {
      document.getElementById("start-button").style.display = "inline";
      document.getElementById("stop-button").style.display = "none";
    }
  });
});

// Finish button event
document.getElementById("finish-button").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "finish" }, (response) => {
    if (response.status === "finished") {
      window.close(); // Close the standalone window
      chrome.action.openPopup(); // Reopen the main extension window
    }
  });
});

// Listen for time updates from the background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "updateTime") {
    document.getElementById("elapsed-time").innerText = message.elapsedTime;
  }
});

window.addEventListener("beforeunload", () => {
  document.getElementById("finish-button").click();
});
