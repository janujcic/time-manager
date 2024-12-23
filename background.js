let timerData = {
  savedTaskName: "",
  startTime: null,
  isRunning: false,
  elapsedTime: 0,
  lastSaved: "",
};
let timerInterval = null;

function broadcastTimerUpdate() {
  const elapsedTimeFormatted = transformMilisecondsToTime(
    timerData.elapsedTime
  );
  chrome.runtime.sendMessage({
    action: "updateTime",
    elapsedTime: elapsedTimeFormatted,
  });
}

function startTimer(taskName) {
  // Prevent duplicate intervals
  if (timerData.isRunning || timerInterval !== null) {
    console.log("Timer already running or interval not cleared.");
    return;
  }

  timerData.savedTaskName = taskName;
  timerData.startTime = new Date().getTime();
  timerData.isRunning = true;

  console.log("Starting timer for task:", taskName);

  timerInterval = setInterval(() => {
    const currentTime = new Date().getTime();
    timerData.elapsedTime += currentTime - timerData.startTime;
    timerData.startTime = currentTime;
    broadcastTimerUpdate();
  }, 1000);
}

function stopTimer() {
  if (!timerData.isRunning) return;

  console.log("Stopping timer");
  timerInterval = null;

  const endTime = new Date().getTime();
  timerData.elapsedTime += endTime - timerData.startTime;
  timerData.isRunning = false;
  broadcastTimerUpdate();
}

function finishTimer() {
  if (timerData.isRunning) {
    stopTimer();
  }
  saveSession(timerData);
  const tempTimerData = timerData;

  console.log("Finishing timer for task:", timerData.savedTaskName);

  timerData = {
    savedTaskName: "",
    startTime: null,
    isRunning: false,
    elapsedTime: 0,
    lastSaved: "",
  };
  return tempTimerData.elapsedTime;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start") {
    startTimer(request.taskName);
    sendResponse({ status: "started" });
  } else if (request.action === "stop") {
    stopTimer();
    sendResponse({ status: "stopped" });
  } else if (request.action === "finish") {
    const elapsedTime = finishTimer();
    sendResponse({ status: "finished", elapsedTime });
  } else if (request.action === "checkStatus") {
    sendResponse({ timerData });
  } else if (request.action === "saveSession") {
    saveSession(request.task, request.newTime);
    sendResponse({ status: "success" });
  } else if (request.action === "saveManualSession") {
    saveManualSession(request.taskData);
    sendResponse({ status: "success" });
  } else if (request.action === "getSessions") {
    chrome.storage.local.get("timeSessions", (result) => {
      sendResponse({ status: "success", data: result.timeSessions || [] });
    });
    return true;
  } else if (request.action === "clearSessions") {
    clearSessions();
    sendResponse({ status: "cleared" });
  }
});

function transformMilisecondsToTime(miliseconds) {
  // convert to seconds
  const seconds = Math.floor(miliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}

function saveManualSession(taskData) {
  const task = taskData.taskName;
  const newTime = taskData.taskDuration;
  let lastSaved = taskData.startTime;

  if (lastSaved === "") {
    lastSaved = getCurrentTimeString();
  }

  if (task != "") {
    chrome.storage.local.get("timeSessions", (result) => {
      const existingSessions = result.timeSessions || [];
      const taskIndex = existingSessions.findIndex(
        (session) => session.task === task
      );

      if (taskIndex !== -1) {
        // If task exists, add the times
        existingSessions[taskIndex].duration += newTime;
        existingSessions[taskIndex].lastSaved = lastSaved;
      } else {
        // New task entry
        existingSessions.push({ task, duration: newTime, lastSaved });
      }

      // Save updated sessions back to storage
      chrome.storage.local.set({ timeSessions: existingSessions });
    });
  }
}

function saveSession(timer) {
  const task = timer.savedTaskName;
  const newTime = timer.elapsedTime;
  const lastSaved = getCurrentTimeString();
  // Retrieve existing sessions
  if (task != "") {
    chrome.storage.local.get("timeSessions", (result) => {
      const existingSessions = result.timeSessions || [];
      const taskIndex = existingSessions.findIndex(
        (session) => session.task === task
      );

      if (taskIndex !== -1) {
        // If task exists, add the times
        existingSessions[taskIndex].duration += newTime;
        existingSessions[taskIndex].lastSaved = lastSaved;
      } else {
        // New task entry
        existingSessions.push({ task, duration: newTime, lastSaved });
      }

      // Save updated sessions back to storage
      chrome.storage.local.set({ timeSessions: existingSessions });
    });
  }
}

function getCurrentTimeString() {
  const now = new Date();

  // Format the date and time
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };
  return now.toLocaleString(undefined, options).replace(",", "");
}

function clearSessions() {
  chrome.storage.local.set({ timeSessions: [] }, () => {
    console.log("All sessions cleared.");
  });
}
