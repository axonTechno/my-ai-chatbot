/* =========================================================
   AXON AI — voice.js
   Full-screen live voice interface.
   Works today with the device engines (speech recognition +
   speech synthesis). A realtime cloud voice service can be
   plugged in through VOICE_SERVICE_URL without touching the UI.
   ========================================================= */

import { VOICE_SERVICE_URL } from "./config.js";
import { store, persistSettings } from "./state.js";
import { $, toast } from "./ui.js";
import { sendMessage, activeChat, ensureChat } from "./chat.js";
import { buildHistory } from "./ai.js";
import { sendChat } from "./ai.js";
import { uid } from "./state.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const voice = {
  open: false,
  listening: false,
  speaking: false,
  recognition: null,
  stream: null,
  audioCtx: null,
  analyser: null,
  raf: null,
  socket: null,
  lastReply: "",
  permission: "unknown",
  busy: false
};

const LANG_MAP = {
  English: "en-US",
  Hindi: "hi-IN",
  Hinglish: "en-IN",
  Korean: "ko-KR",
  Tamil: "ta-IN",
  Urdu: "ur-PK"
};

function setState(text) {
  const el = $("#voiceState");
  if (el) el.textContent = text;
}

function setTranscript(text) {
  const el = $("#voiceTranscript");
  if (el) el.textContent = text;
}

function setReply(text) {
  const el = $("#voiceReply");
  if (el) el.textContent = text;
}

function setHint(text, isError = false) {
  const el = $("#voiceHint");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function orb() {
  return $("#voiceOrb");
}

function setOrbMode(mode) {
  const node = orb();
  if (!node) return;
  node.classList.toggle("listening", mode === "listening");
  node.classList.toggle("speaking", mode === "speaking");
}

/* ================= MIC LEVEL (visual only) ================= */

async function startLevelMeter() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voice.permission = "granted";
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return true;
    voice.audioCtx = new Ctx();
    const source = voice.audioCtx.createMediaStreamSource(voice.stream);
    voice.analyser = voice.audioCtx.createAnalyser();
    voice.analyser.fftSize = 256;
    source.connect(voice.analyser);
    const data = new Uint8Array(voice.analyser.frequencyBinCount);

    const tick = () => {
      if (!voice.analyser) return;
      voice.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const scale = 1 + Math.min(0.22, rms * 1.6);
      const node = orb();
      if (node) node.style.transform = `scale(${scale.toFixed(3)})`;
      voice.raf = requestAnimationFrame(tick);
    };
    voice.raf = requestAnimationFrame(tick);
    return true;
  } catch (err) {
    voice.permission = err && err.name === "NotAllowedError" ? "denied" : "error";
    return false;
  }
}

function stopLevelMeter() {
  if (voice.raf) cancelAnimationFrame(voice.raf);
  voice.raf = null;
  const node = orb();
  if (node) node.style.transform = "";
  if (voice.stream) {
    voice.stream.getTracks().forEach((t) => t.stop());
    voice.stream = null;
  }
  if (voice.audioCtx) {
    try {
      voice.audioCtx.close();
    } catch (e) {}
    voice.audioCtx = null;
  }
  voice.analyser = null;
}

/* ================= SPEECH OUTPUT ================= */

export function speak(text) {
  if (!("speechSynthesis" in window) || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.slice(0, 1200));
    utter.lang = LANG_MAP[store.settings.language] || "en-US";
    utter.rate = 1;
    utter.onstart = () => {
      voice.speaking = true;
      setOrbMode("speaking");
      setState("AXON is speaking…");
    };
    utter.onend = () => {
      voice.speaking = false;
      setOrbMode(voice.listening ? "listening" : "");
      setState(voice.listening ? "Listening…" : "Tap the microphone to speak");
    };
    utter.onerror = () => {
      voice.speaking = false;
      setOrbMode("");
    };
    window.speechSynthesis.speak(utter);
    return true;
  } catch (e) {
    return false;
  }
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
  voice.speaking = false;
  setOrbMode("");
}

/* ================= RECOGNITION ================= */

function startRecognition() {
  if (!SpeechRecognition) {
    setHint("Speech recognition is not available in this browser. You can still type, or use Chrome on Android.", true);
    setState("Voice input unavailable");
    return false;
  }
  try {
    const rec = new SpeechRecognition();
    rec.lang = LANG_MAP[store.settings.language] || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript(finalText || interim);
      if (finalText.trim()) {
        handleUtterance(finalText.trim());
      }
    };

    rec.onerror = (event) => {
      voice.listening = false;
      setOrbMode("");
      $("#voiceMicBtn")?.classList.remove("active");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        voice.permission = "denied";
        setHint("Microphone permission was blocked. Allow it in your browser settings and try again.", true);
        setState("Microphone blocked");
      } else if (event.error === "no-speech") {
        setState("I didn't catch that — tap and try again");
      } else if (event.error === "aborted") {
        setState("Tap the microphone to speak");
      } else {
        setHint(`Voice error: ${event.error}`, true);
        setState("Voice input failed");
      }
    };

    rec.onend = () => {
      voice.listening = false;
      $("#voiceMicBtn")?.classList.remove("active");
      if (!voice.busy && !voice.speaking) {
        setOrbMode("");
        setState("Tap the microphone to speak");
      }
    };

    rec.start();
    voice.recognition = rec;
    voice.listening = true;
    $("#voiceMicBtn")?.classList.add("active");
    setOrbMode("listening");
    setState("Listening…");
    setTranscript("");
    return true;
  } catch (err) {
    setHint("Could not start the microphone. Close other apps using it and retry.", true);
    return false;
  }
}

function stopRecognition() {
  if (voice.recognition) {
    try {
      voice.recognition.stop();
    } catch (e) {}
    voice.recognition = null;
  }
  voice.listening = false;
  $("#voiceMicBtn")?.classList.remove("active");
}

/* ================= ANSWER PIPELINE ================= */

async function handleUtterance(text) {
  if (voice.busy) return;
  voice.busy = true;
  stopRecognition();
  setState("Thinking…");
  setReply("");

  const chat = ensureChat();
  const history = buildHistory(chat.messages);

  /* keep the chat log in sync with what was spoken */
  chat.messages.push({
    id: uid("m"),
    role: "user",
    content: text,
    images: [],
    time: Date.now(),
    rating: null,
    error: null
  });
  if (chat.autoTitle) chat.title = text.length > 42 ? `${text.slice(0, 42)}…` : text;
  const assistant = {
    id: uid("m"),
    role: "assistant",
    content: "",
    images: [],
    time: Date.now(),
    rating: null,
    error: null
  };
  chat.messages.push(assistant);

  try {
    const result = await sendChat({ message: text, history, images: [] });
    assistant.content = result.text;
    voice.lastReply = result.text;
    setReply(result.text);
    setState("AXON is speaking…");
    speak(result.text);
  } catch (err) {
    assistant.error = { title: err.message || "Voice request failed", detail: "" };
    setState("Could not reach AXON");
    setHint(err.message || "The AI service could not answer.", true);
    setReply("");
  } finally {
    voice.busy = false;
    const { touchChat, persistChats } = await import("./state.js");
    touchChat(chat);
    persistChats();
    document.dispatchEvent(new CustomEvent("axon:chat-updated"));
  }
}

/* ================= OPTIONAL REALTIME SERVICE ================= */

function connectRealtime() {
  if (!VOICE_SERVICE_URL) return false;
  try {
    const url = VOICE_SERVICE_URL.replace(/^http/, "ws");
    voice.socket = new WebSocket(url);
    voice.socket.onopen = () => {
      setHint("Realtime voice service connected.");
      setState("Connected — tap the microphone to speak");
    };
    voice.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.transcript) setTranscript(data.transcript);
        if (data.reply) {
          setReply(data.reply);
          speak(data.reply);
        }
      } catch (e) {}
    };
    voice.socket.onerror = () => {
      setHint("Realtime voice service unavailable — using the device speech engine.", true);
    };
    return true;
  } catch (e) {
    return false;
  }
}

function disconnectRealtime() {
  if (voice.socket) {
    try {
      voice.socket.close();
    } catch (e) {}
    voice.socket = null;
  }
}

/* ================= OPEN / CLOSE ================= */

export async function openVoice() {
  const screen = $("#voiceScreen");
  if (!screen) return;
  voice.open = true;
  screen.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("#voiceBtn")?.classList.add("active");
  $("#voiceBtn")?.setAttribute("aria-label", "Close voice chat");
  setTranscript("");
  setReply("");
  setOrbMode("");

  const realtime = connectRealtime();
  if (!realtime) {
    setHint(
      SpeechRecognition
        ? "Tap the microphone and speak. AXON replies with your device voice."
        : "Speech input is not supported in this browser. You can still type in chat.",
      !SpeechRecognition
    );
  }

  setState("Preparing microphone…");
  const ok = await startLevelMeter();
  if (!ok) {
    if (voice.permission === "denied") {
      setHint("Microphone permission is blocked. Allow it in your browser settings to use voice chat.", true);
      setState("Microphone blocked");
    } else {
      setState("Tap the microphone to speak");
    }
  } else {
    setState("Tap the microphone to speak");
  }
}

export function closeVoice() {
  voice.open = false;
  stopRecognition();
  stopSpeaking();
  stopLevelMeter();
  disconnectRealtime();
  $("#voiceScreen")?.classList.add("hidden");
  document.body.style.overflow = "";
  $("#voiceBtn")?.classList.remove("active");
  $("#voiceBtn")?.setAttribute("aria-label", "Start voice chat");
  setState("Tap the microphone to speak");
  setTranscript("");
  setReply("");
  setOrbMode("");
}

export function toggleVoice() {
  if (voice.open) closeVoice();
  else openVoice();
}

/* ================= INIT ================= */

export function initVoice() {
  $("#voiceBtn")?.addEventListener("click", toggleVoice);
  $("#voiceCloseBtn")?.addEventListener("click", closeVoice);
  $("#welcomeVoiceBtn")?.addEventListener("click", openVoice);

  $("#voiceMicBtn")?.addEventListener("click", () => {
    if (voice.speaking) {
      stopSpeaking();
      return;
    }
    if (voice.listening) {
      stopRecognition();
      setState("Tap the microphone to speak");
      return;
    }
    if (voice.permission === "denied") {
      setHint("Microphone permission is blocked. Allow it in your browser settings, then reload AXON.", true);
      return;
    }
    startRecognition();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && voice.open) closeVoice();
  });

  document.addEventListener("axon:speak", (e) => {
    const text = e.detail && e.detail.text;
    if (text) speak(text);
  });
}

export { voice };
