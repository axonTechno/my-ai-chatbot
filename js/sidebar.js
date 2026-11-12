/* =========================================================
   AXON AI — sidebar.js
   Sidebar, conversation history (Pinned / Recent), search,
   per-chat menus, chat top-bar menu, About entry point.
   ========================================================= */

import { store, sortedChats, getChat, deleteChat, togglePin, renameChat, duplicateChat, createChat } from "./state.js";
import { $, $$, toast, openMenu, confirmDialog, promptDialog, haptic, formatDay } from "./ui.js";
import { setActiveChat, activeChat, exportChat, exportChatJSON, shareChat, getState } from "./chat.js";
import { queueOutbox, isSignedIn } from "./backend.js";

let searchTerm = "";

export function isSidebarOpen() {
  return $("#sidebar")?.classList.contains("open");
}

export function openSidebar() {
  $("#sidebar")?.classList.add("open");
  $("#sidebarOverlay")?.classList.remove("hidden");
  $("#menuBtn")?.setAttribute("aria-expanded", "true");
  // Add scroll lock to body to prevent background scrolling on mobile
  document.body.style.overflow = "hidden";
}

export function closeSidebar() {
  $("#sidebar")?.classList.remove("open");
  $("#sidebarOverlay")?.classList.add("hidden");
  $("#menuBtn")?.setAttribute("aria-expanded", "false");
  // Restore body scroll
  document.body.style.overflow = "";
}

export function toggleSidebar() {
  if (isSidebarOpen()) closeSidebar();
  else openSidebar();
}

function highlight(title, term) {
  if (!term) return document.createTextNode(title);
  const frag = document.createDocumentFragment();
  const lower = title.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  if (idx === -1) {
    frag.appendChild(document.createTextNode(title));
    return frag;
  }
  frag.appendChild(document.createTextNode(title.slice(0, idx)));
  const mark = document.createElement("mark");
  mark.textContent = title.slice(idx, idx + term.length);
  frag.appendChild(mark);
  frag.appendChild(document.createTextNode(title.slice(idx + term.length)));
  return frag;
}

function chatMatches(chat, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  if (chat.title.toLowerCase().includes(t)) return true;
  return chat.messages.some((m) => (m.content || "").toLowerCase().includes(t));
}

function historyItem(chat) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "history-item";
  item.dataset.id = chat.id;
  if (chat.id === getState().activeChatId) item.classList.add("active");

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "hi-icon");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", chat.pinned ? "#i-pin" : "#i-message");
  icon.appendChild(use);
  item.appendChild(icon);

  const title = document.createElement("span");
  title.className = "hi-title";
  title.appendChild(highlight(chat.title, searchTerm));
  item.appendChild(title);

  const more = document.createElement("span");
  more.className = "hi-more";
  more.setAttribute("role", "button");
  more.setAttribute("aria-label", "Chat options");
  more.tabIndex = 0;
  const moreIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  moreIcon.setAttribute("aria-hidden", "true");
  const moreUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
  moreUse.setAttribute("href", "#i-more");
  moreIcon.appendChild(moreUse);
  more.appendChild(moreIcon);
  item.appendChild(more);

  let pressTimer = null;
  let longPressed = false;

  const startPress = () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      haptic(14);
      openChatMenu(chat, item);
    }, 480);
  };
  const endPress = () => clearTimeout(pressTimer);

  item.addEventListener("pointerdown", startPress);
  item.addEventListener("pointerup", endPress);
  item.addEventListener("pointerleave", endPress);
  item.addEventListener("pointercancel", endPress);
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openChatMenu(chat, item);
  });

  item.addEventListener("click", (e) => {
    if (longPressed) {
      e.preventDefault();
      return;
    }
    if (more.contains(e.target)) {
      openChatMenu(chat, more);
      return;
    }
    setActiveChat(chat.id);
    closeSidebar();
  });

  more.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openChatMenu(chat, more);
    }
  });

  return item;
}

export function openChatMenu(chat, anchor) {
  openMenu(
    [
      {
        label: chat.pinned ? "Unpin chat" : "Pin chat",
        icon: "i-pin",
        onClick: () => {
          const pinned = togglePin(chat.id);
          toast(pinned ? "Pinned to top" : "Unpinned");
          renderHistory();
        }
      },
      { label: "Rename", icon: "i-edit", onClick: () => renameChatFlow(chat) },
      { label: "Share", icon: "i-share", onClick: () => shareChat(chat) },
      { label: "Duplicate", icon: "i-duplicate", onClick: () => duplicateChatFlow(chat) },
      { label: "Export as Markdown", icon: "i-download", onClick: () => exportChat(chat) },
      { label: "Export as JSON", icon: "i-download", onClick: () => exportChatJSON(chat) },
      { separator: true },
      { label: "Delete", icon: "i-trash", danger: true, onClick: () => deleteChatFlow(chat) }
    ],
    anchor
  );
}

export async function renameChatFlow(chat) {
  const value = await promptDialog({
    title: "Rename conversation",
    value: chat.title,
    okLabel: "Save",
    placeholder: "Conversation name"
  });
  if (value == null) return;
  renameChat(chat.id, value);
  renderHistory();
  document.dispatchEvent(new CustomEvent("axon:chat-updated"));
  toast("Renamed");
}

function duplicateChatFlow(chat) {
  const copy = duplicateChat(chat.id);
  if (!copy) return;
  renderHistory();
  setActiveChat(copy.id);
  toast("Conversation duplicated");
}

export async function deleteChatFlow(chat) {
  const ok = await confirmDialog({
    title: "Delete conversation?",
    text: `“${chat.title}” will be permanently deleted from this device. This cannot be undone.`,
    okLabel: "Delete"
  });
  if (!ok) return;
  deleteChat(chat.id);
  if (isSignedIn()) queueOutbox({ kind: "delete", chatId: chat.id });
  renderHistory();
  if (getState().activeChatId === chat.id) {
    const next = sortedChats()[0];
    if (next) setActiveChat(next.id);
    else {
      const fresh = createChat();
      setActiveChat(fresh.id);
    }
  }
  toast("Conversation deleted");
}

function section(label, iconId, chats, container) {
  if (!chats.length) return;
  const head = document.createElement("div");
  head.className = "section-label";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${iconId}`);
  svg.appendChild(use);
  head.appendChild(svg);
  head.appendChild(document.createTextNode(label));
  container.appendChild(head);

  const list = document.createElement("div");
  list.className = "history-list";
  chats.forEach((c) => list.appendChild(historyItem(c)));
  container.appendChild(list);
}

export function renderHistory() {
  const container = $("#historyList");
  const empty = $("#historyEmpty");
  if (!container) return;

  const term = searchTerm.trim();
  const all = sortedChats().filter((c) => chatMatches(c, term));
  container.replaceChildren();

  if (!all.length) {
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = term ? "No conversations match your search." : "No conversations yet.";
    }
    return;
  }
  if (empty) empty.classList.add("hidden");

  if (term) {
    section(`Results (${all.length})`, "i-search", all, container);
    return;
  }

  const pinned = all.filter((c) => c.pinned);
  const recent = all.filter((c) => !c.pinned);

  section("Pinned", "i-pin", pinned, container);

  /* group recent chats by day bucket */
  const groups = new Map();
  recent.forEach((c) => {
    const key = formatDay(c.updatedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  groups.forEach((chats, label) => {
    section(label, "i-message", chats, container);
  });
}

export function setSearch(term) {
  searchTerm = term;
  const clear = $("#clearSearch");
  if (clear) clear.classList.toggle("hidden", !term);
  renderHistory();
}

export function refreshAccountChip() {
  const name = $("#sidebarName");
  const email = $("#sidebarEmail");
  const avatar = $("#sidebarAvatar");
  if (name) name.textContent = store.profile.name || "Guest";
  if (email) {
    email.textContent = store.profile.email
      ? store.profile.email
      : isSignedIn()
        ? "Signed in"
        : "Local mode";
  }
  if (avatar) {
    avatar.src = store.profile.avatar === "female" ? "./assets/female-avatar.webp" : "./assets/male-avatar.webp";
  }
}

export function initSidebar() {
  $("#menuBtn")?.addEventListener("click", toggleSidebar);
  $("#closeSidebar")?.addEventListener("click", closeSidebar);

  $("#newChatBtn")?.addEventListener("click", () => {
    const chat = createChat();
    setActiveChat(chat.id);
    closeSidebar();
    $("#messageInput")?.focus();
  });

  $("#chatSearch")?.addEventListener("input", (e) => setSearch(e.target.value));
  $("#clearSearch")?.addEventListener("click", () => {
    const input = $("#chatSearch");
    if (input) input.value = "";
    setSearch("");
    input?.focus();
  });

  $("#chatMenuBtn")?.addEventListener("click", (e) => {
    const chat = activeChat();
    if (!chat || !chat.messages.length) {
      toast("Start a conversation first");
      return;
    }
    openChatMenu(chat, e.currentTarget);
  });

  document.addEventListener("axon:chat-updated", () => {
    renderHistory();
    updateTopbarTitle();
  });
  document.addEventListener("axon:chat-changed", () => {
    renderHistory();
    updateTopbarTitle();
  });

  renderHistory();
  refreshAccountChip();
  updateTopbarTitle();
}

export function updateTopbarTitle() {
  const chat = activeChat();
  const title = $("#topbarTitle");
  if (title) title.textContent = chat && chat.messages.length ? chat.title : "AXON";
}