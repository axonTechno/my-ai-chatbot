/* =========================================================
   AXON AI — ai.js
   Centralised AI service layer.
   • Talks to the existing Cloudflare Worker (unchanged contract)
   • Streams SSE with a robust incremental parser
   • Falls back to plain JSON responses
   • Retries transient failures and tries a second model
   • Never invents an answer: every failure is reported precisely
   ========================================================= */

import { DEFAULT_WORKER_URL, AI_ROUTES, REQUEST, RESPONSE_STYLES, modelInfo, MODELS } from "./config.js";
import { store } from "./state.js";

export class AIError extends Error {
  constructor(message, { code = "unknown", status = 0, retryable = false, detail = "" } = {}) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

/* ---------- endpoint resolution ---------- */

export function workerBase() {
  const override = (store.settings.workerUrl || "").trim();
  const base = override || DEFAULT_WORKER_URL;
  return base.endsWith("/") ? base : `${base}/`;
}

export function workerUrl(route = "") {
  const base = workerBase();
  if (!route) return base;
  return base + String(route).replace(/^\//, "");
}

/* ---------- SSE parser ---------- */

export function createSSEParser(onEvent) {
  let buffer = "";
  let done = false;

  function handleLine(line) {
    if (!line || line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") {
      const trimmed = value.trim();
      if (trimmed === "[DONE]") {
        done = true;
        onEvent({ type: "done" });
        return;
      }
      if (!trimmed) return;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch (e) {
        /* Some Workers emit raw text chunks instead of JSON. */
        onEvent({ type: "text", text: value });
        return;
      }
      onEvent({ type: "json", data: payload });
    } else if (field === "event") {
      if (value.trim() === "done" || value.trim() === "end") {
        done = true;
        onEvent({ type: "done" });
      }
    }
  }

  return {
    get done() {
      return done;
    },
    push(text) {
      buffer += text;
      let idx;
      while ((idx = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        const sepLen = buffer.startsWith("\r\n", idx) ? 2 : 1;
        buffer = buffer.slice(idx + sepLen);
        handleLine(line);
      }
    },
    flush() {
      if (buffer.trim()) {
        handleLine(buffer.trim());
        buffer = "";
      }
    }
  };
}

/* Extract text from the three response shapes the Worker may emit. */
export function extractText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return "";

  if (typeof data.response === "string") return data.response;
  if (typeof data.text === "string") return data.text;
  if (typeof data.delta === "string") return data.delta;
  if (typeof data.content === "string") return data.content;

  if (data.result && typeof data.result === "object") {
    if (typeof data.result.response === "string") return data.result.response;
    if (typeof data.result.text === "string") return data.result.text;
    if (data.result.choices && data.result.choices[0]) {
      const c = data.result.choices[0];
      if (c.delta && typeof c.delta.content === "string") return c.delta.content;
      if (c.message && typeof c.message.content === "string") return c.message.content;
    }
  }

  if (Array.isArray(data.choices) && data.choices[0]) {
    const c = data.choices[0];
    if (c.delta && typeof c.delta.content === "string") return c.delta.content;
    if (c.message && typeof c.message.content === "string") return c.message.content;
    if (typeof c.text === "string") return c.text;
  }

  if (Array.isArray(data.content)) {
    return data.content.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
  }

  return "";
}

/* Error payloads coming back inside a 200 stream. */
export function extractError(data) {
  if (!data || typeof data !== "object") return "";
  if (data.error) {
    if (typeof data.error === "string") return data.error;
    if (typeof data.error.message === "string") return data.error.message;
  }
  if (typeof data.message === "string" && data.type === "error") return data.message;
  return "";
}

/* ---------- request body ---------- */

export function buildSystemPrompt() {
  const { language, responseStyle } = store.settings;
  const name = store.profile.name ? store.profile.name.trim() : "";
  const style = RESPONSE_STYLES[responseStyle] || RESPONSE_STYLES.balanced;

  return [
    "You are AXON, a friendly, accurate and helpful AI assistant.",
    `Always reply in ${language}.`,
    style,
    "Use Markdown for structure: short paragraphs, bullet lists, headings when useful, and fenced code blocks with a language tag for code.",
    name ? `The user's name is ${name}. Address them naturally when appropriate.` : "",
    "If you are unsure, say so instead of inventing facts."
  ]
    .filter(Boolean)
    .join(" ");
}

/* History sent to the model: everything except the empty placeholder. */
export function buildHistory(messages) {
  return messages
    .filter((m) => (m.content && m.content.trim()) || (m.images && m.images.length))
    .filter((m) => !m.error)
    .map((m) => {
      const entry = { role: m.role, content: m.content || "" };
      if (m.images && m.images.length) {
        entry.images = m.images.map((img) => img.dataUrl).filter(Boolean);
      }
      return entry;
    });
}

export function buildRequestBody({ message, history, images, model }) {
  const body = {
    message: message || "",
    messages: [{ role: "system", content: buildSystemPrompt() }, ...history],
    language: store.settings.language,
    stream: store.settings.stream !== false,
    system: buildSystemPrompt()
  };
  if (images && images.length) body.images = images;
  if (model && model !== "auto") body.model = model;
  return body;
}

/* ---------- single attempt ---------- */

async function attempt({ body, model, signal, onDelta, onMeta }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), REQUEST.timeoutMs);
  const abortBridge = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortBridge, { once: true });
  }

  let response;
  try {
    response = await fetch(workerUrl(AI_ROUTES.chat), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });
  } catch (err) {
    clearTimeout(timer);
    if (signal && signal.aborted) throw new AIError("Stopped", { code: "aborted" });
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AIError("The request timed out.", { code: "timeout", retryable: true });
    }
    throw new AIError(
      "Could not reach the AXON AI service.",
      { code: "network", retryable: true, detail: err && err.message ? err.message : String(err) }
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    let detail = "";
    try {
      const text = await response.text();
      detail = text.slice(0, 400);
    } catch (e) {}
    throw new AIError(httpMessage(response.status), {
      code: "http",
      status: response.status,
      retryable: REQUEST.retryStatuses.includes(response.status),
      detail
    });
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const isStream = contentType.includes("event-stream") || !contentType.includes("application/json");

  /* ---- non-streaming JSON ---- */
  if (!isStream) {
    const raw = await response.text();
    clearTimeout(timer);
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      /* Some deployments stream without the SSE content-type. */
      const text = parseLooseStream(raw, onDelta);
      if (text) return { text, model };
      throw new AIError("The AI service returned an unreadable response.", {
        code: "parse",
        detail: raw.slice(0, 300)
      });
    }
    const errText = extractError(data);
    if (errText) throw new AIError(errText, { code: "api", status: 200, retryable: true });
    const text = extractText(data);
    if (!text) {
      throw new AIError("The AI service returned an empty answer.", {
        code: "empty",
        retryable: true,
        detail: raw.slice(0, 300)
      });
    }
    if (onMeta && data.model) onMeta({ model: data.model });
    if (onDelta) onDelta(text);
    return { text, model: data.model || model };
  }

  /* ---- streaming ---- */
  if (!response.body) {
    clearTimeout(timer);
    throw new AIError("This browser cannot read the AI stream.", { code: "nostream" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let acc = "";
  let streamError = null;

  const parser = createSSEParser((event) => {
    if (event.type === "text") {
      acc += event.text;
      if (onDelta) onDelta(event.text);
      return;
    }
    if (event.type !== "json") return;
    const data = event.data;
    const errText = extractError(data);
    if (errText) {
      streamError = errText;
      return;
    }
    if (onMeta && data && data.model) onMeta({ model: data.model });
    const piece = extractText(data);
    if (piece) {
      acc += piece;
      if (onDelta) onDelta(piece);
    }
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (parser.done) break;
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (err) {
    if (signal && signal.aborted) throw new AIError("Stopped", { code: "aborted" });
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AIError("The stream timed out.", { code: "timeout", retryable: !acc });
    }
    if (!acc) {
      throw new AIError("The connection dropped before any answer arrived.", {
        code: "stream",
        retryable: true,
        detail: err && err.message ? err.message : String(err)
      });
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abortBridge);
    try {
      reader.releaseLock();
    } catch (e) {}
  }

  if (streamError && !acc) {
    throw new AIError(streamError, { code: "api", status: 200, retryable: true });
  }
  if (!acc.trim()) {
    throw new AIError("The AI service returned an empty answer.", { code: "empty", retryable: true });
  }

  return { text: acc, model };
}

function parseLooseStream(raw, onDelta) {
  let acc = "";
  raw.split(/\r?\n/).forEach((line) => {
    const m = /^data:\s*(.*)$/.exec(line);
    if (!m) return;
    const v = m[1].trim();
    if (!v || v === "[DONE]") return;
    try {
      const piece = extractText(JSON.parse(v));
      if (piece) {
        acc += piece;
        if (onDelta) onDelta(piece);
      }
    } catch (e) {}
  });
  return acc;
}

function httpMessage(status) {
  if (status === 401 || status === 403) return "The AI service rejected the request (authorization).";
  if (status === 404) return "The AI endpoint was not found on the Worker.";
  if (status === 413) return "The message or images are too large for the AI service.";
  if (status === 429) return "Too many requests right now. Please wait a moment.";
  if (status >= 500) return "The AI service is temporarily unavailable.";
  return `The AI service returned an error (HTTP ${status}).`;
}

/* ---------- retry + model fallback ---------- */

function candidateModels(primary) {
  const list = [primary || store.settings.model || "auto"];
  if (list[0] !== "auto") list.push("auto");
  MODELS.filter((m) => m.fallback).forEach((m) => {
    if (!list.includes(m.id)) list.push(m.id);
  });
  return list;
}

/**
 * Send a chat request.
 * @returns {Promise<{text:string, model:string, attempts:Array}>}
 */
export async function sendChat({ message, history, images, signal, onDelta, onMeta, allowFallback = true }) {
  const primary = store.settings.model || "auto";
  const models = allowFallback ? candidateModels(primary) : [primary];
  const attempts = [];
  let lastError = null;
  let streamedAny = false;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    if (streamedAny) break; /* never restart once text is on screen */

    for (let attemptNo = 0; attemptNo <= REQUEST.maxRetries; attemptNo++) {
      if (signal && signal.aborted) throw new AIError("Stopped", { code: "aborted" });
      const body = buildRequestBody({ message, history, images, model });
      attempts.push({ model, attempt: attemptNo + 1 });
      try {
        const result = await attempt({
          body,
          model,
          signal,
          onMeta,
          onDelta: (chunk) => {
            streamedAny = true;
            if (onDelta) onDelta(chunk);
          }
        });
        return { ...result, attempts };
      } catch (err) {
        lastError = err;
        if (err.code === "aborted") throw err;
        if (streamedAny) throw err;
        if (!err.retryable) break;
        if (attemptNo < REQUEST.maxRetries) {
          const wait = 500 * Math.pow(2, attemptNo);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }

    /* This model is exhausted — tell the UI it is switching so the user sees
       why the answer is taking longer, then try the next free model. */
    if (!streamedAny && mi < models.length - 1 && onMeta) {
      onMeta({ switching: true, from: model, to: models[mi + 1] });
    }
  }

  throw lastError || new AIError("The AI service could not answer.", { code: "unknown", retryable: true });
}

/* ---------- connection test ---------- */

export async function testConnection() {
  const started = Date.now();
  const url = workerUrl(AI_ROUTES.chat);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST.healthTimeoutMs);

  try {
    /* A real POST proves the Worker can answer, not just that it exists. */
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        message: "ping",
        messages: [{ role: "user", content: "ping" }],
        language: store.settings.language,
        stream: false,
        probe: true
      }),
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });
    const ms = Date.now() - started;
    if (res.ok) {
      let sample = "";
      try {
        sample = extractText(await res.json()).slice(0, 60);
      } catch (e) {}
      return { ok: true, status: res.status, ms, url, sample };
    }
    return { ok: false, status: res.status, ms, url, message: httpMessage(res.status) };
  } catch (err) {
    const ms = Date.now() - started;
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return { ok: false, status: 0, ms, url, message: "The connection test timed out." };
    }
    return {
      ok: false,
      status: 0,
      ms,
      url,
      message: "Network error — the Worker could not be reached from this device.",
      detail: err && err.message ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

export function currentModelLabel() {
  return modelInfo(store.settings.model).label;
}
