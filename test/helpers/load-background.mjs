import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const projectRoot = path.resolve(import.meta.dirname, "../..");

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage(initialValues) {
  const values = copy(initialValues || {});

  return {
    get(keys, callback) {
      const names = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(values, name)) {
          result[name] = copy(values[name]);
        }
      }
      callback(result);
    },
    set(nextValues, callback) {
      Object.assign(values, copy(nextValues));
      callback?.();
    },
    remove(keys, callback) {
      for (const name of Array.isArray(keys) ? keys : [keys]) {
        delete values[name];
      }
      callback?.();
    },
    snapshot() {
      return copy(values);
    },
  };
}

export async function loadBackground({
  initialStorage = {},
  nowMs = Date.now(),
  hasPermission = false,
  grantPermission = false,
  tabs = [],
  onTabMessage = () => ({ status: "success" }),
} = {}) {
  const source = await readFile(path.join(projectRoot, "background.js"), "utf8");
  const storage = createStorage(initialStorage);
  let currentNowMs = nowMs;
  let intervalId = 0;
  let generatedBlockCount = 0;
  const actionCalls = [];
  const permissionCalls = [];
  const tabMessages = [];

  class ControlledDate extends Date {
    constructor(...args) {
      super(...(args.length === 0 ? [currentNowMs] : args));
    }

    static now() {
      return currentNowMs;
    }
  }

  const chrome = {
    action: {
      setBadgeText(details, callback) {
        actionCalls.push({ method: "setBadgeText", details: copy(details) });
        callback?.();
      },
      setBadgeBackgroundColor(details, callback) {
        actionCalls.push({ method: "setBadgeBackgroundColor", details: copy(details) });
        callback?.();
      },
      setTitle(details, callback) {
        actionCalls.push({ method: "setTitle", details: copy(details) });
        callback?.();
      },
    },
    permissions: {
      contains(details, callback) {
        permissionCalls.push({ method: "contains", details: copy(details) });
        callback(hasPermission);
      },
      request(details, callback) {
        permissionCalls.push({ method: "request", details: copy(details) });
        callback(grantPermission);
      },
    },
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage() {},
    },
    scripting: {
      executeScript(_details, callback) {
        callback([]);
      },
    },
    storage: { local: storage },
    tabs: {
      query(_details, callback) {
        callback(copy(tabs));
      },
      sendMessage(tabId, message, callback) {
        tabMessages.push({ tabId, message: copy(message) });
        try {
          callback(copy(onTabMessage(tabId, message)));
        } catch (error) {
          chrome.runtime.lastError = { message: error.message };
          callback(undefined);
          chrome.runtime.lastError = null;
        }
      },
    },
  };

  const sandbox = {
    URL,
    chrome,
    console,
    crypto: {
      randomUUID: () => {
        generatedBlockCount += 1;
        return generatedBlockCount === 1 ? "test-block-id" : `test-block-id-${generatedBlockCount}`;
      },
    },
    Date: ControlledDate,
    setInterval() {
      intervalId += 1;
      return intervalId;
    },
    clearInterval() {},
  };
  sandbox.globalThis = sandbox;

  const testExports = `
    globalThis.__backgroundTestApi = {
      ready: () => initializationPromise,
      aggregateBlocksForSync: (...args) => JSON.parse(JSON.stringify(aggregateBlocksForSync(...args))),
      getBlocks: async () => JSON.parse(JSON.stringify(await getTimeBlocks())),
      getTimerData: () => JSON.parse(JSON.stringify(timerData)),
      getConfig: () => getServiceNowConfig(),
      getCachedLookups: () => getCachedLookups(),
      saveConfig: saveServiceNowConfig,
      connectServiceNowSession,
      fetchLookups: serviceNowFetchLookups,
      syncVisibleBlocks: serviceNowSyncVisibleBlocks,
      startTimer,
      stopTimer,
      finishTimer,
      saveManualSession,
      updateTimeBlock,
      deleteTimeBlock,
    };
  `;
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n${testExports}`, sandbox, { filename: "background.js" });
  await sandbox.__backgroundTestApi.ready();

  const rawApi = sandbox.__backgroundTestApi;
  const api = {
    ready: () => rawApi.ready(),
    aggregateBlocksForSync: (...args) => copy(rawApi.aggregateBlocksForSync(...args)),
    getBlocks: async () => copy(await rawApi.getBlocks()),
    getTimerData: () => copy(rawApi.getTimerData()),
    startTimer: async (...args) => copy(await rawApi.startTimer(...args)),
    stopTimer: async () => copy(await rawApi.stopTimer()),
    finishTimer: async () => copy(await rawApi.finishTimer()),
    saveManualSession: async (...args) => copy(await rawApi.saveManualSession(...args)),
    updateTimeBlock: async (...args) => copy(await rawApi.updateTimeBlock(...args)),
    deleteTimeBlock: async (...args) => copy(await rawApi.deleteTimeBlock(...args)),
    getConfig: async () => copy(await rawApi.getConfig()),
    getCachedLookups: async () => copy(await rawApi.getCachedLookups()),
    saveConfig: async (...args) => copy(await rawApi.saveConfig(...args)),
    connectServiceNowSession: async () => copy(await rawApi.connectServiceNowSession()),
    fetchLookups: async () => copy(await rawApi.fetchLookups()),
    syncVisibleBlocks: async (...args) => copy(await rawApi.syncVisibleBlocks(...args)),
  };

  return {
    api,
    setNow(nextNowMs) {
      currentNowMs = nextNowMs;
    },
    storage,
    actionCalls,
    permissionCalls,
    tabMessages,
  };
}
