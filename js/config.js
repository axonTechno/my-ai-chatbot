/* =========================================================
   AXON AI — config.js
   Single place for every endpoint / model / feature flag.
   Nothing secret lives here: only public Worker routes.
   Change a URL here (or via Settings → Advanced) and every
   service in the app follows automatically.
   ========================================================= */

export const APP_VERSION = "2.1.0";
export const APP_NAME = "AXON AI";

/* Cloudflare Worker that proxies the AI provider. */
export const DEFAULT_WORKER_URL = "https://axon-api-staging.axontechno.workers.dev/";

/* Model catalogue. IDs are sent to the Worker as `model`.
   The current Worker resolves both options to NVIDIA Nemotron 3.5 Super VL. */
export const MODELS = [
  {
    id: "auto",
    label: "AXON Auto",
    description: "Automatically uses the best configured AXON model",
    fallback: false,
    free: true
  },
  {
    id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    label: "NVIDIA Nemotron 3.5 Super VL 120B A12B",
    description: "Reasoning · Coding · Image & Video Understanding",
    fallback: false,
    free: true,
    vision: true,
    video: true,
    reasoning: true
  }
];

export const DEFAULT_MODEL = "auto";

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

/* Routes on the AI Worker. */
export const AI_ROUTES = {
  chat: "",
  health: "health",
  models: "models"
};

/* Optional account / sync backend (Supabase-compatible REST contract).
   Empty = local-only mode, no fake logins. See BACKEND.md. */
export const BACKEND = {
  baseUrl: DEFAULT_WORKER_URL,
  authBase: DEFAULT_WORKER_URL,
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
