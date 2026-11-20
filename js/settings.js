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
import { renderHistory, refreshAccountChip, closeSidebar } from "./sidebar.js";
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

export function closeAllPages() {
  document.querySelectorAll(".full-page").forEach((page) => page.classList.add("hidden"));
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

const PREFERENCE_OPTIONS = {
 };

function paintPreferencePicker(select) {
  if (!select) return;
  const id = select.id;
  const options = PREFERENCE_OPTIONS[id];
  if (!options) return;

  let picker = select.parentElement.querySelector(`.preference-picker[data-for="${id}"]`);
  if (!picker) {
    picker = document.createElement("div");
    picker.className = "preference-picker";
    picker.dataset.for = id;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "preference-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const chevron = document.createElement("span");
    chevron.className = "preference-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    trigger.appendChild(chevron);
    const menu = document.createElement("div");
    menu.className = "preference-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    picker.append(trigger, menu);
    select.insertAdjacentElement("afterend", picker);
    select.classList.add("preference-native-select");

    trigger.addEventListener("click", () => {
      const open = !picker.classList.contains("open");
      document.querySelectorAll(".preference-picker.open").forEach((item) => {
        item.classList.remove("open");
        item.querySelector(".preference-menu").hidden = true;
        item.querySelector(".preference-trigger").setAttribute("aria-expanded", "false");
      });
      picker.classList.toggle("open", open);
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    });

    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-value]");
      if (!option) return;
      select.value = option.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      picker.classList.remove("open");
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  const selected = options.find((option) => option.value === select.value) || options[0];
  const trigger = picker.querySelector(".preference-trigger");
  const menu = picker.querySelector(".preference-menu");
  trigger.replaceChildren();
  const label = document.createElement("span");
  label.className = "preference-trigger-label";
  label.textContent = selected.label;
  const chevron = document.createElement("span");
  chevron.className = "preference-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  trigger.append(label, chevron);

  menu.replaceChildren();
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preference-option";
    button.dataset.value = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === select.value));
    const copy = document.createElement("span");
    copy.className = "preference-option-copy";
    const name = document.createElement("span");
    name.className = "preference-option-label";
    name.textContent = option.label;
    copy.appendChild(name);
    if (option.description) {
      const description = document.createElement("span");
      description.className = "preference-option-description";
      description.textContent = option.description;
      copy.appendChild(description);
    }
    const check = document.createElement("span");
    check.className = "preference-option-check";
    check.textContent = option.value === select.value ? "✓" : "";
    button.append(copy, check);
    menu.appendChild(button);
  });
}


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
    lang.classList.add("preference-native-select");
    let languageOptions = $("#languageOptions");
    if (!languageOptions) {
      languageOptions = document.createElement("div");
      languageOptions.id = "languageOptions";
      languageOptions.className = "language-options";
      languageOptions.setAttribute("role", "radiogroup");
      languageOptions.setAttribute("aria-label", "Choose reply language");
      lang.insertAdjacentElement("afterend", languageOptions);
    }
    languageOptions.replaceChildren();
    LANGUAGES.forEach((language) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-option";
      button.classList.toggle("selected", language === lang.value);
      button.dataset.language = language;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(language === lang.value));
      const label = document.createElement("span");
      label.className = "language-option-label";
      label.textContent = language;
      const indicator = document.createElement("span");
      indicator.className = "language-option-indicator";
      indicator.setAttribute("aria-hidden", "true");
      button.append(label, indicator);
      languageOptions.appendChild(button);
    });
  }

  const style = $("#responseStyleSelect");
  if (style) {
    style.value = store.settings.responseStyle || "balanced";
    style.classList.add("preference-native-select");
    let styleOptions = $("#responseStyleOptions");
    if (!styleOptions) {
      styleOptions = document.createElement("div");
      styleOptions.id = "responseStyleOptions";
      styleOptions.className = "response-style-options";
      styleOptions.setAttribute("role", "radiogroup");
      styleOptions.setAttribute("aria-label", "Choose AI response preference");
      style.insertAdjacentElement("afterend", styleOptions);
    }
    styleOptions.replaceChildren();
    const choices = [
      { value: "concise", label: "Concise", description: "Short and direct answers" },
      { value: "balanced", label: "Balanced", description: "Clear detail with useful context" },
      { value: "detailed", label: "Detailed", description: "In-depth explanations and examples" }
    ];
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "response-style-option";
      button.classList.toggle("selected", choice.value === style.value);
      button.dataset.responseStyle = choice.value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(choice.value === style.value));
      const copy = document.createElement("span");
      copy.className = "response-style-copy";
      const label = document.createElement("span");
      label.className = "response-style-label";
      label.textContent = choice.label;
      const description = document.createElement("span");
      description.className = "response-style-description";
      description.textContent = choice.description;
      copy.append(label, description);
      const indicator = document.createElement("span");
      indicator.className = "language-option-indicator";
      indicator.setAttribute("aria-hidden", "true");
      button.append(copy, indicator);
      styleOptions.appendChild(button);
    });
  }

  const model = $("#modelSelect");
  const modelOptions = $("#modelOptions");
  if (model && modelOptions) {
    model.replaceChildren();
    modelOptions.replaceChildren();
    MODELS.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      model.appendChild(opt);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-option";
      button.dataset.modelId = m.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");

      const copy = document.createElement("span");
      copy.className = "model-option-copy";
      const label = document.createElement("span");
      label.className = "model-option-label";
      label.textContent = m.label;
      const description = document.createElement("span");
      description.className = "model-option-description";
      description.textContent = m.description;
      copy.append(label, description);

      const check = document.createElement("span");
      check.className = "model-option-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      button.append(copy, check);
      modelOptions.appendChild(button);
    });
    model.value = store.settings.model || "auto";
    modelOptions.querySelectorAll("[data-model-id]").forEach((button) => {
      const selected = button.dataset.modelId === model.value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
  }

  const enter = $("#enterToSendToggle");
  if (enter) enter.checked = store.settings.enterToSend !== false;

  const stream = $("#streamToggle");
  if (stream) stream.checked = store.settings.stream !== false;

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

  const chatCount = Array.isArray(store.chats) ? store.chats.length : 0;
  const messageCount = Array.isArray(store.chats)
    ? store.chats.reduce((total, chat) => total + (Array.isArray(chat.messages) ? chat.messages.length : 0), 0)
    : 0;
  const usageSummary = $("#settingsUsageSummary");
  if (usageSummary) usageSummary.textContent = `${chatCount} conversation(s) · ${messageCount} message(s) stored on this device.`;
  const storageSummary = $("#settingsStorageSummary");
  if (storageSummary) {
    let bytes = 0;
    try { bytes = new Blob([JSON.stringify(store.chats || [])]).size; } catch (e) {}
    const size = bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    storageSummary.textContent = `${chatCount} conversation(s) · approximately ${size} of local chat data. Chats remain on this device unless account sync is configured.`;
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


/* ================= SETTINGS DIRECTORY ================= */

function openSettingsCategory(category) {
  const home = $("#settingsHome");
  const detail = $("#settingsDetail");
  const title = $("#settingsDetailTitle");
  const empty = $("#settingsEmpty");
  const groups = $$("#settingsDetailContent .setting-group");
  let found = false;

  groups.forEach((group) => {
    const categories = (group.dataset.settingsCategory || "").split("|");
    const visible = categories.includes(category);
    group.classList.toggle("hidden", !visible);
    if (visible) found = true;
  });

  if (title) title.textContent = category;
  if (empty) empty.classList.toggle("hidden", found);
  home?.classList.add("hidden");
  detail?.classList.remove("hidden");
  if (detail) detail.scrollTop = 0;
}

function returnToSettingsHome() {
  $("#settingsDetail")?.classList.add("hidden");
  $("#settingsHome")?.classList.remove("hidden");
  $("#settingsSearch")?.focus();
}

function filterSettingsDirectory() {
  const input = $("#settingsSearch");
  const query = (input?.value || "").trim().toLowerCase();
  const rows = $$("#settingsCategoryList [data-settings-category]");
  let visibleCount = 0;

  rows.forEach((row) => {
    const category = row.dataset.settingsCategory || "";
    const groups = $$("#settingsDetailContent .setting-group").filter((group) =>
      (group.dataset.settingsCategory || "").split("|").includes(category)
    );
    const matchesCategory = category.toLowerCase().includes(query);
    const matchesSetting = groups.some((group) => group.textContent.toLowerCase().includes(query));
    const visible = !query || matchesCategory || matchesSetting;
    row.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });

  $("#settingsNoResults")?.classList.toggle("hidden", visibleCount > 0);
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

  $$("#settingsCategoryList [data-settings-category]").forEach((row) => {
    row.addEventListener("click", () => {
      const category = row.dataset.settingsCategory;
      if (category === "About AXON") {
        paintAbout();
        openPage("#aboutPage");
        return;
      }
      if (category === "Help & issues") {
        renderReportHistory();
        openPage("#helpPage");
        return;
      }
      openSettingsCategory(category);
    });
  });
  $("#settingsSearch")?.addEventListener("input", filterSettingsDirectory);
  $("#settingsDetailBack")?.addEventListener("click", returnToSettingsHome);
  $("#settingsOpenVoiceBtn")?.addEventListener("click", () => $("#voiceBtn")?.click());
  $("#settingsTestServiceBtn")?.addEventListener("click", runConnectionTest);


  $("#settingsBtn")?.addEventListener("click", () => {
    closeSidebar();
    paintSettings();
    $("#settingsHome")?.classList.remove("hidden");
    $("#settingsDetail")?.classList.add("hidden");
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

  /* language radio cards */
  $("#languageOptions")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-language]");
    const select = $("#languageSelect");
    if (!option || !select) return;
    select.value = option.dataset.language;
    store.settings.language = select.value;
    $("#languageOptions").querySelectorAll("[data-language]").forEach((button) => {
      const selected = button.dataset.language === select.value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    persistSettings();
    toast("Reply language: " + select.value);
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

  /* response style radio cards */
  $("#responseStyleOptions")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-response-style]");
    const select = $("#responseStyleSelect");
    if (!option || !select) return;
    select.value = option.dataset.responseStyle;
    store.settings.responseStyle = select.value;
    $("#responseStyleOptions").querySelectorAll("[data-response-style]").forEach((button) => {
      const selected = button.dataset.responseStyle === select.value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    persistSettings();
  });

  /* Custom model cards */
  $("#modelOptions")?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-model-id]");
    const model = $("#modelSelect");
    if (!option || !model) return;
    model.value = option.dataset.modelId;
    model.dispatchEvent(new Event("change", { bubbles: true }));
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
