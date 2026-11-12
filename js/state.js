/* =========================================================
   AXON AI — state.js
   Persistence layer + migration from the v1 (single-file) app.
   Keys written by the old app are read once and never deleted,
   so an upgrade can never lose a conversation.
   ========================================================= */

const K = {
  chats: "axon_chats",
  theme: "axon_theme",
  language: "axon_language",
  profile: "axon_profile",
  workerUrl: "axon_worker_url",
  settings: "axon_settings_v2",
  meta: "axon_meta_v2",
  auth: "axon_auth_v2",
  outbox: "axon_outbox_v2",
  session: "axon_session_v1"
};

export const DEFAULT_SETTINGS = {
  theme: "light",
  language: "English",
  textSize: "md",
  responseStyle: "balanced",
  enterToSend: true,
  stream: true,
  model: "auto",
  workerUrl: ""
};

export const DEFAULT_PROFILE = {
  name: "",
  avatar: "male",
  email: ""
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    /* Quota exceeded — surface it instead of failing silently. */
    console.warn("[axon] storage write failed", key, e);
    return false;
  }
}

export function uid(prefix = "id") {
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

/* ---------- normalisation (old records had fewer fields) ---------- */

function normalizeMessage(m, chatId) {
  const msg = m && typeof m === "object" ? m : {};
  const images = Array.isArray(msg.images)
    ? msg.images.filter((i) => i && (typeof i === "string" || i.dataUrl || i.imageId))
    : [];
  return {
    ...msg,
    id: msg.id || uid("m"),
    role: msg.role === "user" ? "user" : "assistant",
    content: typeof msg.content === "string" ? msg.content : "",
    images: images.map((i) => (typeof i === "string" ? { dataUrl: i } : i)),
    generatedImage: typeof msg.generatedImage === "string" ? msg.generatedImage : "",
    generatedImageId: msg.generatedImageId || "",
    imagePrompt: msg.imagePrompt || "",
    time: Number(msg.time) || Date.now(),
    rating: msg.rating === "like" || msg.rating === "dislike" ? msg.rating : null,
    error: msg.error || null,
    edited: !!msg.edited,
    chatId: msg.chatId || chatId
  };
}
function normalizeChat(c) {
  const chat = c && typeof c === "object" ? c : {};
  const id = chat.id || uid("c");
  return {
    id,
    title: typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : "New chat",
    messages: Array.isArray(chat.messages) ? chat.messages.map((m) => normalizeMessage(m, id)) : [],
    createdAt: Number(chat.createdAt) || Date.now(),
    updatedAt: Number(chat.updatedAt) || Number(chat.createdAt) || Date.now(),
    pinned: !!chat.pinned,
    pinnedAt: Number(chat.pinnedAt) || 0,
    autoTitle: chat.autoTitle !== false,
    serverId: chat.serverId || null,
    dirty: chat.dirty !== false
  };
}

/* ---------- public store ---------- */

export const store = {
  chats: [],
  settings: { ...DEFAULT_SETTINGS },
  profile: { ...DEFAULT_PROFILE },
  meta: { migrated: false, lastSync: 0, accountMode: "local" },
  auth: { email: "", verified: false, displayName: "" },
  outbox: [],
  session: null
};

let saveTimer = null;

export function loadAll() {
  /* --- v1 → v2 migration (idempotent, non-destructive) --- */
  const rawChats = readJSON(K.chats, []);
  store.chats = Array.isArray(rawChats) ? rawChats.map(normalizeChat) : [];

  const v1Theme = localStorage.getItem(K.theme);
  const v1Lang = localStorage.getItem(K.language);
  const v1Profile = readJSON(K.profile, null);
  const v1Worker = localStorage.getItem(K.workerUrl);

  const savedSettings = readJSON(K.settings, null);
  store.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };

  if (!savedSettings) {
    if (v1Theme === "dark" || v1Theme === "light" || v1Theme === "system") {
      store.settings.theme = v1Theme;
    }
    if (v1Lang) store.settings.language = v1Lang;
    if (v1Worker) store.settings.workerUrl = v1Worker;
  }

  const savedProfile = readJSON(K.profile, null);
  store.profile = { ...DEFAULT_PROFILE, ...(savedProfile || v1Profile || {}) };
  if (store.profile.avatar !== "female") store.profile.avatar = "male";

  store.meta = { ...store.meta, ...(readJSON(K.meta, {}) || {}) };
  store.auth = { ...store.auth, ...(readJSON(K.auth, {}) || {}) };
  store.outbox = readJSON(K.outbox, []) || [];
  store.session = readJSON(K.session, null);

  if (!store.meta.migrated) {
    store.meta.migrated = true;
    store.meta.migratedAt = Date.now();
    store.meta.migratedChats = store.chats.length;
    persistMeta();
  }

  return store;
}

export function persistChats() {
  return writeJSON(K.chats, store.chats);
}

export function persistSettings() {
  writeJSON(K.settings, store.settings);
  /* keep v1 keys in sync so a rollback still sees the same preferences */
  try {
    localStorage.setItem(K.theme, store.settings.theme);
    localStorage.setItem(K.language, store.settings.language);
    if (store.settings.workerUrl) localStorage.setItem(K.workerUrl, store.settings.workerUrl);
  } catch (e) {}
}

export function persistProfile() {
  writeJSON(K.profile, store.profile);
}

export function persistMeta() {
  writeJSON(K.meta, store.meta);
}

export function persistAuth() {
  writeJSON(K.auth, store.auth);
}

export function persistOutbox() {
  writeJSON(K.outbox, store.outbox);
}

export function saveSession(session) {
  store.session = session;
  if (session) writeJSON(K.session, session);
  else {
    try {
      localStorage.removeItem(K.session);
    } catch (e) {}
  }
}

/* Debounced save used by the streaming path (avoids a write per token). */
export function scheduleSaveChats(delay = 700) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistChats();
  }, delay);
}

export function flushSaveChats() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistChats();
}

/* ---------- chat helpers ---------- */

export function getChat(id) {
  return store.chats.find((c) => c.id === id) || null;
}

export function createChat(title = "New chat") {
  const chat = normalizeChat({ title, messages: [] });
  store.chats.unshift(chat);
  persistChats();
  return chat;
}

export function touchChat(chat) {
  chat.updatedAt = Date.now();
  chat.dirty = true;
}

export function deleteChat(id) {
  const i = store.chats.findIndex((c) => c.id === id);
  if (i >= 0) {
    store.chats.splice(i, 1);
    persistChats();
    return true;
  }
  return false;
}

export function togglePin(id) {
  const chat = getChat(id);
  if (!chat) return null;
  chat.pinned = !chat.pinned;
  chat.pinnedAt = chat.pinned ? Date.now() : 0;
  chat.dirty = true;
  persistChats();
  return chat.pinned;
}

export function duplicateChat(id) {
  const src = getChat(id);
  if (!src) return null;
  const copy = normalizeChat({
    ...src,
    id: uid("c"),
    title: `${src.title} (copy)`,
    pinned: false,
    serverId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  copy.messages = src.messages.map((m) => ({ ...normalizeMessage(m, copy.id), id: uid("m") }));
  store.chats.unshift(copy);
  persistChats();
  return copy;
}

export function renameChat(id, title) {
  const chat = getChat(id);
  if (!chat) return false;
  chat.title = title.trim() || "New chat";
  chat.autoTitle = false;
  chat.dirty = true;
  persistChats();
  return true;
}

/* Sorted view: pinned first, then by recency. */
export function sortedChats() {
  return [...store.chats].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return b.pinnedAt - a.pinnedAt;
    return b.updatedAt - a.updatedAt;
  });
}
