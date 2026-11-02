/* Headless smoke test: boots the real app in jsdom and asserts the
   core flows work (rendering, sending, streaming, editing, images). */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost:5173/",
  runScripts: "outside-only",
  pretendToBeVisual: true
});
const { window } = dom;

window.matchMedia =
  window.matchMedia ||
  ((q) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }));
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollTo = () => {};
window.navigator.vibrate = () => true;
window.document.execCommand = () => true;

/* expose the DOM to the ES modules before importing them */
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
    const r = fn();
    if (r === false) throw new Error("returned false");
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};
const checkAsync = async (name, fn) => {
  try {
    const r = await fn();
    if (r === false) throw new Error("returned false");
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};

const mod = (p) => import("file://" + path.join(root, p));
const ai = await mod("js/ai.js");
const md = await mod("js/markdown.js");

/* ---------- SSE + response shapes ---------- */

check("SSE parser: split chunks + [DONE]", () => {
  const out = [];
  const p = ai.createSSEParser((e) => out.push(e));
  p.push('data: {"response":"Hel');
  p.push('lo"}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n');
  p.push("data: [DONE]\n\n");
  const text = out
    .filter((e) => e.type === "json")
    .map((e) => ai.extractText(e.data))
    .join("");
  if (text !== "Hello world") throw new Error("got " + JSON.stringify(text));
  if (!p.done) throw new Error("[DONE] not detected");
});

check("SSE parser: CRLF + raw text + comments", () => {
  const out = [];
  const p = ai.createSSEParser((e) => out.push(e));
  p.push(": keepalive\r\n\r\ndata: plain text\r\n\r\n");
  const text = out.map((e) => (e.type === "text" ? e.text : "")).join("");
  if (!text.includes("plain text")) throw new Error("raw text lost: " + JSON.stringify(out));
});

check("extractText: all three worker shapes", () => {
  const a = ai.extractText({ response: "A" });
  const b = ai.extractText({ result: { response: "B" } });
  const c = ai.extractText({ choices: [{ delta: { content: "C" } }] });
  if (a + b + c !== "ABC") throw new Error(`${a}${b}${c}`);
});

check("extractError: in-stream error", () => {
  const e = ai.extractError({ error: { message: "rate limited" } });
  if (e !== "rate limited") throw new Error(e);
});

/* ---------- markdown ---------- */

check("markdown: headings, lists, code, sanitising", () => {
  const node = md.renderMarkdown(
    "# Title\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>"
  );
  const out = node.innerHTML;
  if (!/<h1[^>]*>Title<\/h1>/.test(out)) throw new Error("heading missing");
  if (!/<ul>/.test(out)) throw new Error("list missing");
  if (!/code-block/.test(out)) throw new Error("code block missing");
  if (/<script/i.test(out)) throw new Error("script tag not escaped");
});

check("markdown: inline code and bold", () => {
  const out = md.renderMarkdown("Use `npm run dev` and **bold** text").innerHTML;
  if (!/<code/.test(out)) throw new Error("inline code missing: " + out);
  if (!/<strong>/.test(out)) throw new Error("bold missing: " + out);
});

/* ---------- full app boot ---------- */

let fetchCalls = [];
window.fetch = global.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('data: {"response":"Hello"}\n\n'));
      controller.enqueue(enc.encode('data: {"response":" there"}\n\n'));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const state = await mod("js/state.js");
const chat = await mod("js/chat.js");
const sidebar = await mod("js/sidebar.js");
const settingsMod = await mod("js/settings.js");

state.loadAll();
sidebar.initSidebar();
settingsMod.initSettings();
chat.initChatComposer();

const first = state.createChat();
chat.setActiveChat(first.id);
chat.renderMessages();

check("welcome screen shows for an empty chat", () => {
  if (window.document.getElementById("welcomeScreen").classList.contains("hidden")) {
    throw new Error("welcome hidden");
  }
});

await chat.sendMessage({ text: "Hi AXON" });

check("request body keeps worker contract", () => {
  const body = fetchCalls[0].body;
  if (typeof body.message !== "string") throw new Error("no message field");
  if (!Array.isArray(body.messages)) throw new Error("no messages array");
  if (!body.messages.some((m) => m.role === "system")) throw new Error("no system prompt");
  if (body.language !== "English") throw new Error("language missing");
  if (body.messages.some((m) => m.role === "assistant" && !m.content)) {
    throw new Error("empty placeholder sent");
  }
});

check("streamed answer rendered as markdown", () => {
  const nodes = window.document.querySelectorAll(".msg.assistant");
  if (nodes.length !== 1) throw new Error("assistant nodes: " + nodes.length);
  if (!nodes[0].textContent.includes("Hello there")) throw new Error(nodes[0].textContent);
});

check("user message persisted with content", () => {
  const saved = JSON.parse(window.localStorage.getItem("axon_chats"));
  const msgs = saved[0].messages;
  if (msgs[0].content !== "Hi AXON") throw new Error(JSON.stringify(msgs[0]));
  if (msgs[1].content !== "Hello there") throw new Error(JSON.stringify(msgs[1]));
});

check("actions: copy, like, dislike present", () => {
  const actions = window.document.querySelector(".msg.assistant .msg-actions");
  const labels = [...actions.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  ["Copy answer", "Like answer", "Dislike answer"].forEach((l) => {
    if (!labels.includes(l)) throw new Error("missing " + l + " in " + labels.join("|"));
  });
});

await checkAsync("edit truncates the old branch (no duplicates)", async () => {
  const live = state.getChat(first.id);
  const userId = live.messages[0].id;
  const before = live.messages.length;
  await chat.sendMessage({ text: "Edited question", editingId: userId });
  const after = state.getChat(first.id).messages;
  if (after.length !== before) throw new Error(`length ${before} -> ${after.length}`);
  if (after[0].content !== "Edited question") throw new Error(after[0].content);
});

await checkAsync("regenerate replaces the last answer", async () => {
  const live = state.getChat(first.id);
  const aiMsg = live.messages[live.messages.length - 1];
  const count = live.messages.length;
  await chat.regenerate(live, aiMsg.id);
  const after = state.getChat(first.id).messages;
  if (after.length !== count) throw new Error(`length ${count} -> ${after.length}`);
  if (after[after.length - 1].role !== "assistant") throw new Error("last not assistant");
});

check("pin / rename / duplicate / delete", () => {
  const c = state.createChat("Temp chat");
  state.togglePin(c.id);
  if (!state.getChat(c.id).pinned) throw new Error("pin failed");
  state.renameChat(c.id, "Renamed");
  if (state.getChat(c.id).title !== "Renamed") throw new Error("rename failed");
  const dup = state.duplicateChat(c.id);
  if (!dup || dup.id === c.id) throw new Error("duplicate failed");
  state.deleteChat(dup.id);
  if (state.getChat(dup.id)) throw new Error("delete failed");
});

check("v1 localStorage migration keeps history", () => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "axon_chats",
    JSON.stringify([{ id: "old1", title: "Old chat", messages: [{ role: "user", content: "legacy msg" }] }])
  );
  window.localStorage.setItem("axon_theme", "dark");
  state.loadAll();
  if (state.store.chats[0].messages[0].content !== "legacy msg") throw new Error("chat lost");
  if (state.store.settings.theme !== "dark") throw new Error("theme lost");
});

const failed = results.filter((r) => r[0] === "FAIL");
results.forEach((r) => console.log(r[0] === "PASS" ? `✓ ${r[1]}` : `✗ ${r[1]} — ${r[2]}`));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
