/* Feature tests: share sheet, sync layer, model fallback, images. */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost:5173/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

window.matchMedia = ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
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

const state = await mod("js/state.js");
const share = await mod("js/share.js");
const ai = await mod("js/ai.js");

state.loadAll();

/* ---------- share sheet ---------- */

check("share sheet renders with copy + download", () => {
  share.shareMessageSheet({ role: "assistant", content: "Hello world answer" });
  const sheet = window.document.querySelector(".share-sheet");
  if (!sheet) throw new Error("sheet not created");
  const labels = [...sheet.querySelectorAll(".share-actions button")].map((b) => b.textContent);
  if (!labels.some((l) => /Copy/i.test(l))) throw new Error("no copy: " + labels.join("|"));
  if (!labels.some((l) => /Download/i.test(l))) throw new Error("no download: " + labels.join("|"));
  share.closeShareSheet();
  if (window.document.querySelector(".share-sheet")) throw new Error("sheet not closed");
});

check("share sheet refuses an empty message", () => {
  share.shareMessageSheet({ role: "assistant", content: "   " });
  if (window.document.querySelector(".share-sheet")) throw new Error("opened for empty content");
});

/* ---------- model fallback ---------- */

await checkAsync("falls back to the next free model when the first fails", async () => {
  const tried = [];
  const primary = "meta-llama/llama-3.3-70b-instruct:free";
  window.fetch = global.fetch = async (url, opts = {}) => {
    const body = JSON.parse(opts.body);
    const model = body.model || "auto";
    tried.push(model);
    /* the primary model is down; any other free model answers */
    if (model === primary) {
      return new Response(JSON.stringify({ error: "model unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ response: "fallback answer", model }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  state.store.settings.model = primary;
  const res = await ai.sendChat({ message: "hi", history: [] });
  if (res.text !== "fallback answer") throw new Error("text: " + res.text);
  if (tried.length < 2) throw new Error("no retry happened");
  /* retries of the primary model come first, then a DIFFERENT free model */
  const distinct = [...new Set(tried)];
  if (distinct.length < 2) throw new Error("never switched model: " + tried.join(" -> "));
  if (distinct[0] !== "meta-llama/llama-3.3-70b-instruct:free") throw new Error("wrong primary: " + distinct[0]);
});
await checkAsync("reports a real error when every model fails", async () => {
  window.fetch = global.fetch = async () =>
    new Response(JSON.stringify({ error: "all down" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  let err = null;
  try {
    await ai.sendChat({ message: "hi", history: [] });
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error("no error thrown");
  if (!(err instanceof ai.AIError)) throw new Error("wrong error type");
});

await checkAsync("non-streaming JSON answer is accepted", async () => {
  window.fetch = global.fetch = async () =>
    new Response(JSON.stringify({ response: "plain answer" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  const res = await ai.sendChat({ message: "hi", history: [] });
  if (res.text !== "plain answer") throw new Error(res.text);
});

await checkAsync("empty answer is reported, not silently accepted", async () => {
  window.fetch = global.fetch = async () =>
    new Response(JSON.stringify({ response: "" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  let err = null;
  try {
    await ai.sendChat({ message: "hi", history: [] });
  } catch (e) {
    err = e;
  }
  if (!err || err.code !== "empty") throw new Error(err ? err.code : "no error");
});

/* ---------- history building ---------- */

check("history drops empty placeholders and error turns", () => {
  const h = ai.buildHistory([
    { role: "user", content: "question" },
    { role: "assistant", content: "" },
    { role: "assistant", content: "failed", error: { title: "x" } },
    { role: "assistant", content: "good answer" }
  ]);
  if (h.length !== 2) throw new Error("length " + h.length);
  if (h.some((m) => !m.content)) throw new Error("empty entry kept");
});

/* ---------- sync layer (no backend configured) ---------- */

const backend = await mod("js/backend.js");

check("sync reports not_configured instead of faking success", () => {
  if (backend.backendConfigured()) throw new Error("backend unexpectedly configured");
  if (backend.isSignedIn()) throw new Error("signed in without a session");
});

await checkAsync("email sign-in fails honestly without a backend", async () => {
  let err = null;
  try {
    await backend.requestEmailCode("a@b.com");
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error("no error");
  if (err.code !== "not_configured") throw new Error("code: " + err.code);
});

await checkAsync("support submission is saved locally, not claimed as sent", async () => {
  const res = await backend.submitSupport("issue", "Something is broken here");
  if (res.delivered !== false) throw new Error("claimed delivery");
  if (!res.requestId) throw new Error("no reference id");
  if (res.reason !== "not_configured") throw new Error(res.reason);
});

check("outbox queues and caps entries", () => {
  state.store.outbox = [];
  for (let i = 0; i < 210; i++) backend.queueOutbox({ kind: "chat", chatId: "c" + i });
  if (state.store.outbox.length > 200) throw new Error("outbox unbounded: " + state.store.outbox.length);
  state.store.outbox = [];
});

/* ---------- offline queue ---------- */
const chatMod = await mod("js/chat.js");

await checkAsync("offline send is queued, not lost", async () => {
  Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
  const chat = chatMod.ensureChat();
  const before = chat.messages.length;
  await chatMod.sendMessage({ text: "queued while offline", images: [] });
  const after = chatMod.activeChat();
  if (after.messages.length !== before + 1) throw new Error("message not added");
  const last = after.messages[after.messages.length - 1];
  if (last.pending !== "offline") throw new Error("pending state: " + last.pending);
  if (chatMod.offlinePendingCount() !== 1) throw new Error("queue count " + chatMod.offlinePendingCount());
});

await checkAsync("queued message sends once back online", async () => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  let called = 0;
  window.fetch = global.fetch = async () => {
    called++;
    return new Response(JSON.stringify({ response: "sent after reconnect" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  await chatMod.flushOfflineQueue();
  if (called === 0) throw new Error("no request after reconnect");
  if (chatMod.offlinePendingCount() !== 0) throw new Error("queue not drained");
  const chat = chatMod.activeChat();
  const last = chat.messages[chat.messages.length - 1];
  if (last.role !== "assistant" || !/sent after reconnect/.test(last.content)) {
    throw new Error("answer missing: " + JSON.stringify(last.content));
  }
});

const failed = results.filter((r) => r[0] === "FAIL");
results.forEach((r) => console.log(r[0] === "PASS" ? `✓ ${r[1]}` : `✗ ${r[1]} — ${r[2]}`));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
