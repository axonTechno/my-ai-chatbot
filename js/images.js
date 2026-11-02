/* =========================================================
   AXON AI — images.js
   Attachment pipeline: validate, downscale, compress, preview.
   ========================================================= */

import { REQUEST } from "./config.js";

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be opened."));
    img.src = src;
  });
}

/**
 * Compress an image file into a JPEG/PNG data URL.
 * Keeps small images untouched; downscales large ones to `imageMaxEdge`.
 */
export async function compressImage(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported.");
  }
  if (file.size > REQUEST.maxImageBytes) {
    throw new Error("That image is too large (max 12 MB).");
  }

  const original = await readAsDataURL(file);

  /* GIFs keep animation only when untouched. */
  if (file.type === "image/gif" && file.size < 1.5 * 1024 * 1024) {
    return { dataUrl: original, name: file.name, size: file.size, type: file.type };
  }

  try {
    const img = await loadImage(original);
    const maxEdge = REQUEST.imageMaxEdge;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const needsResize = scale < 1;
    const needsRecompress = file.size > 400 * 1024;

    if (!needsResize && !needsRecompress) {
      return { dataUrl: original, name: file.name, size: file.size, type: file.type };
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const hasAlpha = /png|webp/i.test(file.type);
    const type = hasAlpha ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(type, REQUEST.imageQuality);
    return {
      dataUrl,
      name: file.name,
      size: Math.round((dataUrl.length * 3) / 4),
      type,
      width: canvas.width,
      height: canvas.height
    };
  } catch (e) {
    /* Canvas unavailable — send the original rather than failing. */
    return { dataUrl: original, name: file.name, size: file.size, type: file.type };
  }
}

export async function prepareFiles(fileList) {
  const files = Array.from(fileList || []);
  const results = [];
  const errors = [];
  for (const file of files) {
    try {
      results.push(await compressImage(file));
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }
  return { images: results, errors };
}
