/* =========================================================
   AXON AI — share.js
   Real sharing: Web Share API when available, otherwise a
   sheet with copy / download / native share options.
   Nothing is faked — every option reports its real result.
   ========================================================= */

import { toast, copyText, downloadFile } from "./ui.js";

let sheet = null;
let cleanup = null;

function closeSheet() {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
  if (sheet) {
    sheet.remove();
    sheet = null;
  }
}

function buildSheet({ title, text, filename }) {
  closeSheet();
  sheet = document.createElement("div");
  sheet.className = "share-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Share");

  const h = document.createElement("h3");
  h.textContent = title || "Share";
  sheet.appendChild(h);

  const p = document.createElement("p");
  p.textContent = "Choose how you want to share this.";
  sheet.appendChild(p);

  if (text) {
    const preview = document.createElement("div");
    preview.className = "share-preview";
    preview.textContent = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    sheet.appendChild(preview);
  }

  const actions = document.createElement("div");
  actions.className = "share-actions";

  const add = (iconId, label, handler) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${iconId}`);
    svg.appendChild(use);
    btn.appendChild(svg);
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener("click", () => handler());
    actions.appendChild(btn);
  };

  if (navigator.share) {
    add("i-share", "Share with another app", async () => {
      try {
        await navigator.share({ title: title || "AXON AI", text });
        closeSheet();
      } catch (e) {
        if (e && e.name === "AbortError") return;
        toast("Sharing was cancelled", "error");
      }
    });
  }

  add("i-copy", "Copy to clipboard", async () => {
    const ok = await copyText(text || "");
    toast(ok ? "Copied to clipboard" : "Could not copy", ok ? "" : "error");
    if (ok) closeSheet();
  });

  add("i-download", "Download as file", () => {
    const ok = downloadFile(filename || "axon-share.txt", text || "", "text/plain");
    toast(ok ? "File downloaded" : "Download failed", ok ? "" : "error");
    if (ok) closeSheet();
  });

  sheet.appendChild(actions);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn ghost block";
  cancel.style.marginTop = "12px";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeSheet);
  sheet.appendChild(cancel);

  document.body.appendChild(sheet);

  const onKey = (e) => {
    if (e.key === "Escape") closeSheet();
  };
  const onDocClick = (e) => {
    if (sheet && !sheet.contains(e.target)) closeSheet();
  };
  document.addEventListener("keydown", onKey);
  setTimeout(() => document.addEventListener("pointerdown", onDocClick), 10);
  cleanup = () => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDocClick);
  };
}

/** Share a single message. */
export function shareMessageSheet(message, { who = "AXON" } = {}) {
  const text = (message && message.content) || "";
  if (!text.trim()) {
    toast("Nothing to share yet", "error");
    return;
  }
  buildSheet({
    title: `Share ${who} message`,
    text,
    filename: "axon-message.txt"
  });
}

/** Share a whole conversation. */
export function shareChatSheet(chat, { markdown = "" } = {}) {
  const text = markdown || (chat.messages || []).map((m) => m.content).join("\n\n");
  if (!text.trim()) {
    toast("This conversation is empty", "error");
    return;
  }
  const safe = (chat.title || "axon-chat").replace(/[^\w\-]+/g, "-").toLowerCase();
  buildSheet({
    title: "Share conversation",
    text,
    filename: `${safe}.md`
  });
}

export { closeSheet as closeShareSheet };
