/* =========================================================
   AXON AI — account.js
   Account screen: avatar, name, email, sync status, logout.
   ========================================================= */

import { store, persistProfile, persistSettings } from "./state.js";
import { $, $$, toast, confirmDialog } from "./ui.js";
import { refreshAccountChip, renderHistory } from "./sidebar.js";
import { isSignedIn, backendConfigured, queueOutbox, pushProfile, session } from "./backend.js";
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

function paint({ preserveAvatarDraft = false } = {}) {
  const savedAvatar = store.profile.avatar === "female" ? "female" : "male";
  const avatar = preserveAvatarDraft && (avatarDraft === "female" || avatarDraft === "male")
    ? avatarDraft
    : savedAvatar;
  if (!preserveAvatarDraft) avatarDraft = savedAvatar;
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
  const bioInput = $("#profileBioInput");
  if (bioInput) bioInput.value = store.profile.bio || "";
  const currentEmail = $("#currentAccountEmail");
  if (currentEmail) currentEmail.textContent = isSignedIn() ? session().email : "Not signed in";

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

function showAccountPage(pageId) {
  document.querySelectorAll(".full-page").forEach((page) => page.classList.add("hidden"));
  const page = document.getElementById(pageId);
  if (!page) return;
  page.classList.remove("hidden");
  page.scrollTop = 0;
  const content = page.querySelector(".page-content");
  if (content) content.scrollTop = 0;
}

export function openAccountPage() {
  paint();
  showAccountPage("accountPage");
}

export function closeAccountPage() {
  $("#accountPage")?.classList.add("hidden");
}

export function openAccountAccessPage() {
  paint();
  showAccountPage("accountAccessPage");
}

async function saveProfile() {
  const nameInput = $("#profileNameInput");
  const name = (nameInput?.value || "").trim().slice(0, 60);
  store.profile.name = name;
  store.profile.avatar = avatarDraft;
  store.profile.bio = ($("#profileBioInput")?.value || "").trim().slice(0, 240);
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

  // Do not wait for a network outbox flush here: it made logout feel slow.
  // Local sign-out is immediate; pending items remain available for a later sync.
  signOut();
  closeAccountPage();
  $("#accountAccessPage")?.classList.add("hidden");
  openAuthPage();
  toast("Logged out");
}

export function initAccount() {
  $("[data-avatar]") && $$("[data-avatar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      avatarDraft = btn.dataset.avatar === "female" ? "female" : "male";
      paint({ preserveAvatarDraft: true });
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
  $("#switchAccountBtn")?.addEventListener("click", () => {
    $("#accountAccessPage")?.classList.add("hidden");
    openAuthPage();
  });
  $("#accountLogoutBtn")?.addEventListener("click", doLogout);

  $("#sidebarAccount")?.addEventListener("click", openAccountPage);
  $("#accountBtn")?.addEventListener("click", openAccountAccessPage);
  $("#settingsAccountBtn")?.addEventListener("click", () => {
    openAccountAccessPage();
  });

  const backButton = $("#accountPage button[data-back]");
  if (backButton) backButton.addEventListener("click", closeAccountPage);
  const accountBackButton = $("#accountAccessPage button[data-back]");
  if (accountBackButton) accountBackButton.addEventListener("click", () => $("#accountAccessPage")?.classList.add("hidden"));

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
