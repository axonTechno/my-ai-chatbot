/* =========================================================
   AXON AI — backend.js
   Account / sync / support integration layer.
   • Local mode works fully offline (device-only chats).
   • Cloud mode activates automatically once BACKEND.baseUrl is
     configured — no UI changes required.
   • Nothing here pretends to succeed: every call reports the
     real transport result, and unsent items stay in an outbox.
   ========================================================= */

import { BACKEND, SUPPORT_ENDPOINT, APP_VERSION } from "./config.js";
import { saveSession, store, persistOutbox } from "./state.js";
import { uid } from "./state.js";

export function backendConfigured() {
  return !!(BACKEND.baseUrl && BACKEND.baseUrl.trim());
}

export function supportConfigured() {
  return !!(SUPPORT_ENDPOINT && SUPPORT_ENDPOINT.trim());
}

function base() {
  const b = BACKEND.baseUrl.trim();
  return b.endsWith("/") ? b : `${b}/`;
}

function authBase() {
  const b = (BACKEND.authBase || BACKEND.baseUrl || "").trim();
  return b.endsWith("/") ? b : `${b}/`;
}

export function session() {
  return store.session;
}

export function isSignedIn() {
  return !!(store.session && store.session.accessToken && store.session.email);
}

function authHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (isSignedIn()) headers.Authorization = `Bearer ${store.session.accessToken}`;
  return headers;
}

async function request(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = { raw: text };
    }
    if (!res.ok) {
      const message =
        (data && (data.message || data.error_description || data.error || data.msg)) ||
        `Request failed (HTTP ${res.status})`;
      const err = new Error(typeof message === "string" ? message : `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error("The request timed out.");
      e.status = 0;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function notConfigured() {
  const e = new Error("Cloud sync is not connected yet.");
  e.code = "not_configured";
  e.status = 0;
  return e;
}

/* ================= AUTH (email OTP, no password) ================= */

export async function requestEmailCode(email) {
  if (!backendConfigured()) throw notConfigured();
  return request(`${authBase()}auth/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, app: "axon", version: APP_VERSION })
  });
}

export async function verifyEmailCode(email, code) {
  if (!backendConfigured()) throw notConfigured();
  const data = await request(`${authBase()}auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, app: "axon" })
  });
  if (!data || !data.access_token) {
    throw new Error("The server did not return a session token.");
  }
  const sess = {
    email,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_at || (data.expires_in ? Date.now() + data.expires_in * 1000 : 0),
    userId: data.user_id || data.user?.id || null,
    createdAt: Date.now()
  };
  saveSession(sess);
  return sess;
}

export async function refreshSession() {
  if (!isSignedIn() || !store.session.refreshToken) return false;
  try {
    const data = await request(`${authBase()}auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: store.session.refreshToken })
    });
    if (!data || !data.access_token) return false;
    saveSession({
      ...store.session,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || store.session.refreshToken,
      expiresAt: data.expires_at || (data.expires_in ? Date.now() + data.expires_in * 1000 : 0)
    });
    return true;
  } catch (e) {
    return false;
  }
}

export function signOutLocal() {
  saveSession(null);
}

/* ================= CHAT SYNC ================= */

function chatPayload(chat) {
  return {
    client_id: chat.id,
    title: chat.title,
    pinned: !!chat.pinned,
    pinned_at: chat.pinnedAt || null,
    created_at: new Date(chat.createdAt).toISOString(),
    updated_at: new Date(chat.updatedAt).toISOString(),
    messages: chat.messages.map((m, index) => ({
      client_id: m.id,
      role: m.role,
      content: m.content,
      images: (m.images || []).map((i) => i.dataUrl).filter(Boolean),
      rating: m.rating || null,
      created_at: new Date(m.time).toISOString(),
      position: index
    }))
  };
}

export async function pushChat(chat) {
  if (!isSignedIn()) throw notConfigured();
  const data = await request(`${base()}chats/${encodeURIComponent(chat.id)}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(chatPayload(chat))
  });
  return data;
}

export async function deleteRemoteChat(chatId) {
  if (!isSignedIn()) throw notConfigured();
  return request(`${base()}chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
}

export async function pullChats(since = 0) {
  if (!isSignedIn()) throw notConfigured();
  const qs = since ? `?since=${encodeURIComponent(new Date(since).toISOString())}` : "";
  const data = await request(`${base()}chats${qs}`, { method: "GET", headers: authHeaders() });
  return (data && (data.chats || data.data)) || [];
}

export async function pushProfile(profile) {
  if (!isSignedIn()) throw notConfigured();
  return request(`${base()}profile`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ name: profile.name, avatar: profile.avatar })
  });
}

export async function pushSettings(settings) {
  if (!isSignedIn()) throw notConfigured();
  return request(`${base()}settings`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(settings)
  });
}

export async function pullProfile() {
  if (!isSignedIn()) throw notConfigured();
  return request(`${base()}profile`, { method: "GET", headers: authHeaders() });
}

/* Convert a server chat row into the local shape. */
export function chatFromServer(row) {
  if (!row) return null;
  return {
    id: row.client_id || row.id,
    title: row.title || "New chat",
    pinned: !!row.pinned,
    pinnedAt: row.pinned_at ? new Date(row.pinned_at).getTime() : 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    autoTitle: false,
    serverId: row.id || null,
    dirty: false,
    messages: (row.messages || []).map((m, i) => ({
      id: m.client_id || m.id || uid("m"),
      role: m.role === "user" ? "user" : "assistant",
      content: m.content || "",
      images: (m.images || []).map((d) => ({ dataUrl: d })),
      time: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      rating: m.rating || null,
      error: null,
      position: i
    }))
  };
}

/* ================= SUPPORT ================= */

export async function submitSupport(kind, text, extra = {}) {
  const requestId = uid("req");
  const payload = {
    request_id: requestId,
    kind,
    message: text,
    app: "axon",
    version: APP_VERSION,
    email: store.profile.email || store.auth.email || "",
    user_agent: navigator.userAgent,
    locale: navigator.language,
    created_at: new Date().toISOString(),
    ...extra
  };

  if (!supportConfigured()) {
    return { delivered: false, requestId, reason: "not_configured" };
  }

  try {
    const data = await request(
      SUPPORT_ENDPOINT,
      {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload)
      },
      15000
    );
    return {
      delivered: true,
      requestId: (data && (data.request_id || data.id)) || requestId,
      data
    };
  } catch (err) {
    const e = new Error(err.message || "Submission failed.");
    e.code = "submit_failed";
    e.requestId = requestId;
    throw e;
  }
}

/* ================= OUTBOX (unsent sync work) ================= */

/** Push every locally-changed chat, then pull anything newer from the account.
 *  Returns real counts; never reports success when nothing was delivered. */
export async function syncStatus() {
  if (!isSignedIn()) return { pushed: 0, pulled: 0, error: "not_signed_in" };
  let pushed = 0;
  let pulled = 0;
  try {
    const dirty = store.chats.filter((c) => c.dirty);
    for (const chat of dirty) {
      await pushChat(chat);
      chat.dirty = false;
      pushed++;
    }
    const since = store.meta.lastSync || 0;
    const rows = await pullChats(since);
    rows.forEach((row) => {
      const remote = chatFromServer(row);
      if (!remote) return;
      const local = store.chats.find((c) => c.id === remote.id);
      if (!local) {
        store.chats.push(remote);
        pulled++;
      } else if (remote.updatedAt > local.updatedAt) {
        Object.assign(local, remote, { dirty: false });
        pulled++;
      }
    });
    store.meta.lastSync = Date.now();
    const { persistChats, persistMeta } = await import("./state.js");
    persistChats();
    persistMeta();
    await flushOutbox();
    return { pushed, pulled, error: null };
  } catch (err) {
    return { pushed, pulled, error: err.message || "Sync failed" };
  }
}

export function queueOutbox(entry) {
  store.outbox.push({
    id: uid("ob"),
    at: Date.now(),
    attempts: 0,
    ...entry
  });
  if (store.outbox.length > 200) store.outbox.splice(0, store.outbox.length - 200);
  persistOutbox();
}

export async function flushOutbox() {
  if (!isSignedIn() || !store.outbox.length) return { sent: 0, left: store.outbox.length };
  let sent = 0;
  const remaining = [];
  for (const item of store.outbox) {
    try {
      if (item.kind === "chat") {
        const chat = store.chats.find((c) => c.id === item.chatId);
        if (chat) await pushChat(chat);
      } else if (item.kind === "delete") {
        await deleteRemoteChat(item.chatId);
      } else if (item.kind === "profile") {
        await pushProfile(store.profile);
      } else if (item.kind === "settings") {
        await pushSettings(store.settings);
      }
      sent++;
    } catch (e) {
      remaining.push({ ...item, attempts: (item.attempts || 0) + 1 });
    }
  }
  store.outbox = remaining;
  persistOutbox();
  return { sent, left: remaining.length };
}
