(() => {
  const REQUEST_CHANNEL = "tm_sn_bridge_request";
  const RESPONSE_CHANNEL = "tm_sn_bridge_response";
  const PAGE_BRIDGE_ID = "tm-sn-page-bridge";
  const pending = new Map();

  function injectPageBridge() {
    if (document.getElementById(PAGE_BRIDGE_ID)) {
      return;
    }

    const root = document.head || document.documentElement;
    if (!root) {
      return;
    }

    const script = document.createElement("script");
    script.id = PAGE_BRIDGE_ID;
    script.src = chrome.runtime.getURL("sn_page_bridge.js");
    script.async = false;
    root.appendChild(script);
  }

  function isAllowedOrigin(instanceOrigin) {
    if (!instanceOrigin) {
      return true;
    }
    return window.location.origin === instanceOrigin;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== RESPONSE_CHANNEL || !message.requestId) {
      return;
    }

    const resolver = pending.get(message.requestId);
    if (!resolver) {
      return;
    }

    pending.delete(message.requestId);
    resolver(message);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "sn_bridge_ping") {
      injectPageBridge();
      sendResponse({ status: "success" });
      return false;
    }

    if (message?.action !== "sn_bridge_request") {
      return false;
    }

    if (!isAllowedOrigin(message.instanceOrigin)) {
      sendResponse({
        status: "error",
        code: "SN_NO_TAB",
        message: "The active tab does not match the configured ServiceNow instance.",
      });
      return false;
    }

    const envelope = message.envelope || {};
    const requestId = envelope.requestId;
    const actionName = String(envelope.action || "operation");
    if (!requestId) {
      sendResponse({ status: "error", code: "SN_API_ERROR", message: "Missing bridge request id." });
      return false;
    }

    injectPageBridge();

    const timeoutMs = Math.max(1000, Number(envelope.timeoutMs) || 15000);
    const timeoutId = window.setTimeout(() => {
      pending.delete(requestId);
      sendResponse({
        status: "error",
        code: "SN_API_ERROR",
        message: `ServiceNow bridge request timed out (${actionName}).`,
      });
    }, timeoutMs);

    pending.set(requestId, (pageResponse) => {
      window.clearTimeout(timeoutId);
      if (pageResponse.ok) {
        sendResponse({ status: "success", data: pageResponse.data || {} });
        return;
      }
      sendResponse({
        status: "error",
        code: pageResponse.code || "SN_API_ERROR",
        message: pageResponse.message || "ServiceNow operation failed.",
        data: pageResponse.data || {},
      });
    });

    window.postMessage(
      {
        channel: REQUEST_CHANNEL,
        requestId,
        action: envelope.action,
        payload: envelope.payload || {},
      },
      "*"
    );

    return true;
  });

  injectPageBridge();
})();
