import assert from "node:assert/strict";
import test from "node:test";
import { loadBackground } from "../helpers/load-background.mjs";

const HOUR_MS = 60 * 60 * 1000;

test("[F-PROFILE-01] legacy extension data migrates into the protected Default profile", async () => {
  const { api, storage } = await loadBackground({
    initialStorage: {
      timeBlocks: [{ id: "legacy", task: "Existing work", startMs: 1, endMs: 2, durationMs: 1 }],
      sn_config: { enabled: true, instanceUrl: "https://example.service-now.com" },
      dashboardPreferences: { rangePreset: "all" },
    },
  });

  const state = await api.getProfileState();
  assert.equal(state.activeProfile.name, "Default");
  assert.equal(state.activeProfile.isDefault, true);
  assert.equal((await api.getBlocks())[0].task, "Existing work");
  assert.equal((await api.getConfig()).enabled, true);
  assert.equal(storage.snapshot().timeBlocks, undefined);
});

test("[F-PROFILE-02] profiles isolate data and support renaming and permanent deletion", async () => {
  const { api } = await loadBackground();
  await api.saveManualSession({ taskName: "Default work", startTimeMs: 10, endTimeMs: 10 + HOUR_MS });
  await api.saveConfig({ enabled: true, instanceUrl: "https://default.service-now.com" });

  const created = await api.createProfile("Client B");
  assert.equal(created.status, "success");
  const clientId = created.data.activeProfile.id;
  assert.equal((await api.renameProfile(clientId, "Client Blue")).status, "success");
  assert.equal((await api.getBlocks()).length, 0);
  assert.equal((await api.getConfig()).enabled, false);

  await api.saveManualSession({ taskName: "Client work", startTimeMs: 20, endTimeMs: 20 + HOUR_MS });
  const defaultId = (await api.getProfileState()).profiles.find((profile) => profile.isDefault).id;
  await api.selectProfile(defaultId);
  assert.deepEqual((await api.getBlocks()).map((block) => block.task), ["Default work"]);
  assert.equal((await api.deleteProfile(clientId)).status, "success");
  assert.equal((await api.getProfileState()).profiles.some((profile) => profile.id === clientId), false);
});

test("[F-PROFILE-03] active tasks block switching and deleting profiles until finished", async () => {
  const { api } = await loadBackground({ nowMs: 1000 });
  const created = await api.createProfile("Client B");
  const clientId = created.data.activeProfile.id;
  const defaultId = (await api.getProfileState()).profiles.find((profile) => profile.isDefault).id;
  await api.selectProfile(defaultId);
  await api.startTimer("Focused task");
  assert.equal((await api.selectProfile(clientId)).code, "PROFILE_SWITCH_BLOCKED");
  assert.equal((await api.deleteProfile(clientId)).code, "PROFILE_SWITCH_BLOCKED");
  await api.finishTimer();
  assert.equal((await api.selectProfile(clientId)).status, "success");
});
