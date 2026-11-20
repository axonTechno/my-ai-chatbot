/* AXON AI — dedicated, chat-independent image generation screen */
import { $, toast } from "./ui.js";
import { openPage } from "./settings.js";
import { closeSidebar } from "./sidebar.js";
import { generateImage } from "./ai.js";
import { saveImage } from "./image-store.js";

export function initImageGenerator() {
  const page = $("#imageGeneratorPage");
  const promptInput = $("#imageGeneratorPrompt");
  const form = $("#imageGeneratorForm");
  if (!page || !promptInput || !form) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const note = $("#imageGeneratorNote");

  const resultPanel = $("#imageGeneratorResult");
  const resultImage = $("#imageGeneratorResultImage");

  function resetGeneratorScreen() {
    if (resultPanel) {
      resultPanel.classList.add("hidden");
      resultPanel.classList.remove("is-loading");
    }
    if (resultImage) {
      resultImage.removeAttribute("src");
      resultImage.style.aspectRatio = "";
    }
    promptInput.value = "";
    if (note) note.textContent = "Your generated image will be saved in Your Images.";
    if (submitButton) submitButton.disabled = false;
  }

  $("#generateImagesBtn")?.addEventListener("click", () => {
    closeSidebar();
    resetGeneratorScreen();
    openPage("#imageGeneratorPage");
    promptInput.focus({ preventScroll: true });
  });

  $("#imageGeneratorBackBtn")?.addEventListener("click", () => {
    resetGeneratorScreen();
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
    if (resultPanel) {
      resultPanel.classList.remove("hidden");
      resultPanel.classList.add("is-loading");
    }
    if (resultImage) resultImage.removeAttribute("src");
    if (note) note.textContent = "Generating your image…";

    try {
      const result = await generateImage({ prompt });
      if (!result?.image) throw new Error("The image service returned no image.");

      await saveImage(result.image, {
        category: "generated",
        prompt,
        name: prompt.slice(0, 80)
      });

      if (resultImage) {
        resultImage.onload = () => {
          resultImage.style.aspectRatio = resultImage.naturalWidth + " / " + resultImage.naturalHeight;
          resultPanel?.classList.remove("is-loading");
        };
        resultImage.src = result.image;
      } else {
        resultPanel?.classList.remove("is-loading");
      }
      if (note) note.textContent = "Saved in Your Images.";
      promptInput.value = "";
      toast("Image saved in Your Images.");
    } catch (error) {
      console.error("[axon] Standalone image generation failed", error);
      if (resultPanel) {
        resultPanel.classList.add("hidden");
        resultPanel.classList.remove("is-loading");
      }
      toast(error?.message || "Image generation failed. Please try again.", "error");
      if (note) note.textContent = "Your generated image will be saved in Your Images.";
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
