/* AXON AI — Your Images gallery */

import { listImages, getImageURL, getImageBlob, deleteImage } from "./image-store.js";
import { store, persistChats } from "./state.js";
import { $, toast, confirmDialog, openImageViewer, closeImageViewer } from "./ui.js";
import { openPage } from "./settings.js";

let objectUrls = [];
let activeCategory = "generated";

function clearObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function getImageCategory(record) {
  for (const chat of store.chats || []) {
    for (const message of chat.messages || []) {
      if (message.generatedImageId === record.id) return "generated";
      if ((message.images || []).some((image) => image.imageId === record.id)) return "uploaded";
    }
  }
  return record.category === "generated" ? "generated" : "uploaded";
}

function removeImageReference(record) {
  let changed = false;

  for (const chat of store.chats || []) {
    for (const message of chat.messages || []) {
      if (
        message.generatedImageId === record.id &&
        (!record.messageId || message.id === record.messageId)
      ) {
        message.generatedImageId = "";
        message.generatedImage = "";
        changed = true;
      }

      const oldImages = message.images || [];
      message.images = oldImages.filter((image) => image.imageId !== record.id);
      if (message.images.length !== oldImages.length) changed = true;
    }
  }

  if (changed) persistChats();
  return changed;
}

async function openGalleryImage(record, url) {
  openImageViewer(url, record.prompt || record.name || "Saved image", {
    onDownload: async () => {
      try {
        const blob = await getImageBlob(record.id);
        if (!blob) throw new Error("Image not found.");
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = record.name || "axon-image";
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      } catch (error) {
        toast("Could not download this image.", "error");
      }
    },
    onShare: async () => {
      try {
        const blob = await getImageBlob(record.id);
        if (!blob) throw new Error("Image not found.");
        const file = new File([blob], record.name || "axon-image.png", {
          type: blob.type || "image/png"
        });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({ files: [file], title: "AXON Image" });
        } else {
          toast("Image sharing is not supported on this device.", "error");
        }
      } catch (error) {
        if (error.name !== "AbortError") toast("Could not share this image.", "error");
      }
    },
    onDelete: async () => {
      const confirmed = await confirmDialog({
        title: "Delete image?",
        text: "This image will be removed from Your Images and its original chat.",
        okLabel: "Delete",
        danger: true
      });
      if (!confirmed) return;

      try {
        await deleteImage(record.id);
        removeImageReference(record);
        closeImageViewer();
        toast("Image deleted.");
        await renderGallery();
        document.dispatchEvent(new CustomEvent("axon:chat-updated"));
      } catch (error) {
        console.error("[axon] Image deletion failed", error);
        toast("Could not delete this image.", "error");
      }
    }
  });
}

export async function renderGallery() {
  const grid = $("#galleryGrid");
  const empty = $("#galleryEmpty");
  const count = $("#galleryCount");
  if (!grid) return;

  clearObjectUrls();
  grid.replaceChildren();

  try {
    const allRecords = await listImages();
    const records = allRecords.filter((record) => getImageCategory(record) === activeCategory);

    if (count) count.textContent = `${records.length} ${records.length === 1 ? "image" : "images"}`;
    if (empty) empty.classList.toggle("hidden", records.length > 0);

    for (const record of records) {
      const url = await getImageURL(record.id);
      if (!url) continue;

      objectUrls.push(url);

      const card = document.createElement("button");
      card.type = "button";
      card.className = "gallery-card";
      card.setAttribute("aria-label", record.prompt || record.name || "Open image");

      const img = document.createElement("img");
      img.src = url;
      img.alt = record.prompt || record.name || "Saved image";
      img.loading = "lazy";

      const caption = document.createElement("span");
      caption.className = "gallery-caption";
      caption.textContent = record.prompt || record.name || "Saved image";

      card.append(img, caption);
      card.addEventListener("click", () => openGalleryImage(record, url));

      grid.appendChild(card);
    }

    if (empty) empty.classList.toggle("hidden", grid.children.length > 0);
    if (count) count.textContent = `${grid.children.length} ${grid.children.length === 1 ? "image" : "images"}`;
  } catch (error) {
    console.error("[axon] Gallery load failed", error);
    toast("Could not load your images.", "error");
  }
}

export function openGallery() {
  openPage("#galleryPage");
  renderGallery();
}

export function initGallery() {
  document.querySelectorAll("[data-gallery-filter]").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeCategory = tab.dataset.galleryFilter;
      document.querySelectorAll("[data-gallery-filter]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      renderGallery();
    });
  });
  $("#yourImagesBtn")?.addEventListener("click", openGallery);
  $("#galleryBackBtn")?.addEventListener("click", () => {
    $("#galleryPage")?.classList.add("hidden");
  });

  document.addEventListener("axon:chat-updated", () => {
    if (!$("#galleryPage")?.classList.contains("hidden")) renderGallery();
  });
}

export { removeImageReference };
