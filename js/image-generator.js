/* AXON AI — dedicated image generation screen */
import { $, toast } from "./ui.js";
import { openPage, closeAllPages } from "./settings.js";
import { closeSidebar } from "./sidebar.js";

export function initImageGenerator() {
  const page = $("#imageGeneratorPage");
  const promptInput = $("#imageGeneratorPrompt");
  const form = $("#imageGeneratorForm");
  if (!page || !promptInput || !form) return;

  $("#generateImagesBtn")?.addEventListener("click", () => {
    closeSidebar();
    openPage("#imageGeneratorPage");
    promptInput.focus({ preventScroll: true });
  });

  $("#imageGeneratorBackBtn")?.addEventListener("click", () => {
    page.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("axon:page-closed"));
  });

  document.querySelectorAll("[data-image-prompt]").forEach((chip) => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.imagePrompt || "";
      promptInput.focus();
      promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) {
      toast("Enter an image prompt first.");
      promptInput.focus();
      return;
    }

    const chatInput = $("#messageInput");
    const sendButton = $("#sendBtn");
    if (!chatInput || !sendButton) {
      toast("The image composer is unavailable. Please refresh AXON.", "error");
      return;
    }

    closeAllPages();
    closeSidebar();
    document.dispatchEvent(new CustomEvent("axon:page-closed"));
    chatInput.value = `Generate an image: ${prompt}`;
    chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    sendButton.click();
    promptInput.value = "";
  });
}
