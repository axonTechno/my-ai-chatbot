/* UI flow tests: boot the real app, open every page, exercise settings. */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost:5173/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = () => {};
window.navigator.vibrate = () => true;
window.document.execCommand = () => true;

global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.DOMException = window.DOMException;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
Object.defineProperty(global, "location", { value: window.location, configurable: true });
global.history = window.history;

const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};
const mod = (p) => import("file://" + path.join(root, p));

/* ---------- boot the real app ---------- */
const main = await mod("js/main.js");

const visible = (sel) => {
  const el = document.querySelector(sel);
  return !!el && !el.classList.contains("hidden");
};

check("app boots without throwing", () => {
  if (errors.length) throw new Error(errors.join("; "));
  if (!document.querySelector("#messages")) throw new Error("chat area missing");
});

check("welcome screen visible on a fresh chat", () => {
  if (!visible("#welcomeScreen")) throw new Error("welcome not shown");
});

/* ---------- pages ---------- */
const settings = await mod("js/settings.js");

check("settings page opens and closes", () => {
  document.querySelector("#settingsBtn").click();
  if (!visible("#settingsPage")) throw new Error("settings did not open");
  settings.closeAllPages();
  if (visible("#settingsPage")) throw new Error("settings did not close");
});

check("about page opens", () => {
  document.querySelector("#aboutBtn").click();
  if (!visible("#aboutPage")) throw new Error("about did not open");
  settings.closeAllPages();
});

check("help page opens from settings", () => {
  document.querySelector("#helpBtn").click();
  if (!visible("#helpPage")) throw new Error("help did not open");
  settings.closeAllPages();
});

check("account page opens", () => {
  document.querySelector("#accountBtn").click();
  if (!visible("#accountPage")) throw new Error("account did not open");
  settings.closeAllPages();
});

/* ---------- settings persistence ---------- */
const state = await mod("js/state.js");

check("theme change persists and applies", () => {
  const before = state.store.settings.theme;
  state.store.settings.theme = "dark";
  state.persistSettings();
  settings.applyTheme();
  if (!document.body.classList.contains("dark")) throw new Error("dark class missing on body");
  state.store.settings.theme = "light";
  state.persistSettings();
  settings.applyTheme();
  if (document.body.classList.contains("dark")) throw new Error("dark class still set in light mode");
  state.store.settings.theme = before;
  state.persistSettings();
  settings.applyTheme();
});

check("text size change persists", () => {
  const before = state.store.settings.textSize;
  state.store.settings.textSize = "lg";
  state.persistSettings();
  settings.applyTextSize();
  if (document.body.dataset.textSize !== "lg") throw new Error("text size not applied: " + document.body.dataset.textSize);
  state.store.settings.textSize = before;
  state.persistSettings();
  settings.applyTextSize();
});

check("model selection survives a reload", () => {
  const models = state.store.settings.model;
  state.store.settings.model = "auto";
  state.persistSettings();
  state.loadAll();
  if (state.store.settings.model !== "auto") throw new Error("model not persisted: " + state.store.settings.model);
  state.store.settings.model = models;
  state.persistSettings();
});

/* ---------- sidebar ---------- */
const sidebar = await mod("js/sidebar.js");

check("sidebar opens and closes", () => {
  sidebar.openSidebar();
  if (!sidebar.isSidebarOpen()) throw new Error("did not open");
  sidebar.closeSidebar();
  if (sidebar.isSidebarOpen()) throw new Error("did not close");
});

check("search filters history", () => {
  const chat = state.createChat("Quantum physics notes");
  chat.messages.push({ id: "m1", role: "user", content: "quantum", time: Date.now(), images: [], rating: null, error: null });
  state.persistChats();
  sidebar.renderHistory();
  sidebar.setSearch("quantum");
  const items = document.querySelectorAll("#historyList .history-item");
  if (items.length === 0) throw new Error("search returned nothing");
  sidebar.setSearch("");
  state.deleteChat(chat.id);
});

/* ---------- action menu interaction regression ---------- */
const ui = await mod("js/ui.js");

await checkAsync("action menu works without blocking underlying inputs", async () => {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  let chosen = false;
  ui.openMenu([{ label: "Run menu action", onClick: () => { chosen = true; } }], anchor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (visible("#sheetOverlay")) throw new Error("action menu activated the blocking overlay");
  if (!visible("#actionMenu")) throw new Error("action menu did not open");
  document.querySelector("#actionMenu button").click();
  if (!chosen) throw new Error("menu item action did not execute");

  ui.openMenu([{ label: "Outside tap test", onClick: () => {} }], anchor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const input = document.querySelector("#messageInput");
  let inputReceivedTap = false;
  input.addEventListener("pointerdown", () => { inputReceivedTap = true; }, { once: true });
  input.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  if (visible("#actionMenu")) throw new Error("outside tap did not close the menu");
  if (!inputReceivedTap) throw new Error("underlying input did not receive the tap");
  anchor.remove();
});

/* ---------- composer ---------- */
const chatMod = await mod("js/chat.js");

check("composer grows with text", () => {
  const ta = document.querySelector("#messageInput");
  if (!ta) throw new Error("composer missing");
  ta.value = "line\n".repeat(6);
  chatMod.autoGrow(ta);
  if (!ta.style.height) throw new Error("height not set");
});

check("send button state follows input", () => {
  const ta = document.querySelector("#messageInput");
  const btn = document.querySelector("#sendBtn");
  ta.value = "hello";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  if (btn.disabled) throw new Error("send still disabled with text");
  ta.value = "";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
});

check("no runtime errors during flows", () => {
  if (errors.length) throw new Error(errors.join("; "));
});

const failed = results.filter((r) => r[0] === "FAIL");
results.forEach((r) => console.log(r[0] === "PASS" ? `✓ ${r[1]}` : `✗ ${r[1]} — ${r[2]}`));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
