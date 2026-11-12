const DB_NAME = "axon_images_v1";
const STORE_NAME = "images";
let dbPromise;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("chatId", "chatId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function makeId() {
  return "img_" + (
    crypto.randomUUID?.() || Date.now() + "_" + Math.random().toString(36).slice(2)
  );
}

function toBlob(source) {
  if (source instanceof Blob) return Promise.resolve(source);
  if (typeof source !== "string" || !source.startsWith("data:image/")) {
    return Promise.reject(new Error("Invalid image data."));
  }
  return fetch(source).then((response) => response.blob());
}

export async function saveImage(source, metadata = {}) {
  const db = await openDB();
  const blob = await toBlob(source);
  const record = {
    id: metadata.id || makeId(),
    blob,
    chatId: metadata.chatId || "",
    messageId: metadata.messageId || "",
    prompt: metadata.prompt || "",
    name: metadata.name || "",
    category: metadata.category || "",
    createdAt: metadata.createdAt || Date.now(),
    type: blob.type || "image/png"
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  return record.id;
}

export async function getImageBlob(id) {
  if (!id) return null;
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getImageURL(id) {
  const blob = await getImageBlob(id);
  return blob ? URL.createObjectURL(blob) : "";
}

export async function listImages() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImage(id) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function migrateLegacyImages(chats) {
  let migrated = 0;

  for (const chat of chats || []) {
    for (const message of chat.messages || []) {
      try {
        if (
          typeof message.generatedImage === "string" &&
          message.generatedImage.startsWith("data:image/") &&
          !message.generatedImageId
        ) {
          message.generatedImageId = await saveImage(message.generatedImage, {
            chatId: chat.id,
            messageId: message.id,
            category: "generated",
            prompt: message.imagePrompt || ""
          });
          message.generatedImage = "";
          migrated++;
        }

        for (const image of message.images || []) {
          if (image?.dataUrl?.startsWith("data:image/") && !image.imageId) {
            image.imageId = await saveImage(image.dataUrl, {
              chatId: chat.id,
              messageId: message.id,
              category: "uploaded",
              name: image.name || ""
            });
            image.dataUrl = "";
            migrated++;
          }
        }
      } catch (error) {
        console.warn("[axon] image migration failed; original data retained", error);
      }
    }
  }

  return migrated;
}
