let timerData = {
  savedTaskName: "",
  startTime: null,
  isRunning: false,
  elapsedTime: 0,
};

function startTimer(taskName) {
  if (!timerData.isRunning) {
    timerData.savedTaskName = taskName;
    timerData.startTime = new Date().getTime();
    timerData.isRunning = true;
  }
}

function stopTimer() {
  if (timerData.isRunning) {
    const endTime = new Date().getTime();
    timerData.elapsedTime += endTime - timerData.startTime;
    timerData.isRunning = false;
    return timerData.elapsedTime;
  }
  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start") {
    startTimer(request.taskName);
    sendResponse({ status: "started" });
  } else if (request.action === "stop") {
    const elapsedTime = stopTimer();
    sendResponse({ status: "stopped", elapsedTime });
  } else if (request.action === "checkStatus") {
    sendResponse({ timerData });
  }
});
