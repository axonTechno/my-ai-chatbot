/* =========================================================
   AXON AI — config.js
   Single place for every endpoint / model / feature flag.
   Nothing secret lives here: only public Worker routes.
   Change a URL here (or via Settings → Advanced) and every
   service in the app follows automatically.
   ========================================================= */

export const APP_VERSION = "2.1.0";
export const APP_NAME = "AXON AI";

/* Cloudflare Worker that proxies the AI provider (existing integration). */
export const DEFAULT_WORKER_URL = "https://axon-api-staging.axontechno.workers.dev/";

/* Model catalogue. `id` is sent to the Worker as `model`.
   `fallback: true` models are tried automatically when the primary fails. */
export const MODELS = [
  {
    id: "auto",
    label: "AXON Auto",
    description: "Picks the best available free model",
    fallback: false,
    free: true
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B",
    description: "OpenRouter free tier",
    fallback: true,
    free: true
  },
  {
    id: "google/gemma-2-9b-it:free",
    label: "Gemma 2 9B",
    description: "OpenRouter free tier",
    fallback: true,
    free: true
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    label: "Mistral 7B",
    description: "OpenRouter free tier",
    fallback: true,
    free: true
  }
];

export const DEFAULT_MODEL = "auto";

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

/* Routes on the AI Worker. Only `chat` is known to exist today; the rest are
   probed at runtime and reported as "not connected" until deployed. */
export const AI_ROUTES = {
  chat: "",
  health: "health",
  models: "models"
};

/* Optional account / sync backend (Supabase-compatible REST contract).
   Empty = local-only mode, no fake logins. See BACKEND.md. */
export const BACKEND = {
  baseUrl: "",
  authBase: "",
  storageKey: "axon_session_v1"
};

/* Optional voice service (WebSocket). Empty = device speech engine only. */
export const VOICE_SERVICE_URL = "";

/* Optional support inbox endpoint for Help & Issues. Empty = stored locally. */
export const SUPPORT_ENDPOINT = "";

/* Request tuning */
export const REQUEST = {
  timeoutMs: 90000,
  healthTimeoutMs: 12000,
  maxRetries: 2,
  retryStatuses: [408, 425, 429, 500, 502, 503, 504],
  maxImages: 5,
  maxImageBytes: 12 * 1024 * 1024,
  imageMaxEdge: 1400,
  imageQuality: 0.82
};

export const LANGUAGES = ["English", "Hindi", "Hinglish", "Korean", "Tamil", "Urdu"];

export const RESPONSE_STYLES = {
  concise: "Keep answers short and to the point (2-4 sentences unless code is needed).",
  balanced: "Give clear, well-structured answers with just enough detail.",
  detailed: "Give thorough, well-structured answers with examples and detail."
};
