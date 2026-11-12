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
await checkAsync("account avatar selection previews and saves both choices", async () => {
  const account = await mod("js/account.js");
  const original = state.store.profile.avatar;
  const profileKey = "axon_profile";
  const female = document.querySelector('[data-avatar="female"]');
  const male = document.querySelector('[data-avatar="male"]');

  state.store.profile.avatar = "male";
  state.persistProfile();
  account.paintAccount();
  female.click();
  if (!female.classList.contains("active")) throw new Error("female avatar was not selected");
  if (male.classList.contains("active")) throw new Error("male avatar remained selected");
  if (!document.querySelector("#accountAvatarImg").src.endsWith("female-avatar.webp")) {
    throw new Error("female avatar preview did not update");
  }

  document.querySelector("#saveProfileBtn").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (state.store.profile.avatar !== "female") throw new Error("female avatar was not saved to profile state");
  const savedFemale = JSON.parse(localStorage.getItem(profileKey) || "{}");
  if (savedFemale.avatar !== "female") throw new Error("female avatar was not persisted");

  male.click();
  if (!male.classList.contains("active")) throw new Error("male avatar could not be selected");
  document.querySelector("#saveProfileBtn").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  if (state.store.profile.avatar !== "male") throw new Error("male avatar could not be saved");

  state.store.profile.avatar = original === "female" ? "female" : "male";
  state.persistProfile();
  account.paintAccount();
});


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

await checkAsync("chat menu Rename, Share, and Delete options execute", async () => {
  const chat = state.createChat("Menu integration test");
  chat.messages.push({ id: "menu-test-message", role: "user", content: "Share test", time: Date.now(), images: [], rating: null, error: null });
  state.persistChats();
  sidebar.renderHistory();
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);

  sidebar.openChatMenu(chat, anchor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const rename = [...document.querySelectorAll("#actionMenu button")].find((b) => b.textContent.trim() === "Rename");
  if (!rename) throw new Error("Rename option missing");
  rename.click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const renameInput = document.querySelector("#confirmText input");
  if (!renameInput) throw new Error("Rename input did not open");
  renameInput.value = "Menu renamed";
  document.querySelector("#confirmOk").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (state.getChat(chat.id)?.title !== "Menu renamed") throw new Error("Rename did not save");

  sidebar.openChatMenu(state.getChat(chat.id), anchor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const share = [...document.querySelectorAll("#actionMenu button")].find((b) => b.textContent.trim() === "Share");
  if (!share) throw new Error("Share option missing");
  share.click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (!document.querySelector(".share-sheet")) throw new Error("Share sheet did not open");
  await new Promise((resolve) => setTimeout(resolve, 15));
  const shareMod = await mod("js/share.js");
  shareMod.closeShareSheet();

  sidebar.openChatMenu(state.getChat(chat.id), anchor);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const remove = [...document.querySelectorAll("#actionMenu button")].find((b) => b.textContent.trim() === "Delete");
  if (!remove) throw new Error("Delete option missing");
  remove.click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (document.querySelector("#confirmCard").classList.contains("hidden")) throw new Error("Delete confirmation did not open");
  document.querySelector("#confirmOk").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (state.getChat(chat.id)) throw new Error("Delete did not remove the conversation");
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
