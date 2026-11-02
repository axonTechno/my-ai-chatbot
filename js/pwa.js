/* =========================================================
   AXON AI — pwa.js
   Service-worker registration + update prompt.
   ========================================================= */

import { toast, confirmDialog } from "./ui.js";

let waitingWorker = null;
let refreshing = false;

export function initPWA() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js", { scope: "./" })
      .then((reg) => {
        if (reg.waiting) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              offerUpdate(installing);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[axon] service worker registration failed", err);
      });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

async function offerUpdate(worker) {
  waitingWorker = worker;
  const ok = await confirmDialog({
    title: "Update available",
    text: "A newer version of AXON is ready. Reload now to use it?",
    okLabel: "Reload",
    danger: false
  });
  if (ok && waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }
}

export function applyUpdateNow() {
  if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" });
  else window.location.reload();
}

/* Online / offline awareness */
export function initNetworkWatcher() {
  window.addEventListener("offline", () => toast("You are offline — messages will be queued", "error"));
  window.addEventListener("online", () => {
    toast("Back online", "ok");
    document.dispatchEvent(new CustomEvent("axon:online"));
  });
}
