/* =========================================================
   AXON AI — chat.js
   Chat rendering + conversation engine.
   • Incremental streaming (only the live node is touched)
   • Edit → regenerate from that point (old branch removed)
   • Regenerate / stop / retry with real error reporting
   ========================================================= */

import { store, uid, getChat, createChat, touchChat, persistChats, scheduleSaveChats, flushSaveChats } from "./state.js";
import { sendChat, AIError, buildHistory } from "./ai.js";
import { modelInfo } from "./config.js";
import { renderMarkdown, setMarkdown } from "./markdown.js";
import { $, toast, copyText, confirmDialog, openImageViewer, formatTime, haptic, downloadFile } from "./ui.js";
import { queueOutbox, isSignedIn } from "./backend.js";
import { shareMessageSheet, shareChatSheet } from "./share.js";

const state = {
  activeChatId: null,
  streaming: false,
  controller: null,
  editingId: null,
  pendingImages: [],
  liveNode: null,
  liveText: "",
  rafPending: false,
  autoScroll: true,
  lastSent: null
};

export function getState() {
  return state;
}

export function activeChat() {
  return getChat(state.activeChatId);
}

/* ================= SCROLL ================= */

function scroller() {
  return $("#chatArea");
}

function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}

export function scrollToBottom(smooth = true) {
  const el = scroller();
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  state.autoScroll = true;
  $("#scrollBottomBtn")?.classList.add("hidden");
}

function maybeAutoScroll() {
  if (!state.autoScroll) return;
  const el = scroller();
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/* ================= RENDER ================= */

const AVATARS = {
  male: "./assets/male-avatar.webp",
  female: "./assets/female-avatar.webp"
};

export function avatarSrc(kind) {
  return AVATARS[kind] || AVATARS.male;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(id, cls = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (cls) svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

function buildHead(message) {
  const head = el("div", "msg-head");
  if (message.role === "user") {
    const img = el("img");
    img.src = avatarSrc(store.profile.avatar);
    img.alt = "";
    img.width = 22;
    img.height = 22;
    head.appendChild(img);
    head.appendChild(el("span", null, store.profile.name || "You"));
  } else {
    const mark = el("span", "ai-mark");
    mark.appendChild(icon("i-sparkles"));
    head.appendChild(mark);
    head.appendChild(el("span", null, "AXON"));
  }
  return head;
}

function buildImages(message) {
  if (!message.images || !message.images.length) return null;
  const wrap = el("div", "msg-images");
  message.images.forEach((img) => {
    if (!img || !img.dataUrl) return;
    const thumb = el("img");
    thumb.src = img.dataUrl;
    thumb.alt = "Attached image";
    thumb.loading = "lazy";
    thumb.addEventListener("click", () => openImageViewer(img.dataUrl, "Attached image"));
    wrap.appendChild(thumb);
  });
  return wrap.children.length ? wrap : null;
}

function actionButton({ iconId, label, onClick, active = false, danger = false, text = "" }) {
  const btn = el("button");
  btn.type = "button";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  if (active) btn.classList.add("active");
  if (danger) btn.classList.add("danger");
  btn.appendChild(icon(iconId));
  if (text) btn.appendChild(el("span", null, text));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(btn);
  });
  return btn;
}

function buildActions(message, chat) {
  const actions = el("div", "msg-actions");
  const isLastAi =
    message.role === "assistant" &&
    chat.messages[chat.messages.length - 1] &&
    chat.messages[chat.messages.length - 1].id === message.id;

  if (message.role === "assistant") {
    if (!message.error) {
      actions.appendChild(
        actionButton({
          iconId: "i-copy",
          label: "Copy answer",
          onClick: async () => {
            const ok = await copyText(message.content);
            toast(ok ? "Copied to clipboard" : "Could not copy", ok ? "" : "error");
          }
        })
      );
      actions.appendChild(
        actionButton({
          iconId: "i-share",
          label: "Share answer",
          onClick: () => shareMessage(message)
        })
      );
      actions.appendChild(
        actionButton({
          iconId: "i-thumbs-up",
          label: "Like answer",
          active: message.rating === "like",
          onClick: () => rateMessage(chat, message, "like")
        })
      );
      actions.appendChild(
        actionButton({
          iconId: "i-thumbs-down",
          label: "Dislike answer",
          active: message.rating === "dislike",
          onClick: () => rateMessage(chat, message, "dislike")
        })
      );
      if (isLastAi && !state.streaming) {
        actions.appendChild(
          actionButton({
            iconId: "i-refresh",
            label: "Regenerate response",
            text: "Retry",
            onClick: () => regenerate(chat, message.id)
          })
        );
      }
    }
  } else {
    actions.appendChild(
      actionButton({
        iconId: "i-copy",
        label: "Copy message",
        onClick: async () => {
          const ok = await copyText(message.content);
          toast(ok ? "Copied to clipboard" : "Could not copy", ok ? "" : "error");
        }
      })
    );
    actions.appendChild(
      actionButton({
        iconId: "i-edit",
        label: "Edit message",
        onClick: () => startEdit(chat, message.id)
      })
    );
    actions.appendChild(
      actionButton({
        iconId: "i-share",
        label: "Share message",
        onClick: () => shareMessage(message)
      })
    );
  }

  if (!message.error) actions.appendChild(el("span", "msg-time", formatTime(message.time)));
  if (message.role === "assistant" && !message.error && message.content) {
    actions.appendChild(
      actionButton({
        iconId: "i-volume",
        label: "Read answer aloud",
        onClick: () => {
          document.dispatchEvent(new CustomEvent("axon:speak", { detail: { text: message.content } }));
        }
      })
    );
  }
  return actions;
}

function buildErrorCard(chat, message) {
  const box = el("div", "msg-error");
  const title = el("div", "err-title");
  title.appendChild(icon("i-alert"));
  title.appendChild(el("span", null, message.error.title || "AXON could not answer"));
  box.appendChild(title);
  if (message.error.detail) box.appendChild(el("div", "err-detail", message.error.detail));

  const actions = el("div", "err-actions");
  const retry = el("button", "btn primary");
  retry.type = "button";
  retry.appendChild(icon("i-refresh"));
  retry.appendChild(el("span", null, "Retry"));
  retry.addEventListener("click", () => retryMessage(chat, message.id));
  actions.appendChild(retry);

  const settings = el("button", "btn ghost");
  settings.type = "button";
  settings.appendChild(icon("i-settings"));
  settings.appendChild(el("span", null, "Connection"));
  settings.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("axon:open-settings"));
  });
  actions.appendChild(settings);
  box.appendChild(actions);
  return box;
}

function buildMessage(chat, message) {
  const wrap = el("article", `msg ${message.role}`);
  wrap.dataset.id = message.id;
  wrap.appendChild(buildHead(message));

  const body = el("div", "msg-body");

  if (message.role === "user") {
    const images = buildImages(message);
    if (images) body.appendChild(images);
    if (message.content) body.appendChild(el("div", "user-text", message.content));
    if (message.pending) {
      const status = el("div", "send-status");
      status.appendChild(icon("i-refresh"));
      const label =
        message.pending === "offline"
          ? "Waiting for connection…"
          : message.pending === "image"
            ? "Sending image…"
            : "Sending...";
      status.appendChild(el("span", null, label));
      body.appendChild(status);
    } else if (message.failed) {
      const status = el("div", "send-status failed");
      status.appendChild(icon("i-alert"));
      status.appendChild(el("span", null, "Not sent"));
      body.appendChild(status);
    }
  } else if (message.error) {
    body.appendChild(buildErrorCard(chat, message));
  } else if (message.thinking) {
    body.appendChild(thinkingNode());
  } else {
    body.appendChild(renderMarkdown(message.content));
  }

  wrap.appendChild(body);
  wrap.appendChild(buildActions(message, chat));
  return wrap;
}

function thinkingNode(label) {
  const box = el("div", "thinking");
  box.setAttribute("aria-label", label || "AXON is thinking");
  if (label) box.appendChild(el("span", "thinking-label", label));
  box.appendChild(el("i"));
  box.appendChild(el("i"));
  box.appendChild(el("i"));
  return box;
}

/* Update the "Thinking…" label in place (e.g. when switching models). */
function setThinkingLabel(label) {
  if (!state.liveNode) return;
  const box = state.liveNode.querySelector(".thinking");
  if (!box) return;
  let span = box.querySelector(".thinking-label");
  if (!span) {
    span = el("span", "thinking-label");
    box.insertBefore(span, box.firstChild);
  }
  span.textContent = label;
}

export function renderMessages() {
  const chat = activeChat();
  const list = $("#messages");
  const welcome = $("#welcomeScreen");
  if (!list || !welcome) return;

  if (!chat || !chat.messages.length) {
    list.classList.add("hidden");
    welcome.classList.remove("hidden");
    list.replaceChildren();
    return;
  }

  welcome.classList.add("hidden");
  list.classList.remove("hidden");
  const frag = document.createDocumentFragment();
  chat.messages.forEach((m) => frag.appendChild(buildMessage(chat, m)));
  list.replaceChildren(frag);

  if (state.autoScroll) scrollToBottom(false);
}

/* ================= STREAMING DOM UPDATES ================= */

function ensureLiveMessage(chat, message) {
  const list = $("#messages");
  const welcome = $("#welcomeScreen");
  welcome?.classList.add("hidden");
  list?.classList.remove("hidden");

  let node = list.querySelector(`.msg[data-id="${message.id}"]`);
  if (!node) {
    node = buildMessage(chat, message);
    list.appendChild(node);
  }
  return node;
}

function scheduleLiveRender() {
  if (state.rafPending) return;
  state.rafPending = true;
  requestAnimationFrame(() => {
    state.rafPending = false;
    if (!state.liveNode) return;
    const body = state.liveNode.querySelector(".msg-body");
    if (!body) return;
    const caret = el("span", "caret");
    const rendered = renderMarkdown(state.liveText);
    rendered.appendChild(caret);
    body.replaceChildren(rendered);
    maybeAutoScroll();
  });
}

function setThinking(chat, message, on) {
  const node = ensureLiveMessage(chat, message);
  const body = node.querySelector(".msg-body");
  if (!body) return;
  if (on) body.replaceChildren(thinkingNode());
  else body.replaceChildren();
  maybeAutoScroll();
}

/* ================= SEND / STREAM ================= */

export function setActiveChat(id) {
  state.activeChatId = id;
  state.autoScroll = true;
  renderMessages();
  document.dispatchEvent(new CustomEvent("axon:chat-changed", { detail: { id } }));
}

export function newChat() {
  const chat = createChat();
  setActiveChat(chat.id);
  return chat;
}

export function ensureChat() {
  const chat = activeChat();
  if (chat) return chat;
  return newChat();
}

function titleFromText(text, images) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean) return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
  if (images && images.length) return images.length > 1 ? `${images.length} images` : "Image chat";
  return "New chat";
}

function errorFor(err) {
  if (!err) return { title: "Something went wrong", detail: "" };
  if (err instanceof AIError) {
    const map = {
      network: "Could not reach the AXON AI service. Check your internet connection.",
      timeout: "The AI service took too long to respond.",
      http: err.message,
      api: err.message,
      empty: "The AI service returned an empty answer.",
      parse: "The AI service returned an unreadable response.",
      nostream: "This browser cannot read streamed answers."
    };
    return {
      title: map[err.code] || err.message || "AXON could not answer",
      detail: err.detail || (err.status ? `HTTP ${err.status}` : "")
    };
  }
  return { title: err.message || "AXON could not answer", detail: "" };
}

async function runGeneration(chat, { assistantMessage, history, message, images }) {
  state.streaming = true;
  state.controller = new AbortController();
  state.liveText = "";
  state.liveNode = null;
  /* the user message is delivered to the AI now — clear its "Sending..." status */
  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
  if (lastUser && lastUser.pending) lastUser.pending = false;
  document.dispatchEvent(new CustomEvent("axon:stream-state", { detail: { streaming: true } }));

  assistantMessage.thinking = true;
  assistantMessage.error = null;
  assistantMessage.content = "";
  setThinking(chat, assistantMessage, true);

  const node = ensureLiveMessage(chat, assistantMessage);
  state.liveNode = node;

  try {
    const result = await sendChat({
      message,
      history,
      images,
      signal: state.controller.signal,
      onMeta: (meta) => {
        if (meta && meta.switching) {
          setThinkingLabel(`Switching to ${modelInfo(meta.to).label}…`);
        }
      },
      onDelta: (chunk) => {
        if (assistantMessage.thinking) {
          assistantMessage.thinking = false;
          setThinking(chat, assistantMessage, false);
        }
        state.liveText += chunk;
        assistantMessage.content = state.liveText;
        scheduleLiveRender();
      }
    });

    assistantMessage.content = result.text || state.liveText;
    assistantMessage.thinking = false;
    assistantMessage.error = null;
    assistantMessage.model = result.model;
    state.streaming = false;
    state.liveNode = null;
    touchChat(chat);
    flushSaveChats();
    renderMessages();
    maybeAutoScroll();
    if (store.settings.speakReplies && assistantMessage.content) {
      document.dispatchEvent(new CustomEvent("axon:speak", { detail: { text: assistantMessage.content } }));
    }
    document.dispatchEvent(new CustomEvent("axon:chat-updated"));
    return true;
  } catch (err) {
    const aborted = err && err.code === "aborted";
    state.streaming = false;
    state.liveNode = null;

    if (aborted) {
      assistantMessage.thinking = false;
      assistantMessage.content = state.liveText || assistantMessage.content;
      if (!assistantMessage.content) {
        assistantMessage.error = { title: "Generation stopped", detail: "" };
      }
    } else {
      assistantMessage.thinking = false;
      assistantMessage.content = state.liveText || "";
      assistantMessage.error = errorFor(err);
      assistantMessage.failed = true;
      if (!assistantMessage.content) assistantMessage.content = "";
    }

    touchChat(chat);
    flushSaveChats();
    renderMessages();
    document.dispatchEvent(new CustomEvent("axon:chat-updated"));
    if (!aborted) toast(errorFor(err).title, "error");
    return false;
  } finally {
    state.controller = null;
    document.dispatchEvent(new CustomEvent("axon:stream-state", { detail: { streaming: false } }));
    syncComposerButtons();
  }
}

export function syncComposerButtons() {
  const send = $("#sendBtn");
  const stop = $("#stopBtn");
  if (!send || !stop) return;
  if (state.streaming) {
    send.classList.add("hidden");
    stop.classList.remove("hidden");
  } else {
    send.classList.remove("hidden");
    stop.classList.add("hidden");
  }
}

export function stopGeneration() {
  if (state.controller) {
    state.controller.abort(new DOMException("user stop", "AbortError"));
    toast("Generation stopped");
  }
}

/**
 * Send the composer content.
 * If `editingId` is set, the message is replaced and everything after it is
 * regenerated (old branch removed) instead of adding a duplicate.
 */
export async function sendMessage({ text, images = [], editingId = null }) {
  if (state.streaming) {
    toast("AXON is still answering — stop it first", "error");
    return;
  }
  const content = (text || "").trim();
  if (!content && !images.length) return;

  /* offline: keep the message on screen and resume automatically */
  if (navigator.onLine === false) {
    queueOfflineSend({ text: content, images, editingId });
    return;
  }

  const chat = ensureChat();

  /* ---- edit branch: truncate and continue from the corrected message ---- */
  if (editingId) {
    const idx = chat.messages.findIndex((m) => m.id === editingId);
    if (idx === -1) return;
    chat.messages = chat.messages.slice(0, idx);
  }

  const userMessage = {
    id: uid("m"),
    role: "user",
    content,
    images: images.map((i) => ({ dataUrl: i.dataUrl, name: i.name || "" })),
    time: Date.now(),
    rating: null,
    error: null,
    pending: images.length ? "image" : true
  };
  chat.messages.push(userMessage);

  const history = buildHistory(chat.messages);
  const assistantMessage = {
    id: uid("m"),
    role: "assistant",
    content: "",
    images: [],
    time: Date.now(),
    rating: null,
    error: null,
    thinking: true
  };
  chat.messages.push(assistantMessage);

  if (chat.autoTitle) {
    chat.title = titleFromText(content, images);
  }
  touchChat(chat);
  persistChats();
  state.lastSent = { text: content, images, chatId: chat.id };

  /* user message is on screen immediately with a "Sending..." status */
  renderMessages();
  scrollToBottom(false);
  document.dispatchEvent(new CustomEvent("axon:chat-updated"));

  await runGeneration(chat, {
    assistantMessage,
    history,
    message: content,
    images: images.map((i) => i.dataUrl).filter(Boolean)
  });

  if (isSignedIn()) queueOutbox({ kind: "chat", chatId: chat.id });
}

export async function regenerate(chat, messageId) {
  if (state.streaming) return;
  const target = chat.messages.find((m) => m.id === messageId);
  if (!target || target.role !== "assistant") return;

  const idx = chat.messages.indexOf(target);
  const before = chat.messages.slice(0, idx);
  const lastUser = [...before].reverse().find((m) => m.role === "user");

  chat.messages = before;
  const history = buildHistory(chat.messages);
  const assistantMessage = {
    id: uid("m"),
    role: "assistant",
    content: "",
    images: [],
    time: Date.now(),
    rating: null,
    error: null,
    thinking: true
  };
  chat.messages.push(assistantMessage);
  touchChat(chat);
  persistChats();
  renderMessages();

  await runGeneration(chat, {
    assistantMessage,
    history,
    message: lastUser ? lastUser.content : "",
    images: lastUser && lastUser.images ? lastUser.images.map((i) => i.dataUrl) : []
  });
}

async function retryMessage(chat, messageId) {
  const msg = chat.messages.find((m) => m.id === messageId);
  if (!msg) return;
  await regenerate(chat, messageId);
}

/* ================= MESSAGE ACTIONS ================= */

export function rateMessage(chat, message, rating) {
  message.rating = message.rating === rating ? null : rating;
  touchChat(chat);
  persistChats();
  renderMessages();
  if (message.rating) {
    haptic(10);
    toast(message.rating === "like" ? "Thanks for the feedback" : "Feedback noted");
  }
}

export async function shareMessage(message) {
  shareMessageSheet(message, { who: message.role === "user" ? store.profile.name || "You" : "AXON" });
}

export function startEdit(chat, messageId) {
  const msg = chat.messages.find((m) => m.id === messageId);
  if (!msg || msg.role !== "user") return;
  state.editingId = messageId;
  const input = $("#messageInput");
  input.value = msg.content;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  autoGrow(input);
  $("#editBanner")?.classList.remove("hidden");
  document.dispatchEvent(new CustomEvent("axon:edit-mode", { detail: { on: true } }));
}

export function cancelEdit() {
  state.editingId = null;
  $("#editBanner")?.classList.add("hidden");
  const input = $("#messageInput");
  if (input) {
    input.value = "";
    autoGrow(input);
  }
  document.dispatchEvent(new CustomEvent("axon:edit-mode", { detail: { on: false } }));
}



/* ================= OFFLINE QUEUE ================= */

/* Messages typed while offline are kept on screen and sent when the network returns. */
const offlineQueue = [];

function queueOfflineSend(payload) {
  offlineQueue.push(payload);
  const chat = ensureChat();
  if (payload.editingId) {
    const idx = chat.messages.findIndex((m) => m.id === payload.editingId);
    if (idx !== -1) chat.messages = chat.messages.slice(0, idx);
  }
  chat.messages.push({
    id: uid("m"),
    role: "user",
    content: payload.text,
    images: payload.images.map((i) => ({ dataUrl: i.dataUrl, name: i.name || "" })),
    time: Date.now(),
    rating: null,
    error: null,
    pending: "offline"
  });
  if (chat.autoTitle && payload.text) chat.title = titleFromText(payload.text, payload.images);
  touchChat(chat);
  persistChats();
  renderMessages();
  scrollToBottom(false);
  toast("Offline — message will send when you reconnect");
}

export function offlinePendingCount() {
  return offlineQueue.length;
}

export async function flushOfflineQueue() {
  if (!offlineQueue.length || navigator.onLine === false) return;
  if (state.streaming) return;
  const batch = offlineQueue.splice(0, offlineQueue.length);
  for (const payload of batch) {
    await sendMessage(payload);
  }
}

/* ================= COMPOSER ================= */

export function autoGrow(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 168)}px`;
}

export function addPendingImages(images) {
  const max = 5;
  const room = max - state.pendingImages.length;
  if (room <= 0) {
    toast(`You can attach up to ${max} images`, "error");
    return;
  }
  state.pendingImages.push(...images.slice(0, room));
  renderPreviews();
}

export function clearPendingImages() {
  state.pendingImages = [];
  renderPreviews();
}

export function pendingImages() {
  return state.pendingImages;
}

function renderPreviews() {
  const wrap = $("#previewImages");
  const box = $("#imagePreview");
  if (!wrap || !box) return;
  wrap.replaceChildren();
  if (!state.pendingImages.length) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  state.pendingImages.forEach((img, index) => {
    const item = el("div", "preview-item");
    const thumb = el("img");
    thumb.src = img.dataUrl;
    thumb.alt = img.name || `Attachment ${index + 1}`;
    item.appendChild(thumb);

    const remove = el("button", "remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove attachment ${index + 1}`);
    remove.appendChild(icon("i-x"));
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      state.pendingImages.splice(index, 1);
      renderPreviews();
    });
    item.appendChild(remove);
    wrap.appendChild(item);
  });
}

export function initChatComposer() {
  const input = $("#messageInput");
  const sendBtn = $("#sendBtn");
  const stopBtn = $("#stopBtn");
  const attachBtn = $("#attachBtn");
  const fileInput = $("#fileInput");

  const submit = async () => {
    if (state.streaming) return;
    const text = input ? input.value : "";
    const images = [...state.pendingImages];
    if (!text.trim() && !images.length) return;
    const editingId = state.editingId;
    if (input) {
      input.value = "";
      autoGrow(input);
    }
    clearPendingImages();
    if (editingId) {
      state.editingId = null;
      $("#editBanner")?.classList.add("hidden");
      document.dispatchEvent(new CustomEvent("axon:edit-mode", { detail: { on: false } }));
    }
    await sendMessage({ text, images, editingId });
  };

  sendBtn?.addEventListener("click", submit);
  stopBtn?.addEventListener("click", stopGeneration);
  $("#cancelEditBtn")?.addEventListener("click", cancelEdit);

  input?.addEventListener("input", () => autoGrow(input));

  input?.addEventListener("keydown", (e) => {
    const enterSends = store.settings.enterToSend !== false;
    if (e.key === "Enter" && !e.shiftKey && enterSends && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  attachBtn?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const { prepareFiles } = await import("./images.js");
    const { images, errors } = await prepareFiles(files);
    if (images.length) addPendingImages(images);
    if (errors.length) toast(errors[0], "error");
    e.target.value = "";
  });

  /* paste images straight into the composer */
  input?.addEventListener("paste", async (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return;
    e.preventDefault();
    const { prepareFiles } = await import("./images.js");
    const { images, errors } = await prepareFiles(files);
    if (images.length) addPendingImages(images);
    if (errors.length) toast(errors[0], "error");
  });

  document.addEventListener("axon:stream-state", () => syncComposerButtons());
  document.addEventListener("axon:edit-mode", (e) => {
    const on = !!(e.detail && e.detail.on);
    $("#editBanner")?.classList.toggle("hidden", !on);
  });

  syncComposerButtons();
  renderPreviews();
}

/* ================= EXPORT ================= */

export function shareChat(chat) {
  shareChatSheet(chat, { markdown: chatToMarkdown(chat) });
}

export function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, "", `_Exported from AXON AI · ${new Date().toLocaleString()}_`, ""];
  chat.messages.forEach((m) => {
    const who = m.role === "user" ? store.profile.name || "You" : "AXON";
    lines.push(`## ${who}`);
    if (m.images && m.images.length) {
      lines.push(`_${m.images.length} image attachment(s)_`);
    }
    lines.push("", m.content || "", "");
  });
  return lines.join("\n");
}

export function exportChat(chat) {
  const name = `${(chat.title || "axon-chat").replace(/[^\w\-]+/g, "-").toLowerCase()}.md`;
  const ok = downloadFile(name, chatToMarkdown(chat), "text/markdown");
  toast(ok ? "Conversation exported" : "Export failed", ok ? "" : "error");
}

export function exportChatJSON(chat) {
  const name = `${(chat.title || "axon-chat").replace(/[^\w\-]+/g, "-").toLowerCase()}.json`;
  const ok = downloadFile(name, JSON.stringify(chat, null, 2), "application/json");
  toast(ok ? "Conversation exported" : "Export failed", ok ? "" : "error");
}

export function exportAllChats() {
  const ok = downloadFile(
    `axon-chats-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ app: "AXON AI", exportedAt: new Date().toISOString(), chats: store.chats }, null, 2),
    "application/json"
  );
  toast(ok ? `Exported ${store.chats.length} conversation(s)` : "Export failed", ok ? "" : "error");
}

export { setMarkdown };
