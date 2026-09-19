import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function waitForResponse(responses, requestId) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1_000;
    const poll = () => {
      const response = responses.find((item) => item.requestId === requestId);
      if (response) {
        resolve(response);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Page bridge did not respond to ${requestId}.`));
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

export async function loadPageBridge(fetchImpl) {
  const source = await readFile(path.join(projectRoot, "sn_page_bridge.js"), "utf8");
  const listeners = new Map();
  const responses = [];
  const window = {
    NOW: { user: { userID: "user-1", name: "Test User" } },
    g_ck: "csrf-test-token",
    addEventListener(eventName, listener) {
      listeners.set(eventName, listener);
    },
    removeEventListener(eventName, listener) {
      if (listeners.get(eventName) === listener) {
        listeners.delete(eventName);
      }
    },
    postMessage(message) {
      if (message?.channel === "tm_sn_bridge_response") {
        responses.push(JSON.parse(JSON.stringify(message)));
      }
    },
  };
  const sandbox = {
    console,
    document: { querySelector() { return null; } },
    fetch: fetchImpl,
    window,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "sn_page_bridge.js" });

  return {
    async syncTimeCards(payload) {
      const requestId = `request-${responses.length + 1}`;
      const listener = listeners.get("message");
      if (!listener) {
        throw new Error("Page bridge message listener was not installed.");
      }
      listener({
        source: window,
        data: {
          channel: "tm_sn_bridge_request",
          requestId,
          action: "syncTimeCards",
          payload,
        },
      });
      return waitForResponse(responses, requestId);
    },
  };
}
