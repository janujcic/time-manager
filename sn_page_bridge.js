(() => {
  const REQUEST_CHANNEL = "tm_sn_bridge_request";
  const RESPONSE_CHANNEL = "tm_sn_bridge_response";

  function postResponse(payload) {
    window.postMessage({ channel: RESPONSE_CHANNEL, ...payload }, "*");
  }

  function readDisplayValue(value) {
    if (value && typeof value === "object") {
      if (typeof value.display_value === "string") {
        return value.display_value;
      }
      if (typeof value.value === "string") {
        return value.value;
      }
    }
    return value || "";
  }

  function readValue(value) {
    if (value && typeof value === "object") {
      if (typeof value.value === "string") {
        return value.value;
      }
      if (typeof value.display_value === "string") {
        return value.display_value;
      }
    }
    return value || "";
  }

  function getCurrentUser() {
    const userId = window.NOW?.user?.userID || window.g_user?.userID || "";
    const userName =
      window.NOW?.user?.name ||
      window.NOW?.user?.user_name ||
      window.g_user?.userName ||
      "";

    return { userId, userName };
  }

  async function fetchCsrfTokenFallback() {
    try {
      const response = await fetch("/sn_devstudio_/v1/get_publish_info", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return "";
      }
      const payload = await response.json().catch(() => ({}));
      const candidates = [
        payload?.result?.ck,
        payload?.result?.csrf_token,
        payload?.result?.csrfToken,
        payload?.ck,
        payload?.csrf_token,
        payload?.csrfToken,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
      }
    } catch {
      // Ignore fallback errors.
    }
    return "";
  }

  async function fetchSessionInfo() {
    const response = await fetch("/api/now/ui/session", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (response.status === 401) {
      throw {
        code: "SN_NOT_LOGGED_IN",
        message: "No active ServiceNow session found in this tab.",
        data: { recoveryHint: "Open ServiceNow, sign in, and retry Connect." },
      };
    }

    if (!response.ok) {
      throw {
        code: "SN_API_ERROR",
        message: `Session check failed (${response.status}).`,
      };
    }

    const payload = await response.json().catch(() => ({}));
    return payload || {};
  }

  function readUserFromSessionPayload(payload) {
    const candidates = [
      payload?.result?.user,
      payload?.result,
      payload?.user,
      payload?.data?.user,
      payload,
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const userId =
        candidate.userID ||
        candidate.userId ||
        candidate.user_id ||
        candidate.sys_id ||
        candidate.id ||
        "";
      const userName =
        candidate.user_name ||
        candidate.userName ||
        candidate.name ||
        candidate.display_name ||
        "";

      if (userId || userName) {
        return { userId: String(userId || ""), userName: String(userName || "") };
      }
    }

    return { userId: "", userName: "" };
  }

  async function resolveSessionUser() {
    const currentUser = getCurrentUser();
    if (currentUser.userId) {
      return currentUser;
    }

    const payload = await fetchSessionInfo();
    const resolved = readUserFromSessionPayload(payload);
    if (resolved.userId || resolved.userName) {
      return resolved;
    }

    return { userId: "", userName: "" };
  }

  function getCsrfToken() {
    return (
      window.g_ck ||
      window.NOW?.g_ck ||
      document.querySelector("meta[name='sysparm_ck']")?.getAttribute("content") ||
      ""
    );
  }

  async function buildHeaders({ requireCsrf = false, includeJson = false } = {}) {
    let token = getCsrfToken();
    if (!token) {
      token = await fetchCsrfTokenFallback();
    }

    if (requireCsrf && !token) {
      throw {
        code: "SN_CSRF_MISSING",
        message: "Unable to resolve ServiceNow CSRF token in this tab.",
        data: { recoveryHint: "Open a standard authenticated ServiceNow page and retry." },
      };
    }

    const headers = {
      Accept: "application/json",
    };

    if (token) {
      headers["X-UserToken"] = token;
    }
    if (includeJson) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }

  async function requestJson(endpoint, { method = "GET", body, requireCsrf = false } = {}) {
    const headers = await buildHeaders({
      requireCsrf,
      includeJson: body !== undefined,
    });
    const response = await fetch(endpoint, {
      method,
      credentials: "include",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      throw {
        code: "SN_NOT_LOGGED_IN",
        message: "ServiceNow session is not authenticated.",
        data: { recoveryHint: "Log in on the open ServiceNow tab and retry." },
      };
    }

    if (response.status === 403) {
      throw {
        code: "SN_API_ERROR",
        message: "ServiceNow access denied for this resource (403).",
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw {
        code: "SN_API_ERROR",
        message: `ServiceNow request failed (${response.status}). ${errorText}`.trim(),
      };
    }

    return response.json().catch(() => ({}));
  }

  async function fetchTable(endpoint) {
    const payload = await requestJson(endpoint, { method: "GET" });
    return Array.isArray(payload.result) ? payload.result : [];
  }

  async function checkSession() {
    return resolveSessionUser();
  }

  async function fetchLookups(payload = {}) {
    const payloadUserId = String(payload?.userId || "");
    let userId = payloadUserId;

    if (!userId) {
      const currentUser = await resolveSessionUser();
      userId = currentUser.userId;
    }

    if (!userId) {
      throw {
        code: "SN_API_ERROR",
        message: "Unable to resolve current ServiceNow user.",
        data: { recoveryHint: "Open a standard ServiceNow UI page for your instance and retry." },
      };
    }

    const taskQuery =
      `assigned_to=${userId}` +
      "^state!=7^ORstate=NULL^state!=3^ORstate=NULL^state!=4^ORstate=NULL";
    const taskEndpoint =
      "/api/now/table/task?sysparm_display_value=all&sysparm_exclude_reference_link=true" +
      "&sysparm_limit=500&sysparm_fields=sys_id,number,short_description,state" +
      `&sysparm_query=${encodeURIComponent(taskQuery)}`;

    const categoryQuery = "name=time_card^element=category^language=en^inactive=false";
    const categoryEndpoint =
      "/api/now/table/sys_choice?sysparm_display_value=all&sysparm_exclude_reference_link=true" +
      "&sysparm_limit=500&sysparm_fields=sys_id,value,label,language,sequence" +
      `&sysparm_query=${encodeURIComponent(categoryQuery)}`;

    const timeCodeQuery = `u_user=${userId}`;
    const timeCodeEndpoint =
      "/api/now/table/u_time_card_codes?sysparm_display_value=all&sysparm_exclude_reference_link=true" +
      "&sysparm_limit=500&sysparm_fields=sys_id,u_time_card_code,u_description,u_user" +
      `&sysparm_query=${encodeURIComponent(timeCodeQuery)}`;

    const [taskRows, categoryRows, timeCodeRows] = await Promise.all([
      fetchTable(taskEndpoint),
      fetchTable(categoryEndpoint),
      fetchTable(timeCodeEndpoint),
    ]);

    const tasks = taskRows
      .map((item) => ({
        sys_id: readDisplayValue(item.sys_id),
        number: String(readDisplayValue(item.number) || ""),
        short_description: String(readDisplayValue(item.short_description) || ""),
        state: String(readDisplayValue(item.state) || ""),
      }))
      .filter((item) => item.sys_id);

    const categories = categoryRows
      .map((item) => ({
        sys_id: readDisplayValue(item.sys_id),
        value: String(readValue(item.value) || ""),
        label: String(readDisplayValue(item.label) || ""),
        language: String(readValue(item.language) || ""),
        sequence: Number(readValue(item.sequence) || 0),
      }))
      .filter((item) => item.sys_id && item.value && item.language === "en")
      .sort((a, b) => a.sequence - b.sequence);

    const timeCodes = timeCodeRows
      .map((item) => ({
        sys_id: readDisplayValue(item.sys_id),
        u_time_card_code: String(readDisplayValue(item.u_time_card_code) || ""),
        u_description: String(readDisplayValue(item.u_description) || ""),
      }))
      .filter((item) => item.sys_id && item.u_time_card_code);

    return { tasks, categories, timeCodes };
  }

  function toHours(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }
    return Math.round(numericValue * 100) / 100;
  }

  function isSubmittedState(row) {
    const stateText = String(readDisplayValue(row?.state) || readValue(row?.state) || "")
      .trim()
      .toLowerCase();
    return stateText === "submitted";
  }

  function getTimeCardSysId(row) {
    return String(readValue(row?.sys_id) || readDisplayValue(row?.sys_id) || "").trim();
  }

  function buildTimeCardPayload(group, userId) {
    const dayHours = group.dayHours || {};
    const payload = {
      monday: toHours(dayHours.monday),
      tuesday: toHours(dayHours.tuesday),
      wednesday: toHours(dayHours.wednesday),
      thursday: toHours(dayHours.thursday),
      friday: toHours(dayHours.friday),
      saturday: toHours(dayHours.saturday),
      sunday: toHours(dayHours.sunday),
      total: toHours(group.totalHours),
      comments: Array.isArray(group.comments)
        ? Array.from(new Set(group.comments.map((item) => String(item || "").trim()).filter(Boolean))).join(
            "\n"
          )
        : "",
      week_starts_on: String(group.weekStartDate || ""),
      user: userId,
      u_time_card_code: String(group.snCodeSysId || ""),
    };

    if (group.snSelectionType === "task") {
      payload.task = String(group.snTaskSysId || "");
      payload.category = "task_work";
    } else {
      payload.task = "";
      payload.category = String(group.snCategoryValue || "");
    }

    return payload;
  }

  function buildMatchingCardsEndpoint(group, userId) {
    const baseQueryParts = [
      `user=${userId}`,
      `week_starts_on=${group.weekStartDate}`,
      `u_time_card_code=${group.snCodeSysId}`,
    ];
    if (group.snSelectionType === "task") {
      baseQueryParts.push(`task=${group.snTaskSysId}`);
      baseQueryParts.push("category=task_work");
    } else {
      baseQueryParts.push("taskISEMPTY");
      baseQueryParts.push(`category=${group.snCategoryValue}`);
    }
    baseQueryParts.push("ORDERBYDESCsys_updated_on");

    const query = baseQueryParts.join("^");
    return (
      "/api/now/table/time_card?sysparm_display_value=all&sysparm_exclude_reference_link=true" +
      "&sysparm_limit=50&sysparm_fields=sys_id,state,sys_updated_on,time_sheet,rate_type" +
      `&sysparm_query=${encodeURIComponent(query)}`
    );
  }

  async function fetchWeekDefaults(userId, weekStartDate, cache) {
    const cacheKey = `${userId}|${weekStartDate}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const query = `user=${userId}^week_starts_on=${weekStartDate}^ORDERBYDESCsys_updated_on`;
    const endpoint =
      "/api/now/table/time_card?sysparm_display_value=all&sysparm_exclude_reference_link=true" +
      "&sysparm_limit=1&sysparm_fields=sys_id,time_sheet,rate_type" +
      `&sysparm_query=${encodeURIComponent(query)}`;
    const rows = await fetchTable(endpoint);
    const firstRow = rows[0] || {};
    const defaults = {
      timeSheetSysId: String(readValue(firstRow.time_sheet) || ""),
      rateTypeSysId: String(readValue(firstRow.rate_type) || ""),
    };
    cache.set(cacheKey, defaults);
    return defaults;
  }

  async function upsertTimeCardGroup(group, userId, weekDefaultsCache) {
    const endpoint = buildMatchingCardsEndpoint(group, userId);
    const existingCards = await fetchTable(endpoint);
    const editableCards = existingCards.filter((row) => !isSubmittedState(row));

    if (editableCards.length === 0 && existingCards.length > 0) {
      return {
        status: "skipped",
        code: "SYNC_SUBMITTED_SKIP",
        message: "Matching time card is submitted and cannot be updated.",
        action: "",
        timeCardSysId: "",
      };
    }

    const payload = buildTimeCardPayload(group, userId);
    if (editableCards.length > 0) {
      const targetCard = editableCards[0];
      const targetSysId = getTimeCardSysId(targetCard);
      if (!targetSysId) {
        return {
          status: "error",
          code: "SYNC_UPSERT_FAILED",
          message: "Editable time card record is missing sys_id.",
          action: "",
          timeCardSysId: "",
        };
      }

      const updatePayload = await requestJson(`/api/now/table/time_card/${targetSysId}`, {
        method: "PATCH",
        body: payload,
        requireCsrf: true,
      });
      const updatedSysId = String(
        readValue(updatePayload?.result?.sys_id) || readDisplayValue(updatePayload?.result?.sys_id) || targetSysId
      );
      return {
        status: "success",
        action: "updated",
        code: "",
        message: "",
        timeCardSysId: updatedSysId,
      };
    }

    const defaults = await fetchWeekDefaults(userId, group.weekStartDate, weekDefaultsCache);
    if (defaults.timeSheetSysId) {
      payload.time_sheet = defaults.timeSheetSysId;
    }
    if (defaults.rateTypeSysId) {
      payload.rate_type = defaults.rateTypeSysId;
    }

    const createPayload = await requestJson("/api/now/table/time_card", {
      method: "POST",
      body: payload,
      requireCsrf: true,
    });
    const createdSysId = String(
      readValue(createPayload?.result?.sys_id) || readDisplayValue(createPayload?.result?.sys_id) || ""
    );
    return {
      status: "success",
      action: "created",
      code: "",
      message: "",
      timeCardSysId: createdSysId,
    };
  }

  function normalizeSyncGroup(group = {}) {
    const dayHours = group.dayHours || {};
    return {
      groupKey: String(group.groupKey || ""),
      weekStartDate: String(group.weekStartDate || ""),
      snSelectionType: String(group.snSelectionType || ""),
      snTaskSysId: String(group.snTaskSysId || ""),
      snCategoryValue: String(group.snCategoryValue || ""),
      snCodeSysId: String(group.snCodeSysId || ""),
      dayHours: {
        monday: toHours(dayHours.monday),
        tuesday: toHours(dayHours.tuesday),
        wednesday: toHours(dayHours.wednesday),
        thursday: toHours(dayHours.thursday),
        friday: toHours(dayHours.friday),
        saturday: toHours(dayHours.saturday),
        sunday: toHours(dayHours.sunday),
      },
      totalHours: toHours(group.totalHours),
      comments: Array.isArray(group.comments) ? group.comments : [],
    };
  }

  async function syncTimeCards(payload = {}) {
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    let userId = String(payload.userId || "");
    if (!userId) {
      const sessionUser = await resolveSessionUser();
      userId = String(sessionUser.userId || "");
    }

    if (!userId) {
      throw {
        code: "SN_API_ERROR",
        message: "Unable to resolve current ServiceNow user for sync.",
        data: { recoveryHint: "Connect again and retry sync." },
      };
    }

    const results = [];
    const weekDefaultsCache = new Map();
    for (const rawGroup of groups) {
      const group = normalizeSyncGroup(rawGroup);
      if (!group.groupKey || !group.weekStartDate || !group.snCodeSysId) {
        results.push({
          groupKey: group.groupKey,
          weekStartDate: group.weekStartDate,
          status: "error",
          code: "SYNC_INVALID_GROUP",
          action: "",
          message: "Missing required group fields for sync.",
          timeCardSysId: "",
        });
        continue;
      }
      if (group.snSelectionType === "task" && !group.snTaskSysId) {
        results.push({
          groupKey: group.groupKey,
          weekStartDate: group.weekStartDate,
          status: "error",
          code: "SYNC_INVALID_GROUP",
          action: "",
          message: "Task-linked group is missing task sys_id.",
          timeCardSysId: "",
        });
        continue;
      }
      if (group.snSelectionType === "category" && !group.snCategoryValue) {
        results.push({
          groupKey: group.groupKey,
          weekStartDate: group.weekStartDate,
          status: "error",
          code: "SYNC_INVALID_GROUP",
          action: "",
          message: "Category-linked group is missing category value.",
          timeCardSysId: "",
        });
        continue;
      }

      try {
        const upsertResult = await upsertTimeCardGroup(group, userId, weekDefaultsCache);
        results.push({
          groupKey: group.groupKey,
          weekStartDate: group.weekStartDate,
          ...upsertResult,
        });
      } catch (error) {
        if (error?.code === "SN_NOT_LOGGED_IN") {
          throw error;
        }
        results.push({
          groupKey: group.groupKey,
          weekStartDate: group.weekStartDate,
          status: "error",
          code: error?.code || "SYNC_UPSERT_FAILED",
          action: "",
          message: error?.message || "Failed to sync time card group.",
          timeCardSysId: "",
        });
      }
    }

    return { results };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const message = event.data;
    if (!message || message.channel !== REQUEST_CHANNEL || !message.requestId) {
      return;
    }

    const requestId = message.requestId;

    try {
      let data = {};

      if (message.action === "checkSession") {
        data = await checkSession();
      } else if (message.action === "fetchLookups") {
        data = await fetchLookups(message.payload || {});
      } else if (message.action === "syncTimeCards") {
        data = await syncTimeCards(message.payload || {});
      } else {
        throw {
          code: "SN_API_ERROR",
          message: "Unsupported ServiceNow bridge action.",
        };
      }

      postResponse({ requestId, ok: true, data });
    } catch (error) {
      postResponse({
        requestId,
        ok: false,
        code: error?.code || "SN_API_ERROR",
        message: error?.message || "ServiceNow bridge operation failed.",
        data: error?.data || {},
      });
    }
  });
})();
