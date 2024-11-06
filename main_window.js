document.getElementById("start-button").addEventListener("click", function () {
  document.getElementById("start-button").style.display = "none";
  document.getElementById("stop-button").style.display = "inline";
  console.log("Timer started.");
});

document.getElementById("stop-button").addEventListener("click", function () {
  document.getElementById("stop-button").style.display = "none";
  document.getElementById("start-button").style.display = "inline";
  console.log("Timer stopped.");
});
