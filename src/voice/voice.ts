// Voice prompts: either the browser's built-in speech recognition (free, live captions)
// or a recording sent to OpenAI / Gemini for transcription. Stops by itself after a pause.

import { transcribe } from "../ai/providers";
import type { Settings } from "../settings";

export interface VoiceHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onState: (state: "listening" | "transcribing" | "idle") => void;
}

export interface VoiceSession {
  stop: () => void;
  cancel: () => void;
}

const SILENCE_MS = 2200;
const MAX_MS = 120000;

export interface VoiceOptions {
  /** Hold-to-talk: keep listening until stop() is called, instead of stopping after a pause. */
  hold?: boolean;
}

export function startVoice(settings: Settings, h: VoiceHandlers, opts: VoiceOptions = {}): VoiceSession {
  return settings.voiceEngine === "browser" ? browserVoice(settings, h, opts) : recordedVoice(settings, h, opts);
}

function browserVoice(settings: Settings, h: VoiceHandlers, opts: VoiceOptions): VoiceSession {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) {
    h.onError("This browser has no built-in speech recognition. Pick OpenAI or Gemini as the voice engine in Settings.");
    h.onState("idle");
    return { stop() {}, cancel() {} };
  }
  const rec = new SR();
  rec.lang = settings.voiceLang || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let lastInterim = "";
  let cancelled = false;
  let timer: number | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => rec.stop(), opts.hold ? MAX_MS : SILENCE_MS);
  };
  rec.onresult = (ev: any) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    lastInterim = interim;
    h.onInterim((finalText + interim).trim());
    arm();
  };
  rec.onerror = (ev: any) => {
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    h.onError(ev.error === "not-allowed" ? "Microphone access was blocked." : `Speech recognition error: ${ev.error}`);
  };
  rec.onend = () => {
    clearTimeout(timer);
    h.onState("idle");
    // words still being recognised when the user let go count too
    const text = (finalText + lastInterim).trim();
    if (!cancelled && text) h.onFinal(text);
  };
  rec.start();
  h.onState("listening");
  timer = window.setTimeout(() => rec.stop(), opts.hold ? MAX_MS : 8000); // stop if nothing is said
  return {
    stop: () => rec.stop(),
    cancel: () => { cancelled = true; rec.abort(); },
  };
}

function recordedVoice(settings: Settings, h: VoiceHandlers, opts: VoiceOptions): VoiceSession {
  let cancelled = false;
  let stopRequested = false;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let raf = 0;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      h.onError("Microphone access was blocked.");
      h.onState("idle");
      return;
    }
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      cleanup();
      if (cancelled || !chunks.length) return h.onState("idle");
      h.onState("transcribing");
      try {
        const blob = new Blob(chunks, { type: recorder!.mimeType || "audio/webm" });
        const text = await transcribe(settings, blob, settings.voiceEngine as "openai" | "gemini");
        if (text) h.onFinal(text);
      } catch (e: any) {
        h.onError(`Transcription failed: ${e.message ?? e}`);
      }
      h.onState("idle");
    };
    recorder.start();
    h.onState("listening");
    h.onInterim(opts.hold ? "Listening… release to finish" : "Listening… (stops after a short pause)");
    // the user may have let go while the microphone permission prompt was open
    if (stopRequested || cancelled) {
      recorder.stop();
      return;
    }

    // simple silence detection
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    let lastLoud = performance.now();
    let spoke = false;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.035) { lastLoud = now; spoke = true; }
      const quietFor = now - lastLoud;
      const autoStop = !opts.hold && ((spoke && quietFor > SILENCE_MS) || (!spoke && now - startedAt > 8000));
      if (autoStop || now - startedAt > MAX_MS) {
        if (recorder?.state === "recording") recorder.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  })();

  return {
    stop: () => {
      stopRequested = true;
      if (recorder?.state === "recording") recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      if (recorder?.state === "recording") recorder.stop();
      else cleanup();
    },
  };
}
