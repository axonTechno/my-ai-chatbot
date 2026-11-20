const DB_NAME = "axon_videos_v1";
const STORE_NAME = "videos";
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
  return "vid_" + (crypto.randomUUID?.() || Date.now() + "_" + Math.random().toString(36).slice(2));
}

export async function saveVideo(file, metadata = {}) {
  if (!(file instanceof Blob)) throw new Error("Invalid video file.");
  const db = await openDB();
  const id = metadata.id || makeId();
  const record = {
    id,
    blob: file,
    chatId: metadata.chatId || "",
    messageId: metadata.messageId || "",
    name: metadata.name || file.name || "video.mp4",
    type: "video/mp4",
    size: file.size,
    createdAt: metadata.createdAt || Date.now()
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return id;
}

export async function getVideoBlob(id) {
  if (!id) return null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error);
  });
}
