/* =========================================================
   AXON AI — chat.js
   Chat rendering + conversation engine.
   • Incremental streaming (only the live node is touched)
   • Edit → regenerate from that point (old branch removed)
   • Regenerate / stop / retry with real error reporting
   ========================================================= */

import { store, uid, getChat, createChat, touchChat, persistChats, scheduleSaveChats, flushSaveChats } from "./state.js";
import { sendChat, generateImage, editImage, AIError, buildHistory } from "./ai.js";
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
  return el("div", "msg-head");
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
    const menu = el("div", "user-action-menu");
    menu.appendChild(actionButton({
      iconId: "i-copy",
      label: "Copy message",
      onClick: async () => {
        const ok = await copyText(message.content);
        toast(ok ? "Copied to clipboard" : "Could not copy", ok ? "" : "error");
      }
    }));
    menu.appendChild(actionButton({
      iconId: "i-edit",
      label: "Edit message",
      onClick: () => startEdit(chat, message.id)
    }));
    menu.appendChild(actionButton({
      iconId: "i-share",
      label: "Share message",
      onClick: () => shareMessage(message)
    }));
    actions.appendChild(menu);
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
    if (message.content) {
      const text = el("div", "user-text", message.content);
      body.appendChild(text);

      requestAnimationFrame(() => {
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        const maxHeight = lineHeight * 5;

        if (text.scrollHeight <= maxHeight + 2) return;

        text.classList.add("is-collapsed");

        const toggle = el("button", "user-text-toggle", "Show more");
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", "false");

        toggle.addEventListener("click", () => {
          const expanded = text.classList.toggle("is-collapsed");
          toggle.textContent = expanded ? "Show more" : "Show less";
          toggle.setAttribute("aria-expanded", String(!expanded));
        });

        body.appendChild(toggle);
      });
    }
  } else if (message.error) {
    body.appendChild(buildErrorCard(chat, message));
  } else if (message.imageGeneration) {
    const panel = el("div", "generated-image-panel");
    if (message.imageStatus === "generating") {
      panel.appendChild(thinkingNode("AXON is generating your image…"));
    } else if (message.generatedImage) {
      const image = el("img", "generated-image");
      image.src = message.generatedImage;
      image.alt = message.imagePrompt || "Generated image";
      image.addEventListener("click", () => openImageViewer(message.generatedImage, image.alt, {
        onDownload: () => downloadGeneratedImage(message),
        onShare: () => shareGeneratedImage(message),
        onRegenerate: () => regenerateImage(chat, message)
      }));
      panel.appendChild(image);
      const actions = el("div", "generated-image-actions");
      actions.appendChild(actionButton({iconId:"i-download",label:"Download image",onClick:()=>downloadGeneratedImage(message)}));
      actions.appendChild(actionButton({iconId:"i-share",label:"Share image",onClick:()=>shareGeneratedImage(message)}));
      actions.appendChild(actionButton({iconId:"i-refresh",label:"Regenerate image",onClick:()=>regenerateImage(chat,message)}));
      panel.appendChild(actions);
    } else if (message.imageStatus === "error") {
      panel.appendChild(el("p", "generated-image-error", message.imageError || "Image generation failed."));
      panel.appendChild(actionButton({iconId:"i-refresh",label:"Try again",onClick:()=>regenerateImage(chat,message)}));
    }
    body.appendChild(panel);
  } else if (message.thinking) {
    body.appendChild(thinkingNode());
  } else {
    body.appendChild(renderMarkdown(message.content));
  }

  wrap.appendChild(body);
  
  // Add sending status as separate element below the message
  if (message.pending || message.failed) {
    const statusWrap = el("div", "send-status-wrapper");
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
      statusWrap.appendChild(status);
    } else if (message.failed) {
      const status = el("div", "send-status failed");
      status.appendChild(icon("i-alert"));
      status.appendChild(el("span", null, "Not sent"));
      statusWrap.appendChild(status);
    }
    wrap.appendChild(statusWrap);
  }
  
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

let userMenuEventsBound = false;
let userPressTimer = null;
let userPressTarget = null;
let userPressStart = null;
let suppressContextMenuUntil = 0;

function closeUserActionMenus() {
  document.querySelectorAll(".user-action-menu.menu-open").forEach((menu) => {
    menu.classList.remove("menu-open");
    menu.style.left = "";
    menu.style.top = "";
  });
}

function openUserActionMenu(item) {
  closeUserActionMenus();
  const menu = item.querySelector(".user-action-menu");
  const body = item.querySelector(".msg-body");
  const area = document.querySelector("#chatArea");
  if (!menu || !body || !area) return;

  menu.classList.add("menu-open");
  const bodyRect = body.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const pad = 8;

  const leftMin = Math.max(pad, areaRect.left + pad);
  const leftMax = Math.min(window.innerWidth - menuRect.width - pad, areaRect.right - menuRect.width - pad);
  const left = Math.max(leftMin, Math.min(bodyRect.right - menuRect.width, leftMax));

  const topMin = Math.max(pad, areaRect.top + pad);
  const topMax = Math.min(window.innerHeight - menuRect.height - pad, areaRect.bottom - menuRect.height - pad);
  const above = bodyRect.top - menuRect.height - 8;
  const below = bodyRect.bottom + 8;
  let top = above >= topMin ? above : below;
  if (above < topMin && below > topMax) {
    top = bodyRect.top - topMin > topMax - bodyRect.bottom ? above : below;
  }
  top = Math.max(topMin, Math.min(top, topMax));
  menu.style.left = Math.max(pad, left) + "px";
  menu.style.top = Math.max(pad, top) + "px";
}

function bindUserActionMenu(list) {
  if (userMenuEventsBound) return;
  userMenuEventsBound = true;

  list.addEventListener("pointerdown", (event) => {
    const item = event.target.closest(".msg.user");
    if (!item || event.target.closest(".user-action-menu") || event.pointerType !== "touch") return;
    clearTimeout(userPressTimer);
    userPressTarget = item;
    userPressStart = { x: event.clientX, y: event.clientY };
    userPressTimer = setTimeout(() => {
      if (userPressTarget === item) {
        openUserActionMenu(item);
        suppressContextMenuUntil = Date.now() + 900;
        userPressTarget = null;
      }
    }, 500);
  });

  list.addEventListener("pointermove", (event) => {
    if (!userPressTarget || !userPressStart) return;
    if (Math.abs(event.clientX - userPressStart.x) > 10 || Math.abs(event.clientY - userPressStart.y) > 10) {
      clearTimeout(userPressTimer);
      userPressTarget = null;
    }
  });

  ["pointerup", "pointercancel"].forEach((name) => {
    list.addEventListener(name, () => {
      clearTimeout(userPressTimer);
      userPressTarget = null;
      userPressStart = null;
    });
  });

  list.addEventListener("contextmenu", (event) => {
    const item = event.target.closest(".msg.user");
    if (!item) return;
    event.preventDefault();
    if (Date.now() < suppressContextMenuUntil) return;
    openUserActionMenu(item);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".user-action-menu")) closeUserActionMenus();
  }, true);

  document.querySelector("#chatArea")?.addEventListener("scroll", closeUserActionMenus, { passive: true });
  window.addEventListener("resize", closeUserActionMenus);
}

export function renderMessages() {
  const chat = activeChat();
  const list = $("#messages");
  const welcome = $("#welcomeScreen");
  if (!list || !welcome) return;
  document.body.classList.toggle("has-messages", !!chat && chat.messages.length > 0);

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
  bindUserActionMenu(list);

  if (state.autoScroll) scrollToBottom(false);
}

/* ================= STREAMING DOM UPDATES ================= */

function ensureLiveMessage(chat, message) {
  const list = $("#messages");
  const welcome = $("#welcomeScreen");
  welcome?.classList.add("hidden");
  document.body.classList.add("has-messages");
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


function isImageGenerationRequest(text, images = []) {
  if (images.length) return false;

  const value = String(text || "").toLowerCase().trim();
  if (!value || /^(how|what|why|can you explain|kaise|kya hota)/i.test(value)) {
    return false;
  }

  const imageWord = /\b(image|picture|photo|illustration|artwork|wallpaper|drawing|poster|logo)\b|इमेज|तस्वीर|फोटो|चित्र|तसवीर/i.test(value);
  const createWord = /\b(create|generate|draw|make|design|paint|illustrate|banao|bana|banado|bana do|tayyar karo)\b|बनाओ|बना दो|बनाना|तैयार करो/i.test(value);

  return imageWord && createWord;
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
  const previousGeneratedImage = [...chat.messages].reverse().find((m) =>
    m.role === "assistant" &&
    m.imageGeneration &&
    m.imageStatus === "done" &&
    typeof m.generatedImage === "string" &&
    m.generatedImage.startsWith("data:image/")
  );

  const editImageRequest = Boolean(
    !images.length && previousGeneratedImage && isImageEditRequest(content)
  );
  const makeImage = !editImageRequest && isImageGenerationRequest(content, images);

  const assistantMessage = {
    id: uid("m"),
    role: "assistant",
    content: "",
    images: [],
    time: Date.now(),
    rating: null,
    error: null,
    thinking: !makeImage && !editImageRequest,
    ...(makeImage || editImageRequest ? {
      imageGeneration: true,
      imageEdit: editImageRequest,
      ...(editImageRequest ? { sourceImageId: previousGeneratedImage.id } : {}),
      imageStatus: "generating",
      imagePrompt: content
    } : {})
  };
  chat.messages.push(assistantMessage);

  if (chat.autoTitle && chat.messages.filter((message) => message.role === "user").length === 1) {
    chat.title = titleFromText(content, images);
  }
  touchChat(chat);
  persistChats();
  state.lastSent = { text: content, images, chatId: chat.id };

  /* user message is on screen immediately with a "Sending..." status */
  renderMessages();
  scrollToBottom(false);
  document.dispatchEvent(new CustomEvent("axon:chat-updated"));

  if (editImageRequest) {
    await runImageGeneration(chat, assistantMessage, content, previousGeneratedImage.generatedImage);
  } else if (makeImage) {
    await runImageGeneration(chat, assistantMessage, content);
  } else {
    const requestImages = images.map((i) => i.dataUrl).filter(Boolean);

    if (
      previousGeneratedImage &&
      requestImages.length < 5 &&
      !requestImages.includes(previousGeneratedImage.generatedImage)
    ) {
      requestImages.push(previousGeneratedImage.generatedImage);
    }

    await runGeneration(chat, {
      assistantMessage,
      history,
      message: content,
      images: requestImages
    });
  }

  if (isSignedIn()) queueOutbox({ kind: "chat", chatId: chat.id });
}

export async function regenerate(chat, messageId) {
  if (state.streaming) return;
  const target = chat.messages.find((m) => m.id === messageId);
  if (!target || target.role !== "assistant") return;
  if (target.imageGeneration) return regenerateImage(chat, target);

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


/* ================= GENERATED IMAGE ACTIONS ================= */

async function downloadGeneratedImage(message) {
  if (!message?.generatedImage) return;
  try {
    const blob = await fetch(message.generatedImage).then((r) => r.blob());
    const ok = downloadFile("axon-generated-image.png", blob, blob.type || "image/png");
    if (!ok) throw new Error("Download could not start.");
    toast("Image download started");
  } catch (err) {
    toast(err.message || "Could not download image.", "error");
  }
}

async function shareGeneratedImage(message) {
  if (!message?.generatedImage) return;
  try {
    const blob = await fetch(message.generatedImage).then((r) => r.blob());
    const file = new File([blob], "axon-generated-image.png", {
      type: blob.type || "image/png"
    });

    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: "AXON generated image" });
    } else {
      downloadFile("axon-generated-image.png", blob, blob.type || "image/png");
      toast("Image sharing is unavailable here; download started.");
    }
  } catch (err) {
    if (err?.name !== "AbortError") {
      toast(err.message || "Could not share image.", "error");
    }
  }
}

async function runImageGeneration(chat, message, prompt, sourceImage = null) {
  if (state.streaming) return false;

  state.streaming = true;
  state.controller = new AbortController();
  const controller = state.controller;

  message.imageGeneration = true;
  message.imagePrompt = prompt;
  message.imageStatus = "generating";
  message.generatedImage = "";
  message.imageError = "";
  message.thinking = false;
  message.error = null;

  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
  if (lastUser) lastUser.pending = false;

  touchChat(chat);
  persistChats();
  renderMessages();
  scrollToBottom(false);
  document.dispatchEvent(new CustomEvent("axon:stream-state", {
    detail: { streaming: true }
  }));

  try {
    const result = sourceImage
      ? await editImage({
          prompt,
          image: await resizeSourceImageForEdit(sourceImage),
          signal: controller.signal
        })
      : await generateImage({ prompt, signal: controller.signal });
    message.generatedImage = result.image;
    message.imageModel = result.model;
    message.imageStatus = "done";
    message.imageError = "";
    touchChat(chat);
    flushSaveChats();
    renderMessages();
    maybeAutoScroll();
    document.dispatchEvent(new CustomEvent("axon:chat-updated"));
    return true;
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.code === "aborted";
    message.imageStatus = "error";
    message.imageError = aborted ? "Generation stopped. Tap retry to try again." :
      (err?.message || "Image generation failed.");
    touchChat(chat);
    flushSaveChats();
    renderMessages();
    document.dispatchEvent(new CustomEvent("axon:chat-updated"));
    if (!aborted) toast(message.imageError, "error");
    return false;
  } finally {
    if (state.controller === controller) state.controller = null;
    state.streaming = false;
    document.dispatchEvent(new CustomEvent("axon:stream-state", {
      detail: { streaming: false }
    }));
    syncComposerButtons();
  }
}

async function regenerateImage(chat, message) {
  if (state.streaming || !message?.imagePrompt) return;

  if (message.imageEdit) {
    const source = chat.messages.find((m) => m.id === message.sourceImageId);
    if (!source?.generatedImage) {
      toast("Original image for this edit could not be found.", "error");
      return;
    }
    return runImageGeneration(chat, message, message.imagePrompt, source.generatedImage);
  }

  return runImageGeneration(chat, message, message.imagePrompt);
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
  if (chat.autoTitle && payload.text && chat.messages.filter((message) => message.role === "user").length === 1) {
    chat.title = titleFromText(payload.text, payload.images);
  }
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


/* ---------- FLUX image editing helpers ---------- */
function isImageEditRequest(text) {
  const value = String(text || "").toLowerCase().trim();
  if (!value || /^(how|what|why|can you explain|kaise|kya hota|is this|what is)/i.test(value)) return false;

  return /\b(edit|change|modify|remove|erase|replace|add|insert|put|make it|turn it|convert|transform|background|lighting|colour|color|sky|moon|sunset|sunrise|night|daytime|blur|sharpen|crop|redesign)\b|badal|badlo|jodo|hatao|lagao|kar do|bana do/i.test(value);
}

async function resizeSourceImageForEdit(dataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Could not open the source image for editing."));
    img.src = dataUrl;
  });

  const scale = Math.min(1, 511 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.floor(img.naturalHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image editing is not supported by this browser.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", 0.88);
}
