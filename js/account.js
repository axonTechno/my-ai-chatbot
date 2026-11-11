<<<<<<< LOCAL (Your changes)
/* =========================================================
   AXON AI — account.js
   Account screen: avatar, name, email, sync status, logout.
   ========================================================= */

import { store, persistProfile, persistSettings } from "./state.js";
import { $, $$, toast, confirmDialog } from "./ui.js";
import { refreshAccountChip, renderHistory } from "./sidebar.js";
import { isSignedIn, backendConfigured, queueOutbox, pushProfile, flushOutbox, session } from "./backend.js";
import { signOut, openAuthPage, restoreFromCloud, syncNow } from "./auth.js";
import { renderMessages } from "./chat.js";

let avatarDraft = "male";

function paintSync() {
  const badge = $("#syncBadge");
  const detail = $("#syncDetail");
  const note = $("#syncNote");
  const btn = $("#syncNowBtn");
  const signedIn = isSignedIn();

  if (badge) {
    badge.className = `sync-badge ${signedIn ? "cloud" : "local"}`;
    const use = badge.querySelector("use");
    if (use) use.setAttribute("href", signedIn ? "#i-cloud" : "#i-smartphone");
    const label = badge.querySelector("span");
    if (label) label.textContent = signedIn ? "Cloud" : "Local";
  }
  if (detail) {
    if (!signedIn) detail.textContent = "No account connected";
    else if (!backendConfigured()) detail.textContent = "Account service not connected";
    else if (store.meta.lastSync) detail.textContent = `Last sync ${new Date(store.meta.lastSync).toLocaleString()}`;
    else detail.textContent = "Not synced yet";
  }
  if (note) {
    note.textContent = !backendConfigured()
      ? "Account sync is not connected on this build. Chats stay on this device and are never uploaded."
      : signedIn
        ? "Your conversations are saved to this account and restored on any device you sign in from."
        : "Sign in to save your conversations to your account.";
  }
  if (btn) btn.disabled = !signedIn;
}

function paint() {
  const avatar = store.profile.avatar === "female" ? "female" : "male";
  avatarDraft = avatar;
  const img = $("#accountAvatarImg");
  if (img) img.src = avatar === "female" ? "./assets/female-avatar.webp" : "./assets/male-avatar.webp";
  const nameEl = $("#accountName");
  if (nameEl) nameEl.textContent = store.profile.name || "Guest";
  const emailEl = $("#accountEmail");
  if (emailEl) {
    emailEl.textContent = store.profile.email || (isSignedIn() ? store.session.email : "Not signed in");
  }

  $$("[data-avatar]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.avatar === avatar);
    btn.setAttribute("aria-pressed", String(btn.dataset.avatar === avatar));
  });

  const nameInput = $("#profileNameInput");
  if (nameInput) nameInput.value = store.profile.name || "";

  const note = $("#accountEmailNote");
  if (note) {
    note.textContent = backendConfigured()
      ? isSignedIn()
        ? "Signed in. Your chats sync to this account."
        : "Sign in to sync your chats across devices."
      : "Account sync is not connected on this build. Chats stay on this device.";
  }

  const signInBtn = $("#accountSignInBtn");
  if (signInBtn) {
    signInBtn.textContent = isSignedIn() ? "Switch account" : "Sign in with email";
  }

  const sessionNote = $("#sessionNote");
  if (sessionNote) {
    sessionNote.textContent = isSignedIn()
      ? `Signed in as ${session().email}`
      : "You are using AXON locally on this device.";
  }

  paintSync();
}

export function openAccountPage() {
  paint();
  $("#accountPage")?.classList.remove("hidden");
}

export function closeAccountPage() {
  $("#accountPage")?.classList.add("hidden");
}

async function saveProfile() {
  const nameInput = $("#profileNameInput");
  const name = (nameInput?.value || "").trim().slice(0, 60);
  store.profile.name = name;
  store.profile.avatar = avatarDraft;
  persistProfile();
  refreshAccountChip();
  renderMessages();
  document.dispatchEvent(new CustomEvent("axon:profile-changed"));

  if (isSignedIn()) {
    try {
      await pushProfile(store.profile);
      toast("Saved and synced", "ok");
    } catch (e) {
      queueOutbox({ kind: "profile" });
      toast("Saved on this device — will sync later");
    }
  } else {
    toast("Saved", "ok");
  }
  paint();
}

async function doLogout() {
  const ok = await confirmDialog({
    title: "Are you sure you want to log out?",
    text: "Your conversations stay saved on this device and are restored when you sign in again.",
    okLabel: "Log out"
  });
  if (!ok) return;

  if (isSignedIn()) {
    try {
      await flushOutbox();
    } catch (e) {}
  }
  signOut();
  closeAccountPage();
  renderHistory();
  openAuthPage();
  toast("Logged out");
}

export function initAccount() {
  $$("[data-avatar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      avatarDraft = btn.dataset.avatar === "female" ? "female" : "male";
      paint();
    });
  });

  $("#saveProfileBtn")?.addEventListener("click", saveProfile);
  $("#cancelProfileBtn")?.addEventListener("click", closeAccountPage);
  $("#logoutBtn")?.addEventListener("click", doLogout);
  $("#syncNowBtn")?.addEventListener("click", async () => {
    const btn = $("#syncNowBtn");
    if (btn) btn.disabled = true;
    await syncNow();
    paint();
    if (btn) btn.disabled = !isSignedIn();
  });
  $("#accountSignInBtn")?.addEventListener("click", () => {
    closeAccountPage();
    openAuthPage();
  });

  // TEMPORARY DIAGNOSTIC (remove after debugging):
  const accountDiag = (source) => (e) => {
    console.log("[diag] tapped element:", source, e && e.target ? e.target : "");
    try {
      openAccountPage();
      console.log("[diag] openAccountPage() called: true");
      const page = $("#accountPage");
      console.log("[diag] #accountPage lost hidden class:", page ? !page.classList.contains("hidden") : "page not found");
    } catch (err) {
      console.error("[diag] EXCEPTION in account open flow:", err);
    }
  };
  $("#sidebarAccount")?.addEventListener("click", accountDiag("#sidebarAccount"));
  $("#accountBtn")?.addEventListener("click", accountDiag("#accountBtn"));
  $("#settingsAccountBtn")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("axon:close-pages"));
    openAccountPage();
  });

  // Add event listener for the back button in the account page
  const backButton = $("#accountPage button[data-back]");
  if (backButton) {
    backButton.addEventListener("click", closeAccountPage);
  }

  document.addEventListener("axon:open-account", openAccountPage);
  document.addEventListener("axon:sync-changed", () => {
    if (!$("#accountPage")?.classList.contains("hidden")) paint();
  });
  document.addEventListener("axon:auth-changed", () => {
    paint();
    if (isSignedIn()) restoreFromCloud().then((r) => {
      if (!r.error && r.merged) toast(`${r.merged} conversation(s) restored`, "ok");
    });
  });
  document.addEventListener("axon:profile-changed", () => {
    refreshAccountChip();
  });
  document.addEventListener("axon:settings-changed", () => {
    if (!$("#accountPage")?.classList.contains("hidden")) paint();
  });

  paint();
}

export { paint as paintAccount };

=======
/* =========================================================
   AXON AI — account.js
   Account screen: avatar, name, email, sync status, logout.
   ========================================================= */

import { store, persistProfile, persistSettings } from "./state.js";
import { $, $$, toast, confirmDialog } from "./ui.js";
import { refreshAccountChip, renderHistory } from "./sidebar.js";
import { isSignedIn, backendConfigured, queueOutbox, pushProfile, flushOutbox, session } from "./backend.js";
import { signOut, openAuthPage, restoreFromCloud, syncNow } from "./auth.js";
import { renderMessages } from "./chat.js";

let avatarDraft = "male";

function paintSync() {
  const badge = $("#syncBadge");
  const detail = $("#syncDetail");
  const note = $("#syncNote");
  const btn = $("#syncNowBtn");
  const signedIn = isSignedIn();

  if (badge) {
    badge.className = `sync-badge ${signedIn ? "cloud" : "local"}`;
    const use = badge.querySelector("use");
    if (use) use.setAttribute("href", signedIn ? "#i-cloud" : "#i-smartphone");
    const label = badge.querySelector("span");
    if (label) label.textContent = signedIn ? "Cloud" : "Local";
  }
  if (detail) {
    if (!signedIn) detail.textContent = "No account connected";
    else if (!backendConfigured()) detail.textContent = "Account service not connected";
    else if (store.meta.lastSync) detail.textContent = `Last sync ${new Date(store.meta.lastSync).toLocaleString()}`;
    else detail.textContent = "Not synced yet";
  }
  if (note) {
    note.textContent = !backendConfigured()
      ? "Account sync is not connected on this build. Chats stay on this device and are never uploaded."
      : signedIn
        ? "Your conversations are saved to this account and restored on any device you sign in from."
        : "Sign in to save your conversations to your account.";
  }
  if (btn) btn.disabled = !signedIn;
}

function paint() {
  const avatar = store.profile.avatar === "female" ? "female" : "male";
  avatarDraft = avatar;
  const img = $("#accountAvatarImg");
  if (img) img.src = avatar === "female" ? "./assets/female-avatar.webp" : "./assets/male-avatar.webp";
  const nameEl = $("#accountName");
  if (nameEl) nameEl.textContent = store.profile.name || "Guest";
  const emailEl = $("#accountEmail");
  if (emailEl) {
    emailEl.textContent = store.profile.email || (isSignedIn() ? store.session.email : "Not signed in");
  }

  $$("[data-avatar]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.avatar === avatar);
    btn.setAttribute("aria-pressed", String(btn.dataset.avatar === avatar));
  });

  const nameInput = $("#profileNameInput");
  if (nameInput) nameInput.value = store.profile.name || "";

  const note = $("#accountEmailNote");
  if (note) {
    note.textContent = backendConfigured()
      ? isSignedIn()
        ? "Signed in. Your chats sync to this account."
        : "Sign in to sync your chats across devices."
      : "Account sync is not connected on this build. Chats stay on this device.";
  }

  const signInBtn = $("#accountSignInBtn");
  if (signInBtn) {
    signInBtn.textContent = isSignedIn() ? "Switch account" : "Sign in with email";
  }

  const sessionNote = $("#sessionNote");
  if (sessionNote) {
    sessionNote.textContent = isSignedIn()
      ? `Signed in as ${session().email}`
      : "You are using AXON locally on this device.";
  }

  paintSync();
}

export function openAccountPage() {
  paint();
  $("#accountPage")?.classList.remove("hidden");
}

export function closeAccountPage() {
  $("#accountPage")?.classList.add("hidden");
}

async function saveProfile() {
  const nameInput = $("#profileNameInput");
  const name = (nameInput?.value || "").trim().slice(0, 60);
  store.profile.name = name;
  store.profile.avatar = avatarDraft;
  persistProfile();
  refreshAccountChip();
  renderMessages();
  document.dispatchEvent(new CustomEvent("axon:profile-changed"));

  if (isSignedIn()) {
    try {
      await pushProfile(store.profile);
      toast("Saved and synced", "ok");
    } catch (e) {
      queueOutbox({ kind: "profile" });
      toast("Saved on this device — will sync later");
    }
  } else {
    toast("Saved", "ok");
  }
  paint();
}

async function doLogout() {
  const ok = await confirmDialog({
    title: "Are you sure you want to log out?",
    text: "Your conversations stay saved on this device and are restored when you sign in again.",
    okLabel: "Log out"
  });
  if (!ok) return;

  if (isSignedIn()) {
    try {
      await flushOutbox();
    } catch (e) {}
  }
  signOut();
  closeAccountPage();
  renderHistory();
  openAuthPage();
  toast("Logged out");
}

export function initAccount() {
  $$("[data-avatar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      avatarDraft = btn.dataset.avatar === "female" ? "female" : "male";
      paint();
    });
  });

  $("#saveProfileBtn")?.addEventListener("click", saveProfile);
  $("#cancelProfileBtn")?.addEventListener("click", closeAccountPage);
  $("#logoutBtn")?.addEventListener("click", doLogout);
  $("#syncNowBtn")?.addEventListener("click", async () => {
    const btn = $("#syncNowBtn");
    if (btn) btn.disabled = true;
    await syncNow();
    paint();
    if (btn) btn.disabled = !isSignedIn();
  });
  $("#accountSignInBtn")?.addEventListener("click", () => {
    closeAccountPage();
    openAuthPage();
  });

  $("#sidebarAccount")?.addEventListener("click", openAccountPage);
  $("#accountBtn")?.addEventListener("click", openAccountPage);
  $("#settingsAccountBtn")?.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("axon:close-pages"));
    openAccountPage();
  });

  document.addEventListener("axon:open-account", openAccountPage);
  document.addEventListener("axon:sync-changed", () => {
    if (!$("#accountPage")?.classList.contains("hidden")) paint();
  });
  document.addEventListener("axon:auth-changed", () => {
    paint();
    if (isSignedIn()) restoreFromCloud().then((r) => {
      if (!r.error && r.merged) toast(`${r.merged} conversation(s) restored`, "ok");
    });
  });
  document.addEventListener("axon:profile-changed", () => {
    refreshAccountChip();
  });
  document.addEventListener("axon:settings-changed", () => {
    if (!$("#accountPage")?.classList.contains("hidden")) paint();
  });

  paint();
}

export { paint as paintAccount };

>>>>>>> REMOTE (Changes from GitHub)
