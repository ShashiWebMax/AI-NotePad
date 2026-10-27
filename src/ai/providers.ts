// Direct browser calls to each AI provider. Keys never leave this browser except to the provider.

import Anthropic from "@anthropic-ai/sdk";
import type { ImageProvider, Settings, TextProvider } from "../settings";

export interface InputImage {
  mime: string;
  b64: string;
}

export interface ChatRequest {
  system: string;
  text: string;
  images: InputImage[];
  json?: boolean;
  signal?: AbortSignal;
  /** called when the chosen model failed and another one answered instead */
  onFallback?: (from: string, to: string, reason: string) => void;
}

// Gemini models tried, in order, when the selected one is overloaded, retired or not on the key's plan.
const GEMINI_BACKUPS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-lite-latest"];
const GEMINI_ATTEMPT_MS = 75_000;

/** Errors worth trying another model for (as opposed to bad keys or bad requests). */
function modelUnavailable(e: any) {
  const m = String(e?.message ?? e);
  return e?.name === "TimeoutError" || /overloaded|high demand|unavailable|no longer available|not found|free tier|quota|limit: 0|503|500/i.test(m);
}

const need = (key: string, provider: string) => {
  if (!key) throw new Error(`Add your ${provider} API key in Settings first.`);
  return key;
};

async function readError(res: Response, kind: "text" | "image" = "text") {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    msg = body?.error?.message || body?.error || body?.message || JSON.stringify(body);
  } catch {
    /* not JSON */
  }
  let text = typeof msg === "string" ? msg : JSON.stringify(msg);
  if (/free_tier/i.test(text) && /limit: 0/.test(text)) {
    text =
      kind === "image"
        ? "Gemini image generation isn't included in the free tier of your key. Turn on billing for the key in " +
          "Google AI Studio, or add an OpenAI or OpenRouter key and choose it under Image generation in Settings."
        : "This Gemini model isn't included in your key's free tier. In Settings, pick a Flash model " +
          "(e.g. gemini-3.5-flash), or turn on billing for the key in Google AI Studio to use Pro models.";
  } else if (res.status === 404 || /no longer available|not found|does not exist|deprecated/i.test(text)) {
    text += "\n\nTip: open Settings and click “Load list” to pick a model your key can use.";
  }
  return new Error(text);
}

// Retries temporary failures (overloaded / rate limited / server errors) with short waits.
async function fetchRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    res = await fetch(url, init);
    if (![429, 500, 502, 503, 504].includes(res.status)) return res;
    if (res.status === 429) {
      // a hard quota of 0 will never succeed, don't wait for it
      const peek = await res.clone().text();
      if (/limit: 0/.test(peek)) return res;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * 2 ** i + Math.random() * 500));
  }
  return res!;
}

// Gemini thinks a lot by default, which is slow during a call: use light thinking unless asked otherwise.
function geminiThinking(model: string, effort: Settings["effort"]) {
  const level = effort === "default" ? "low" : effort;
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: { low: 1024, medium: 4096, high: 16384 }[level] };
  return { thinkingLevel: level };
}

// Models that accept Anthropic's server-side refusal fallback.
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

function anthropicClient(key: string) {
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
}

export async function chat(settings: Settings, req: ChatRequest, provider: TextProvider = settings.textProvider): Promise<string> {
  const model = settings.textModels[provider];
  switch (provider) {
    case "anthropic": {
      const client = anthropicClient(need(settings.keys.anthropic, "Anthropic"));
      const params: any = {
        model,
        max_tokens: 32000,
        system: req.system,
        messages: [
          {
            role: "user",
            content: [
              ...req.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.b64 } })),
              { type: "text", text: req.text },
            ],
          },
        ],
      };
      if (settings.effort !== "default") params.output_config = { effort: settings.effort };
      const msg: any = FALLBACK_MODELS.test(model)
        ? await client.beta.messages
            .stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as any, { signal: req.signal })
            .finalMessage()
        : await client.messages.stream(params, { signal: req.signal }).finalMessage();
      if (msg.stop_reason === "refusal") {
        throw new Error(`Claude declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : "."}`);
      }
      return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }

    case "openai":
    case "openrouter": {
      const isOR = provider === "openrouter";
      const key = need(isOR ? settings.keys.openrouter : settings.keys.openai, isOR ? "OpenRouter" : "OpenAI");
      const url = isOR ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
      const body: any = {
        model,
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: [
              { type: "text", text: req.text },
              ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.b64}` } })),
            ],
          },
        ],
      };
      if (isOR) body.max_tokens = 16000;
      else body.max_completion_tokens = 32000;
      if (req.json && !isOR) body.response_format = { type: "json_object" };
      if (!isOR && settings.effort !== "default" && /^(gpt-5|o\d)/.test(model)) body.reasoning_effort = settings.effort;
      const res = await fetchRetry(url, {
        method: "POST",
        signal: req.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(isOR ? { "HTTP-Referer": location.origin, "X-Title": "SketchNotes" } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await readError(res);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return Array.isArray(content) ? content.map((c: any) => c.text ?? "").join("") : content ?? "";
    }

    case "gemini": {
      const chain = [model, ...GEMINI_BACKUPS.filter((m) => m !== model)];
      let lastErr: any;
      for (let i = 0; i < chain.length; i++) {
        const isLast = i === chain.length - 1;
        // give each model a time limit so one stuck model doesn't block the whole request
        const attempt = isLast ? req.signal : AbortSignal.any([req.signal ?? new AbortController().signal, AbortSignal.timeout(GEMINI_ATTEMPT_MS)]);
        try {
          const text = await geminiOnce(settings, chain[i], req, attempt);
          if (i > 0) req.onFallback?.(model, chain[i], String(lastErr?.message ?? lastErr).split("\n")[0]);
          return text;
        } catch (e: any) {
          if (req.signal?.aborted || !modelUnavailable(e) || isLast) throw e;
          lastErr = e?.name === "TimeoutError" ? new Error(`${chain[i]} did not answer in time`) : e;
          console.warn(`Gemini model ${chain[i]} failed, trying ${chain[i + 1]}:`, e?.message);
        }
      }
      throw lastErr;
    }
  }
}

async function geminiOnce(settings: Settings, model: string, req: ChatRequest, signal?: AbortSignal): Promise<string> {
  const key = need(settings.keys.gemini, "Gemini");
  const send = (thinking: boolean) =>
    fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          {
            role: "user",
            parts: [...req.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.b64 } })), { text: req.text }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 16384,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
          ...(thinking ? { thinkingConfig: geminiThinking(model, settings.effort) } : {}),
        },
      }),
    });
  let res = await send(true);
  // older or unusual models may reject the thinking setting: try once without it
  if (res.status === 400 && /thinking/i.test(await res.clone().text())) res = await send(false);
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? "unknown reason"}).`);
  return text;
}

// ---------------------------------------------------------------- images

export interface GeneratedImage {
  mime: string;
  b64: string;
  text?: string;
}

const b64ToBlob = (b64: string, mime: string) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

function parseDataURL(url: string): GeneratedImage {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error("Unexpected image format from provider.");
  return { mime: m[1], b64: m[2] };
}

export async function generateImage(
  settings: Settings,
  prompt: string,
  images: InputImage[],
  provider: ImageProvider = settings.imageProvider,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const model = settings.imageModels[provider];
  switch (provider) {
    case "gemini": {
      const key = need(settings.keys.gemini, "Gemini");
      const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
          signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.b64 } })), { text: prompt }] },
          ],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!res.ok) throw await readError(res, "image");
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p: any) => p.inlineData?.data);
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n");
      if (!img) throw new Error(text || "Gemini returned no image. Try rephrasing the prompt.");
      return { mime: img.inlineData.mimeType || "image/png", b64: img.inlineData.data, text };
    }

    case "openai": {
      const key = need(settings.keys.openai, "OpenAI");
      let res: Response;
      if (images.length) {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", prompt);
        images.forEach((img, i) => form.append("image[]", b64ToBlob(img.b64, img.mime), `input-${i}.png`));
        res = await fetchRetry("https://api.openai.com/v1/images/edits", {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });
      } else {
        res = await fetchRetry("https://api.openai.com/v1/images/generations", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, prompt }),
        });
      }
      if (!res.ok) throw await readError(res, "image");
      const data = await res.json();
      const item = data.data?.[0];
      if (item?.b64_json) return { mime: "image/png", b64: item.b64_json };
      if (item?.url) {
        const blob = await (await fetch(item.url)).blob();
        const dataURL = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
        return parseDataURL(dataURL);
      }
      throw new Error("OpenAI returned no image.");
    }

    case "openrouter": {
      const key = need(settings.keys.openrouter, "OpenRouter");
      const res = await fetchRetry("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
          signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": location.origin,
          "X-Title": "SketchNotes",
        },
        body: JSON.stringify({
          model,
          modalities: ["image", "text"],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.b64}` } })),
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw await readError(res, "image");
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      const url = msg?.images?.[0]?.image_url?.url;
      if (!url) throw new Error(msg?.content || "This OpenRouter model returned no image. Pick an image-capable model.");
      return { ...parseDataURL(url), text: typeof msg.content === "string" ? msg.content : undefined };
    }
  }
}

// ---------------------------------------------------------------- model lists

export async function listModels(settings: Settings, provider: TextProvider): Promise<string[]> {
  switch (provider) {
    case "anthropic": {
      const client = anthropicClient(need(settings.keys.anthropic, "Anthropic"));
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      return ids;
    }
    case "openai": {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${need(settings.keys.openai, "OpenAI")}` },
      });
      if (!res.ok) throw await readError(res);
      const data = await res.json();
      return data.data
        .map((m: any) => m.id as string)
        .filter((id: string) => /^(gpt|o\d|chatgpt)/.test(id) || /image|transcribe|whisper/.test(id))
        .sort();
    }
    case "gemini": {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        headers: { "x-goog-api-key": need(settings.keys.gemini, "Gemini") },
      });
      if (!res.ok) throw await readError(res);
      const data = await res.json();
      return data.models
        .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m: any) => (m.name as string).replace(/^models\//, ""))
        .sort();
    }
    case "openrouter": {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      if (!res.ok) throw await readError(res);
      const data = await res.json();
      return data.data.map((m: any) => m.id as string).sort();
    }
  }
}

// ---------------------------------------------------------------- transcription

export async function transcribe(settings: Settings, audio: Blob, engine: "openai" | "gemini"): Promise<string> {
  if (engine === "openai") {
    const form = new FormData();
    form.append("model", settings.voiceModelOpenAI);
    form.append("file", audio, "voice.webm");
    const res = await fetchRetry("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${need(settings.keys.openai, "OpenAI")}` },
      body: form,
    });
    if (!res.ok) throw await readError(res);
    return ((await res.json()).text ?? "").trim();
  }
  const b64 = await new Promise<string>((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve((fr.result as string).split(",")[1]);
    fr.readAsDataURL(audio);
  });
  const saved = settings.textModels.gemini;
  const text = await chat(
    { ...settings, textModels: { ...settings.textModels, gemini: settings.voiceModelGemini || saved } },
    {
      system: "You transcribe audio. Output only the exact words spoken, nothing else.",
      text: "Transcribe this voice note.",
      images: [{ mime: audio.type.split(";")[0] || "audio/webm", b64 }],
    },
    "gemini",
  );
  return text.trim();
}
