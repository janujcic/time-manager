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

export async function loadBackground({ initialStorage = {}, nowMs = Date.now() } = {}) {
  const source = await readFile(path.join(projectRoot, "background.js"), "utf8");
  const storage = createStorage(initialStorage);
  let currentNowMs = nowMs;
  let intervalId = 0;

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
      setBadgeText(_details, callback) {
        callback?.();
      },
      setBadgeBackgroundColor(_details, callback) {
        callback?.();
      },
      setTitle(_details, callback) {
        callback?.();
      },
    },
    permissions: {
      contains(_details, callback) {
        callback(false);
      },
      request(_details, callback) {
        callback(false);
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
        callback([]);
      },
      sendMessage(_tabId, _message, callback) {
        callback(undefined);
      },
    },
  };

  const sandbox = {
    URL,
    chrome,
    console,
    crypto: { randomUUID: () => "test-block-id" },
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
      startTimer,
      stopTimer,
      finishTimer,
      saveManualSession,
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
  };

  return {
    api,
    setNow(nextNowMs) {
      currentNowMs = nextNowMs;
    },
    storage,
  };
}
