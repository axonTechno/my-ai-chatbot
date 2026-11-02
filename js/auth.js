/* =========================================================
   AXON AI — auth.js
   Email-only account flow (verification code, no password).
   The UI is complete; the transport lives in backend.js and
   reports honestly when no auth backend is connected.
   ========================================================= */

import { store, persistProfile, persistAuth } from "./state.js";
import { backendConfigured, requestEmailCode, verifyEmailCode, signOutLocal, isSignedIn, pullChats, chatFromServer, flushOutbox, syncStatus } from "./backend.js";
import { $, toast } from "./ui.js";
import { renderHistory, refreshAccountChip } from "./sidebar.js";
import { renderMessages } from "./chat.js";

const ui = {
  step: "email",
  email: "",
  busy: false,
  cooldown: 0,
  cooldownTimer: null
};

export function authState() {
  return { ...ui, configured: backendConfigured(), signedIn: isSignedIn() };
}

function setStatus(text, kind = "") {
  const el = $("#authStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = `auth-status${kind ? ` ${kind}` : ""}`;
}

function setBusy(busy, label) {
  ui.busy = busy;
  const send = $("#authSendCodeBtn");
  const verify = $("#authVerifyBtn");
  const resend = $("#authResendBtn");
  if (send) {
    send.disabled = busy;
    send.textContent = busy && label === "send" ? "Sending code…" : "Send verification code";
  }
  if (verify) {
    verify.disabled = busy;
    verify.textContent = busy && label === "verify" ? "Verifying…" : "Verify & continue";
  }
  if (resend) resend.disabled = busy || ui.cooldown > 0;
}

function showStep(step) {
  ui.step = step;
  $("#authStepEmail")?.classList.toggle("hidden", step !== "email");
  $("#authStepCode")?.classList.toggle("hidden", step !== "code");
  if (step === "code") {
    const emailEl = $("#authCodeEmail");
    if (emailEl) emailEl.textContent = ui.email;
    const input = $("#authCode");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 80);
    }
  }
}

function startCooldown(seconds = 45) {
  ui.cooldown = seconds;
  const resend = $("#authResendBtn");
  clearInterval(ui.cooldownTimer);
  const tick = () => {
    if (ui.cooldown <= 0) {
      clearInterval(ui.cooldownTimer);
      ui.cooldownTimer = null;
      if (resend) {
        resend.disabled = false;
        resend.textContent = "Resend code";
      }
      return;
    }
    if (resend) {
      resend.disabled = true;
      resend.textContent = `Resend in ${ui.cooldown}s`;
    }
    ui.cooldown--;
  };
  tick();
  ui.cooldownTimer = setInterval(tick, 1000);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function serviceNote() {
  const note = $("#authServiceNote");
  if (!note) return;
  note.textContent = backendConfigured()
    ? "A 6-digit code will be emailed to you. No password needed."
    : "Accounts are not connected on this build yet, so the code cannot be emailed. You can keep using AXON locally — your chats stay on this device.";
}

async function sendCode() {
  if (ui.busy) return;
  const input = $("#authEmail");
  const email = (input?.value || "").trim().toLowerCase();
  if (!validEmail(email)) {
    setStatus("Enter a valid email address.", "error");
    input?.focus();
    return;
  }
  ui.email = email;
  setStatus("");

  if (!backendConfigured()) {
    setStatus(
      "Email sign-in needs the AXON auth endpoint (see BACKEND.md). Until it is connected, use “Continue without an account”.",
      "error"
    );
    return;
  }

  setBusy(true, "send");
  try {
    await requestEmailCode(email);
    showStep("code");
    setStatus("Code sent. Check your inbox (and spam folder).", "ok");
    startCooldown(45);
  } catch (err) {
    setStatus(err.message || "Could not send the code. Try again.", "error");
  } finally {
    setBusy(false);
  }
}

async function verify() {
  if (ui.busy) return;
  const code = ($("#authCode")?.value || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    setStatus("Enter the code from your email.", "error");
    return;
  }
  if (!backendConfigured()) {
    setStatus("Verification needs the AXON auth endpoint to be connected.", "error");
    return;
  }
  setBusy(true, "verify");
  try {
    const session = await verifyEmailCode(ui.email, code);
    store.profile.email = session.email;
    store.auth = { email: session.email, verified: true, displayName: store.profile.name };
    persistProfile();
    persistAuth();
    setStatus("Verified. Restoring your conversations…", "ok");
    await restoreFromCloud();
    refreshAccountChip();
    renderHistory();
    setStatus("Signed in.", "ok");
    toast("Signed in — chats synced", "ok");
    document.dispatchEvent(new CustomEvent("axon:auth-changed"));
    document.dispatchEvent(new CustomEvent("axon:close-auth"));
  } catch (err) {
    setStatus(err.message || "That code did not work. Try again.", "error");
  } finally {
    setBusy(false);
  }
}

/** Pull this account's chats and merge them with local ones (never destructive). */
export async function restoreFromCloud() {
  if (!isSignedIn()) return { merged: 0, error: "not_signed_in" };
  try {
    const rows = await pullChats(0);
    let merged = 0;
    rows.forEach((row) => {
      const remote = chatFromServer(row);
      if (!remote) return;
      const local = store.chats.find((c) => c.id === remote.id);
      if (!local) {
        store.chats.push(remote);
        merged++;
      } else if (remote.updatedAt > local.updatedAt) {
        Object.assign(local, remote, { dirty: false });
        merged++;
      }
    });
    if (merged) {
      const { persistChats } = await import("./state.js");
      persistChats();
      renderHistory();
      renderMessages();
    }
    await flushOutbox();
    return { merged };
  } catch (err) {
    return { merged: 0, error: err.message };
  }
}

export function openAuthPage() {
  const page = $("#loginPage");
  if (!page) return;
  serviceNote();
  showStep("email");
  setStatus("");
  const emailInput = $("#authEmail");
  if (emailInput) emailInput.value = store.profile.email || store.auth.email || "";
  page.classList.remove("hidden");
  setTimeout(() => emailInput?.focus(), 120);
}

export function closeAuthPage() {
  $("#loginPage")?.classList.add("hidden");
}

export function initAuth() {
  $("#authSendCodeBtn")?.addEventListener("click", sendCode);
  $("#authVerifyBtn")?.addEventListener("click", verify);
  $("#authResendBtn")?.addEventListener("click", sendCode);
  $("#authChangeEmail")?.addEventListener("click", () => {
    showStep("email");
    setStatus("");
  });
  $("#authSkipBtn")?.addEventListener("click", () => {
    closeAuthPage();
    toast("Using AXON locally on this device");
  });
  $("#authEmail")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendCode();
    }
  });
  $("#authCode")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      verify();
    }
  });
  $("#authCode")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 8);
  });

  document.addEventListener("axon:close-auth", closeAuthPage);
  document.addEventListener("axon:open-auth", openAuthPage);
}

export function signOut() {
  signOutLocal();
  store.auth = { email: "", verified: false, displayName: "" };
  persistAuth();
  refreshAccountChip();
  renderHistory();
  document.dispatchEvent(new CustomEvent("axon:auth-changed"));
  document.dispatchEvent(new CustomEvent("axon:sync-changed"));
}

/* ================= SYNC ================= */

/** Push every locally-changed chat, then pull anything newer from the account. */
export async function syncNow({ silent = false } = {}) {
  if (!isSignedIn()) {
    if (!silent) toast("Sign in to sync your chats", "error");
    return { pushed: 0, pulled: 0, error: "not_signed_in" };
  }
  const result = await syncStatus();
  if (result.error) {
    if (!silent) toast(`Sync failed — ${result.error}`, "error");
    return result;
  }
  if (result.pulled) {
    renderHistory();
    renderMessages();
  }
  if (!silent) {
    toast(
      result.pushed || result.pulled
        ? `Synced · ${result.pushed} sent · ${result.pulled} received`
        : "Everything is up to date",
      "ok"
    );
  }
  document.dispatchEvent(new CustomEvent("axon:sync-changed"));
  return result;
}
