/* AXON AI — dedicated, chat-independent image generation screen */
import { $, toast, openImageViewer } from "./ui.js";
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
  const actionBar = $("#imageGeneratorActions");
  let currentPrompt = "";

  async function createImage(prompt) {
    if (submitButton) submitButton.disabled = true;
    actionBar?.classList.add("hidden");
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
          actionBar?.classList.remove("hidden");
        };
        resultImage.src = result.image;
      }
      if (note) note.textContent = "Saved in Your Images.";
      toast("Image saved in Your Images.");
      return result.image;
    } catch (error) {
      console.error("[axon] Standalone image generation failed", error);
      if (resultPanel) {
        resultPanel.classList.add("hidden");
        resultPanel.classList.remove("is-loading");
      }
      if (note) note.textContent = "Your generated image will be saved in Your Images.";
      toast(error?.message || "Image generation failed. Please try again.", "error");
      return null;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function resetGeneratorScreen() {
    if (resultPanel) {
      resultPanel.classList.add("hidden");
      resultPanel.classList.remove("is-loading");
    }
    if (resultImage) {
      resultImage.removeAttribute("src");
      resultImage.style.aspectRatio = "";
    }
    actionBar?.classList.add("hidden");
    currentPrompt = "";
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
    currentPrompt = prompt;
    const image = await createImage(prompt);
    if (image) promptInput.value = "";
  });

  resultImage?.addEventListener("click", () => {
    if (resultImage.src) openImageViewer(resultImage.src, currentPrompt || "Generated image");
  });

  $("#imageGeneratorSave")?.addEventListener("click", () => {
    if (!resultImage?.src) return;
    const link = document.createElement("a");
    link.href = resultImage.src;
    link.download = (currentPrompt || "axon-image").slice(0, 70).replace(/[^a-z0-9-_]+/gi, "-") + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  $("#imageGeneratorShare")?.addEventListener("click", async () => {
    if (!resultImage?.src) return;
    try {
      const response = await fetch(resultImage.src);
      const blob = await response.blob();
      const file = new File([blob], "axon-generated-image.png", { type: blob.type || "image/png" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: "AXON generated image" });
      } else {
        toast("Sharing is not supported on this device.", "error");
      }
    } catch (error) {
      if (error?.name !== "AbortError") toast("Could not share this image.", "error");
    }
  });

  $("#imageGeneratorRetry")?.addEventListener("click", async () => {
    if (!currentPrompt || submitButton?.disabled) return;
    await createImage(currentPrompt);
  });
}
}