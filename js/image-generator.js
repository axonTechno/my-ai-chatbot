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
  const promptSuggestions = page.querySelector(".image-prompt-suggestions");

  const resultPanel = $("#imageGeneratorResult");
  const resultImage = $("#imageGeneratorResultImage");
  const actionBar = $("#imageGeneratorActions");
  let currentPrompt = "";
  const artwork = page.querySelector(".image-generator-welcome");
  const heading = page.querySelector(".generate-instant-nav-title");

  function setGeneratingView(active) {
    page.classList.toggle("is-generating", active);
    page.classList.remove("has-result");
  }

  function fitResultToImage(width, height) {
    if (!resultPanel || !width || !height) return;
    const maxWidth = Math.min(window.innerWidth * 0.86, 480);
    const maxHeight = window.innerHeight * 0.52;
    const scale = Math.min(maxWidth / width, maxHeight / height);
    resultPanel.style.width = Math.round(width * scale) + "px";
    resultPanel.style.height = Math.round(height * scale) + "px";
    resultPanel.style.aspectRatio = width + " / " + height;
  }

  async function createImage(prompt) {
    promptSuggestions?.classList.add("hidden");
    setGeneratingView(true);
    if (submitButton) submitButton.disabled = true;
    actionBar?.classList.add("hidden");
    if (resultPanel) {
      resultPanel.classList.remove("hidden");
      resultPanel.classList.add("is-loading");
    }
    if (resultImage) resultImage.removeAttribute("src");
    note?.classList.add("hidden");

    try {
      const result = await generateImage({ prompt });
      if (!result?.image) throw new Error("The image service returned no image.");
      const dimensionsProbe = new Image();
      await new Promise((resolve, reject) => {
        dimensionsProbe.onload = resolve;
        dimensionsProbe.onerror = reject;
        dimensionsProbe.src = result.image;
      });
      fitResultToImage(dimensionsProbe.naturalWidth, dimensionsProbe.naturalHeight);
      await saveImage(result.image, {
        category: "generated",
        prompt,
        name: prompt.slice(0, 80)
      });
      if (resultImage) {
        resultImage.onload = () => {
          fitResultToImage(resultImage.naturalWidth, resultImage.naturalHeight);
          resultPanel?.classList.remove("is-loading");
          page.classList.remove("is-generating");
          page.classList.add("has-result");
          actionBar?.classList.remove("hidden");
        };
        resultImage.src = result.image;
      }
      if (note) {
        note.textContent = "Saved in Your Images.";
        note.classList.remove("hidden");
      }
      toast("Image saved in Your Images.");
      return result.image;
    } catch (error) {
      console.error("[axon] Standalone image generation failed", error);
      setGeneratingView(false);
      if (resultPanel) {
        resultPanel.classList.add("hidden");
        resultPanel.classList.remove("is-loading");
      }
      if (note) {
        note.textContent = "Your generated image will be saved in Your Images.";
        note.classList.remove("hidden");
      }
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
      resultPanel.style.width = "";
      resultPanel.style.height = "";
      resultPanel.style.aspectRatio = "";
    }
    setGeneratingView(false);
    if (resultImage) {
      resultImage.removeAttribute("src");
      resultImage.style.aspectRatio = "";
    }
    actionBar?.classList.add("hidden");
    currentPrompt = "";
    promptInput.value = "";
    promptSuggestions?.classList.remove("hidden");
    if (note) {
      note.textContent = "Your generated image will be saved in Your Images.";
      note.classList.remove("hidden");
    }
    if (submitButton) submitButton.disabled = false;
  }

  $("#generateImagesBtn")?.addEventListener("click", () => {
    closeSidebar();
    resetGeneratorScreen();
    openPage("#imageGeneratorPage");
    promptInput.focus({ preventScroll: true });
  });

  $("#openYourImagesFromGenerator")?.addEventListener("click", () => {
    openPage("#galleryPage");
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
    promptInput.value = "";
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    await createImage(prompt);
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
