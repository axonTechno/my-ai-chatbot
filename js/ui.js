/* =========================================================
   AXON AI — ui.js
   Shared UI primitives: toasts, menus, confirm dialog,
   image viewer, clipboard, haptics, formatting helpers.
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export { $, $$ };

/* ---------- toast ---------- */

let toastTimer = null;

export function toast(message, kind = "") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast${kind ? ` ${kind}` : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "toast hidden";
  }, kind === "error" ? 4200 : 2600);
}

/* ---------- haptics ---------- */

export function haptic(ms = 8) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

/* ---------- clipboard ---------- */

export async function copyText(text) {
  const value = String(text == null ? "" : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/* ---------- action menu ---------- */

let menuCleanup = null;

/**
 * Show a popup menu.
 * items: [{ label, icon, danger, onClick } | { separator: true }]
 */
export function openMenu(items, anchor) {
  closeMenu();
  const menu = $("#actionMenu");
  const overlay = $("#sheetOverlay");
  if (!menu || !overlay) return;

  menu.replaceChildren();
  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    if (item.danger) btn.className = "danger";
    btn.innerHTML = `${item.icon ? `<svg aria-hidden="true"><use href="#${item.icon}"/></svg>` : ""}<span></span>`;
    btn.querySelector("span").textContent = item.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      if (item.onClick) item.onClick();
    });
    menu.appendChild(btn);
  });

  menu.classList.remove("hidden");
  overlay.classList.remove("hidden");

  /* position near the anchor, clamped to the viewport */
  const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect ? rect.right - mw : (vw - mw) / 2;
  let top = rect ? rect.bottom + 6 : vh / 2 - mh / 2;
  left = Math.max(8, Math.min(left, vw - mw - 8));
  if (top + mh > vh - 8) top = Math.max(8, (rect ? rect.top : vh / 2) - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDocClick = (e) => {
    if (!menu.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeMenu();
  };
  overlay.addEventListener("click", closeMenu);
  setTimeout(() => document.addEventListener("pointerdown", onDocClick), 0);
  document.addEventListener("keydown", onKey);
  menuCleanup = () => {
    document.removeEventListener("pointerdown", onDocClick);
    document.removeEventListener("keydown", onKey);
    overlay.removeEventListener("click", closeMenu);
  };
}

export function closeMenu() {
  const menu = $("#actionMenu");
  const overlay = $("#sheetOverlay");
  const confirm = $("#confirmCard");
  if (menu) menu.classList.add("hidden");
  if (confirm && confirm.classList.contains("hidden")) {
    if (overlay) overlay.classList.add("hidden");
  }
  if (menuCleanup) {
    menuCleanup();
    menuCleanup = null;
  }
}

/* ---------- confirm dialog (promise based) ---------- */

let confirmResolve = null;

export function confirmDialog({ title = "Are you sure?", text = "", okLabel = "Confirm", danger = true } = {}) {
  const card = $("#confirmCard");
  const overlay = $("#sheetOverlay");
  if (!card || !overlay) return Promise.resolve(false);

  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  const ok = $("#confirmOk");
  const cancel = $("#confirmCancel");
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? "danger" : "primary"}`;

  card.classList.remove("hidden");
  overlay.classList.remove("hidden");
  setTimeout(() => ok.focus(), 30);

  const finish = (result) => {
    card.classList.add("hidden");
    overlay.classList.add("hidden");
    ok.removeEventListener("click", onOk);
    cancel.removeEventListener("click", onCancel);
    overlay.removeEventListener("click", onCancel);
    document.removeEventListener("keydown", onKey);
    confirmResolve = null;
    return result;
  };

  const onOk = () => confirmResolve && confirmResolve(finish(true));
  const onCancel = () => confirmResolve && confirmResolve(finish(false));
  const onKey = (e) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter") onOk();
  };

  ok.addEventListener("click", onOk);
  cancel.addEventListener("click", onCancel);
  overlay.addEventListener("click", onCancel);
  document.addEventListener("keydown", onKey);

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

/* ---------- prompt dialog (rename etc.) ---------- */

export function promptDialog({ title = "Rename", value = "", okLabel = "Save", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const card = $("#confirmCard");
    const overlay = $("#sheetOverlay");
    if (!card || !overlay) return resolve(null);

    const titleEl = $("#confirmTitle");
    const textEl = $("#confirmText");
    const ok = $("#confirmOk");
    const cancel = $("#confirmCancel");

    titleEl.textContent = title;
    textEl.replaceChildren();
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = 120;
    input.style.cssText =
      "width:100%;min-height:42px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface-2);font-size:14.5px;outline:0";
    textEl.appendChild(input);
    ok.textContent = okLabel;
    ok.className = "btn primary";
    card.classList.remove("hidden");
    overlay.classList.remove("hidden");
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);

    const finish = (result) => {
      card.classList.add("hidden");
      overlay.classList.add("hidden");
      ok.removeEventListener("click", onOk);
      cancel.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onOk = () => finish(input.value.trim());
    const onCancel = () => finish(null);
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        e.preventDefault();
        onOk();
      }
    };
    ok.addEventListener("click", onOk);
    cancel.addEventListener("click", onCancel);
    overlay.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKey);
  });
}

/* ---------- image viewer ---------- */

export function openImageViewer(src, alt = "Image", actions = null) {
  const viewer = $("#imageViewer");
  const img = $("#viewerImage");
  if (!viewer || !img) return;

  img.src = src;
  img.alt = alt;

  const bar = $("#viewerImageActions");
  const download = $("#viewerDownload");
  const share = $("#viewerShare");
  const regenerate = $("#viewerRegenerate");

  if (bar) {
    bar.classList.toggle("hidden", !actions);
    if (download) download.onclick = actions?.onDownload || null;
    if (share) share.onclick = actions?.onShare || null;
    if (regenerate) regenerate.onclick = actions?.onRegenerate || null;
  }

  viewer.classList.remove("hidden");
  document.addEventListener("keydown", closeOnEscape);
}

export function closeImageViewer() {
  const viewer = $("#imageViewer");
  const img = $("#viewerImage");
  if (!viewer) return;

  viewer.classList.add("hidden");
  if (img) img.removeAttribute("src");

  const bar = $("#viewerImageActions");
  if (bar) bar.classList.add("hidden");

  ["viewerDownload", "viewerShare", "viewerRegenerate"].forEach((id) => {
    const button = $("#" + id);
    if (button) button.onclick = null;
  });

  document.removeEventListener("keydown", closeOnEscape);
}

function closeOnEscape(e) {
  if (e.key === "Escape") closeImageViewer();
}

/* ---------- formatting ---------- */

export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

export function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 days";
  if (diffDays < 30) return "Previous 30 days";
  return d.toLocaleDateString([], { month: "short", year: "numeric" });
}

export function escapeForHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- download helper ---------- */

export function downloadFile(filename, content, mime = "text/plain") {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- focus trap for sheets/pages ---------- */

export function trapFocus(container) {
  const selector =
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
  const onKey = (e) => {
    if (e.key !== "Tab") return;
    const nodes = $$(selector, container).filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKey);
  return () => container.removeEventListener("keydown", onKey);
}
