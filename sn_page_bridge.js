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

  async function buildHeaders() {
    let token = getCsrfToken();
    if (!token) {
      token = await fetchCsrfTokenFallback();
    }

    const headers = {
      Accept: "application/json",
    };

    if (token) {
      headers["X-UserToken"] = token;
    }

    return headers;
  }

  async function fetchTable(endpoint) {
    const headers = await buildHeaders();
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "include",
      headers,
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
      throw {
        code: "SN_API_ERROR",
        message: `ServiceNow request failed (${response.status}).`,
      };
    }

    const payload = await response.json().catch(() => ({}));
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
