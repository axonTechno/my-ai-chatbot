/* AXON AI — dedicated, chat-independent image generation screen */
import { $, toast } from "./ui.js";
import { openPage } from "./settings.js";
import { closeSidebar } from "./sidebar.js";
import { generateImage } from "./ai.js";
import { saveImage } from "./image-store.js";
import { openGeneratedGallery } from "./gallery.js";

export function initImageGenerator() {
  const page = $("#imageGeneratorPage");
  const promptInput = $("#imageGeneratorPrompt");
  const form = $("#imageGeneratorForm");
  if (!page || !promptInput || !form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const note = $("#imageGeneratorNote");

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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt) {
      toast("Enter an image prompt first.");
      promptInput.focus();
      return;
    }
    if (submitButton?.disabled) return;

    if (submitButton) submitButton.disabled = true;
    if (note) note.textContent = "Creating your image…";

    try {
      const result = await generateImage({ prompt });
      if (!result?.image) throw new Error("The image service returned no image.");

      await saveImage(result.image, {
        category: "generated",
        prompt,
        name: prompt.slice(0, 80)
      });

      promptInput.value = "";
      page.classList.add("hidden");
      document.dispatchEvent(new CustomEvent("axon:page-closed"));
      openGeneratedGallery();
      toast("Image saved in Your Images.");
    } catch (error) {
      console.error("[axon] Standalone image generation failed", error);
      toast(error?.message || "Image generation failed. Please try again.", "error");
      if (note) note.textContent = "Your generated image will be saved in Your Images.";
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
