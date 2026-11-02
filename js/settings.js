/* =========================================================
   AXON AI — settings.js
   Settings, About, Help & Issues, theme/text-size wiring,
   connection test and data controls.
   ========================================================= */

import { store, persistSettings, persistProfile, DEFAULT_SETTINGS } from "./state.js";
import { APP_VERSION, MODELS, LANGUAGES, DEFAULT_WORKER_URL, modelInfo, BACKEND, SUPPORT_ENDPOINT } from "./config.js";
import { $, $$, toast, confirmDialog, downloadFile } from "./ui.js";
import { testConnection, workerUrl, currentModelLabel } from "./ai.js";
import { exportAllChats } from "./chat.js";
import { renderHistory, refreshAccountChip } from "./sidebar.js";
import { submitSupport, supportConfigured, backendConfigured, isSignedIn } from "./backend.js";
import { uid } from "./state.js";

/* ================= THEME ================= */

export function applyTheme() {
  const choice = store.settings.theme || "light";
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = choice === "dark" || (choice === "system" && prefersDark);
  document.body.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("dark-preload", dark);
  document.documentElement.dataset.theme = choice;

  const meta = $("#metaThemeColor");
  if (meta) meta.setAttribute("content", dark ? "#14121b" : "#ffffff");
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (apple) apple.setAttribute("content", dark ? "black-translucent" : "default");

  $$("[data-theme-choice]").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.themeChoice === choice));
  });
}

export function applyTextSize() {
  document.body.dataset.textSize = store.settings.textSize || "md";
  $$("[data-size-choice]").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.sizeChoice === (store.settings.textSize || "md")));
  });
}

/* ================= PAGES ================= */

const PAGES = ["#settingsPage", "#aboutPage", "#helpPage", "#accountPage", "#loginPage"];

export function closeAllPages() {
  PAGES.forEach((sel) => $(sel)?.classList.add("hidden"));
}

export function openPage(sel) {
  closeAllPages();
  const page = $(sel);
  if (!page) return;
  page.classList.remove("hidden");
  page.scrollTop = 0;
  const content = page.querySelector(".page-content");
  if (content) content.scrollTop = 0;
}

/* ================= SETTINGS UI ================= */

function paintSettings() {
  const lang = $("#languageSelect");
  if (lang) {
    lang.replaceChildren();
    LANGUAGES.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l;
      lang.appendChild(opt);
    });
    lang.value = store.settings.language || "English";
  }

  const style = $("#responseStyleSelect");
  if (style) style.value = store.settings.responseStyle || "balanced";

  const model = $("#modelSelect");
  if (model) {
    model.replaceChildren();
    MODELS.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.label} — ${m.description}`;
      model.appendChild(opt);
    });
    model.value = store.settings.model || "auto";
  }

  const enter = $("#enterToSendToggle");
  if (enter) enter.checked = store.settings.enterToSend !== false;

  const stream = $("#streamToggle");
  if (stream) stream.checked = store.settings.stream !== false;

  const speak = $("#speakRepliesToggle");
  if (speak) speak.checked = !!store.settings.speakReplies;

  const workerInput = $("#workerUrlInput");
  if (workerInput) workerInput.value = store.settings.workerUrl || "";

  const note = $("#settingsAccountNote");
  if (note) {
    note.textContent = isSignedIn()
      ? `Signed in as ${store.session.email} — chats sync to your account.`
      : backendConfigured()
        ? "Not signed in — chats are stored on this device only."
        : "Not signed in — chats are stored on this device only. Account sync is not connected on this build.";
  }

  const supportNote = $("#helpServiceNote");
  if (supportNote) {
    supportNote.textContent = supportConfigured()
      ? "Submissions are delivered to the AXON support endpoint."
      : "No support endpoint is connected on this build, so submissions are saved on this device with a tracking ID. Nothing is sent to a support team yet.";
  }

  const modelLabel = $("#connectionModel");
  if (modelLabel) modelLabel.textContent = currentModelLabel();
  const urlLabel = $("#connectionUrl");
  if (urlLabel) urlLabel.textContent = workerUrl("");

  applyTheme();
  applyTextSize();
}

function setStatus(ok, text) {
  const dot = $("#workerStatusDot");
  const label = $("#workerStatusText");
  if (dot) dot.className = `status-dot ${ok === null ? "" : ok ? "ok" : "bad"}`;
  if (label) label.textContent = text;
}

async function runConnectionTest() {
  setStatus(null, "Testing…");
  const dot = $("#workerStatusDot");
  if (dot) dot.className = "status-dot busy";
  const btn = $("#testConnectionBtn");
  if (btn) btn.disabled = true;

  const result = await testConnection();
  if (btn) btn.disabled = false;

  if (result.ok) {
    setStatus(true, `Connected · HTTP ${result.status} · ${result.ms} ms`);
    toast("AI connection is working", "ok");
  } else {
    setStatus(false, result.message || `Failed (HTTP ${result.status})`);
    toast(result.message || "Connection failed", "error");
  }
  return result;
}

/* ================= HELP & ISSUES ================= */

function renderReportHistory() {
  const box = $("#reportHistory");
  if (!box) return;
  box.replaceChildren();
  if (!store.outbox.length) {
    const empty = document.createElement("p");
    empty.style.cssText = "font-size:12.5px;color:var(--muted)";
    empty.textContent = "No submissions yet.";
    box.appendChild(empty);
    return;
  }
  [...store.outbox]
    .filter((i) => i.kind === "issue" || i.kind === "feedback")
    .reverse()
    .slice(0, 12)
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = "report-item";
      const head = document.createElement("div");
      head.className = "ri-head";
      const kind = document.createElement("span");
      kind.textContent = item.kind === "issue" ? "Issue" : "Feedback";
      const badge = document.createElement("span");
      badge.className = `report-badge ${item.delivered ? "sent" : "local"}`;
      badge.textContent = item.delivered ? "Delivered" : "Saved locally";
      head.appendChild(kind);
      head.appendChild(badge);
      const body = document.createElement("div");
      body.className = "ri-body";
      body.textContent = item.text;
      const meta = document.createElement("div");
      meta.style.cssText = "font-size:11px;color:var(--muted);margin-top:5px";
      meta.textContent = `${new Date(item.at).toLocaleString()} · ID ${item.requestId}`;
      row.appendChild(head);
      row.appendChild(body);
      row.appendChild(meta);
      box.appendChild(row);
    });
}

async function sendReport(kind) {
  const isIssue = kind === "issue";
  const input = isIssue ? $("#issueInput") : $("#feedbackInput");
  const status = isIssue ? $("#issueStatus") : $("#feedbackStatus");
  const btn = isIssue ? $("#issueSendBtn") : $("#feedbackSendBtn");
  const text = (input?.value || "").trim();

  const say = (msg, cls = "") => {
    if (!status) return;
    status.textContent = msg;
    status.className = `report-status${cls ? ` ${cls}` : ""}`;
  };

  if (text.length < 8) {
    say("Please add a little more detail (at least 8 characters).", "error");
    input?.focus();
    return;
  }

  if (btn) btn.disabled = true;
  say("Submitting…");

  const requestId = uid("req");
  try {
    const result = await submitSupport(kind, text, { request_id: requestId });
    if (result.delivered) {
      say(`Sent. Your reference is ${result.requestId}.`, "ok");
      toast("Submitted", "ok");
    } else {
      say(
        `Saved on this device with reference ${result.requestId}. No support endpoint is connected yet, so it has not been delivered.`,
        ""
      );
      toast("Saved locally — support endpoint not connected");
    }
    store.outbox.push({
      id: uid("ob"),
      kind,
      text,
      requestId: result.requestId,
      delivered: !!result.delivered,
      at: Date.now(),
      attempts: 1
    });
    const { persistOutbox } = await import("./state.js");
    persistOutbox();
    renderReportHistory();
    if (input) input.value = "";
    if (isIssue) $("#issueCount").textContent = "0 / 2000";
    else $("#feedbackCount").textContent = "0 / 2000";
  } catch (err) {
    say(err.message || "Could not submit. Please try again.", "error");
    toast("Submission failed", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ================= ABOUT ================= */

function paintAbout() {
  const model = $("#aboutModel");
  if (model) model.textContent = modelInfo(store.settings.model).label;
  const version = $("#aboutVersion");
  if (version) version.textContent = APP_VERSION;
  const backendEl = $("#aboutBackend");
  if (backendEl) {
    backendEl.textContent = backendConfigured() ? "Connected" : "Not connected (local mode)";
  }
  const supportEl = $("#aboutSupport");
  if (supportEl) supportEl.textContent = supportConfigured() ? "Connected" : "Not connected";
}

/* ================= INIT ================= */

export function initSettings() {
  paintSettings();

  $("#settingsBtn")?.addEventListener("click", () => {
    paintSettings();
    openPage("#settingsPage");
  });
  $("#aboutBtn")?.addEventListener("click", () => {
    paintAbout();
    openPage("#aboutPage");
  });
  $("#aboutFromSettings")?.addEventListener("click", () => {
    paintAbout();
    openPage("#aboutPage");
  });
  $("#helpBtn")?.addEventListener("click", () => {
    renderReportHistory();
    openPage("#helpPage");
  });
  $("#aboutHelpBtn")?.addEventListener("click", () => {
    renderReportHistory();
    openPage("#helpPage");
  });

  $$("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.closest(".full-page");
      if (!page) return;
      const from = page.id;
      page.classList.add("hidden");
      if (from === "settingsPage" || from === "aboutPage" || from === "helpPage") {
        document.dispatchEvent(new CustomEvent("axon:page-closed", { detail: { from } }));
      }
    });
  });

  /* language */
  $("#languageSelect")?.addEventListener("change", (e) => {
    store.settings.language = e.target.value;
    persistSettings();
    toast(`Reply language: ${e.target.value}`);
  });

  /* theme */
  $$("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.settings.theme = btn.dataset.themeChoice;
      persistSettings();
      applyTheme();
    });
  });

  /* text size */
  $$("[data-size-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      store.settings.textSize = btn.dataset.sizeChoice;
      persistSettings();
      applyTextSize();
    });
  });

  /* response style */
  $("#responseStyleSelect")?.addEventListener("change", (e) => {
    store.settings.responseStyle = e.target.value;
    persistSettings();
  });

  /* model */
  $("#modelSelect")?.addEventListener("change", (e) => {
    store.settings.model = e.target.value;
    persistSettings();
    paintSettings();
    document.dispatchEvent(new CustomEvent("axon:settings-changed"));
    toast(`Model: ${modelInfo(e.target.value).label}`);
  });

  /* toggles */
  $("#enterToSendToggle")?.addEventListener("change", (e) => {
    store.settings.enterToSend = e.target.checked;
    persistSettings();
  });
  $("#streamToggle")?.addEventListener("change", (e) => {
    store.settings.stream = e.target.checked;
    persistSettings();
  });
  $("#speakRepliesToggle")?.addEventListener("change", (e) => {
    store.settings.speakReplies = e.target.checked;
    persistSettings();
  });

  /* worker */
  $("#testConnectionBtn")?.addEventListener("click", runConnectionTest);
  $("#saveWorkerUrlBtn")?.addEventListener("click", () => {
    const value = ($("#workerUrlInput")?.value || "").trim();
    if (value && !/^https?:\/\//i.test(value)) {
      toast("Enter a full https:// URL", "error");
      return;
    }
    store.settings.workerUrl = value;
    persistSettings();
    paintSettings();
    setStatus(null, "Not checked yet");
    toast(value ? "Custom Worker URL saved" : `Using default Worker (${DEFAULT_WORKER_URL})`);
  });

  /* data */
  $("#exportAllBtn")?.addEventListener("click", exportAllChats);
  $("#deleteAllBtn")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete all conversations?",
      text: "Every conversation on this device will be permanently removed. Export first if you want a backup.",
      okLabel: "Delete all"
    });
    if (!ok) return;
    store.chats = [];
    const { persistChats } = await import("./state.js");
    persistChats();
    renderHistory();
    document.dispatchEvent(new CustomEvent("axon:all-chats-deleted"));
    toast("All conversations deleted");
  });

  /* reset */
  $("#resetSettingsBtn")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reset settings?",
      text: "Language, theme, text size and other preferences return to defaults. Chats are kept.",
      okLabel: "Reset"
    });
    if (!ok) return;
    store.settings = { ...DEFAULT_SETTINGS, workerUrl: store.settings.workerUrl };
    persistSettings();
    paintSettings();
    document.dispatchEvent(new CustomEvent("axon:settings-changed"));
    toast("Settings reset");
  });

  /* help & issues */
  ["#issueInput", "#feedbackInput"].forEach((sel) => {
    const input = $(sel);
    input?.addEventListener("input", () => {
      const count = sel === "#issueInput" ? $("#issueCount") : $("#feedbackCount");
      if (count) count.textContent = `${input.value.length} / 2000`;
    });
  });
  $("#issueSendBtn")?.addEventListener("click", () => sendReport("issue"));
  $("#feedbackSendBtn")?.addEventListener("click", () => sendReport("feedback"));

  document.addEventListener("axon:open-settings", () => {
    paintSettings();
    openPage("#settingsPage");
  });
  document.addEventListener("axon:close-pages", closeAllPages);
  document.addEventListener("axon:settings-changed", paintSettings);
  document.addEventListener("axon:open-help", () => {
    renderReportHistory();
    openPage("#helpPage");
  });
  document.addEventListener("axon:open-about", () => {
    paintAbout();
    openPage("#aboutPage");
  });

  /* system theme changes */
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (store.settings.theme === "system") applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  renderReportHistory();
  paintAbout();
}

export { paintSettings, runConnectionTest, renderReportHistory };
