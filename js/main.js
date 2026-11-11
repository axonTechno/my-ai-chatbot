/* =========================================================
   AXON AI — main.js
   Bootstrap: load state, wire the composer, sidebar, pages,
   voice, PWA and global keyboard shortcuts.
   ========================================================= */

import { loadAll, store, persistChats, flushSaveChats, createChat, sortedChats } from "./state.js";
import { $, $$, toast, copyText, closeMenu, closeImageViewer } from "./ui.js";
import {
  initChatComposer,
  renderMessages,
  setActiveChat,
  activeChat,
  getState,
  scrollToBottom,
  cancelEdit,
  flushOfflineQueue
} from "./chat.js";
import { initSidebar, renderHistory, refreshAccountChip, closeSidebar, updateTopbarTitle } from "./sidebar.js";
import { initSettings, applyTheme, applyTextSize, closeAllPages } from "./settings.js";
import { initAccount, openAccountPage } from "./account.js";
import { initAuth, openAuthPage } from "./auth.js";
import { initVoice } from "./voice.js";
import { initPWA, initNetworkWatcher } from "./pwa.js";
import { flushOutbox, isSignedIn, backendConfigured } from "./backend.js";
import { currentModelLabel } from "./ai.js";
import { closeShareSheet } from "./share.js";

function boot() {
  loadAll();

  /* Keep the app fitted to Android visible viewport */
  const viewport = window.visualViewport;
  if (viewport) {
    const updateKeyboardLayout = () => {
      const height = Math.round(viewport.height);
      document.documentElement.style.setProperty("--axon-viewport-height", `${height}px`);
      document.querySelector(".app")?.style.setProperty("height", `${height}px`);
    };
    viewport.addEventListener("resize", updateKeyboardLayout);
    viewport.addEventListener("scroll", updateKeyboardLayout);
    window.addEventListener("orientationchange", updateKeyboardLayout);
    updateKeyboardLayout();
  }

  applyTheme();
  applyTextSize();

  initSidebar();
  initSettings();
  initAccount();
  initAuth();
  initVoice();
  initChatComposer();
  initPWA();
  initNetworkWatcher();

  /* send anything typed while offline as soon as the network returns */
  document.addEventListener("axon:online", () => {
    flushOfflineQueue().catch(() => {});
    if (isSignedIn()) flushOutbox().catch(() => {});
  });

  /* pick the most recent conversation (or start a fresh one) */
  const wantsNew = new URLSearchParams(location.search).get("new") === "1";
  const chats = sortedChats();
  if (wantsNew) {
    const chat = createChat();
    setActiveChat(chat.id);
    history.replaceState(null, "", location.pathname);
  } else if (chats.length) setActiveChat(chats[0].id);
  else {
    const chat = createChat();
    setActiveChat(chat.id);
  }

  renderHistory();
  refreshAccountChip();
  updateTopbarTitle();
  renderMessages();

  /* global chrome */
  $("#viewerClose")?.addEventListener("click", closeImageViewer);
  $("#imageViewer")?.addEventListener("click", (e) => {
    if (e.target.id === "imageViewer") closeImageViewer();
  });

  /* the model tag in the top bar opens the model picker */
  $("#modelTag")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("axon:open-settings"));
    setTimeout(() => $("#modelSelect")?.focus(), 260);
  });

  /* keep the top-bar tag in sync with the selected model */
  const paintModelTag = () => {
    const tag = $("#modelTag");
    if (tag) tag.textContent = currentModelLabel();
  };
  paintModelTag();
  document.addEventListener("axon:settings-changed", paintModelTag);

  $("#scrollBottomBtn")?.addEventListener("click", () => scrollToBottom(true));

  const scroller = $("#chatArea");
  scroller?.addEventListener("scroll", () => {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    getState().autoScroll = nearBottom;
    $("#scrollBottomBtn")?.classList.toggle("hidden", nearBottom);
  }, { passive: true });

  /* welcome suggestions */
  $$(".suggestion[data-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $("#messageInput");
      if (!input) return;
      input.value = btn.dataset.prompt || "";
      input.focus();
      input.dispatchEvent(new Event("input"));
    });
  });

  /* first launch: offer the account screen (skippable, never blocking) */
  const seen = localStorage.getItem("axon_seen_welcome");
  if (!seen) {
    try {
      localStorage.setItem("axon_seen_welcome", "1");
    } catch (e) {}
    if (!store.profile.email && backendConfigured()) {
      setTimeout(() => openAuthPage(), 700);
    }
  }

  /* keyboard shortcuts */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closeImageViewer();
      closeShareSheet();
      if (getState().editingId) cancelEdit();
      const openPage = $$(".full-page").find((p) => !p.classList.contains("hidden"));
      if (openPage && openPage.id !== "loginPage") openPage.classList.add("hidden");
      closeSidebar();
      const confirm = $("#confirmCard");
      if (confirm && !confirm.classList.contains("hidden")) $("#confirmCancel")?.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#chatSearch")?.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      const chat = createChat();
      setActiveChat(chat.id);
    }
  });

  /* persist before the tab goes away */
  window.addEventListener("pagehide", () => flushSaveChats());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSaveChats();
  });

  /* background sync when the app regains focus */
  window.addEventListener("focus", () => {
    if (isSignedIn()) flushOutbox().catch(() => {});
    flushOfflineQueue().catch(() => {});
  });

  document.addEventListener("axon:all-chats-deleted", () => {
    const chat = createChat();
    setActiveChat(chat.id);
    renderHistory();
  });

  document.addEventListener("axon:page-closed", () => {
    renderHistory();
    updateTopbarTitle();
  });

  document.addEventListener("axon:open-account", openAccountPage);

  /* copy buttons inside rendered code blocks */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy-code]");
    if (!btn) return;
    const block = btn.closest(".code-block");
    if (!block) return;
    const ok = await copyText(block.dataset.raw || "");
    const label = btn.querySelector("span");
    if (label) {
      const original = label.textContent;
      label.textContent = ok ? "Copied" : "Failed";
      setTimeout(() => {
        label.textContent = original;
      }, 1400);
    }
  });

  document.documentElement.classList.remove("dark-preload");
  document.body.classList.add("ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

