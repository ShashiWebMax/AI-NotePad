// Sinhala text: each Excalidraw font style gets a matching Sinhala font.
//
// The faces are registered under Excalidraw's own family names with a Sinhala-only unicode-range, so
// "Excalifont" draws Latin letters with Excalifont and Sinhala letters with Yaldevi, and so on. The browser
// only downloads a face when Sinhala text actually appears. All fonts are OFL-1.1 (see @fontsource).

import notoSans from "@fontsource/noto-sans-sinhala/files/noto-sans-sinhala-sinhala-400-normal.woff2?url";
import yaldevi from "@fontsource/yaldevi/files/yaldevi-sinhala-400-normal.woff2?url";
import gemunuBold from "@fontsource/gemunu-libre/files/gemunu-libre-sinhala-700-normal.woff2?url";
import { setCustomTextMetricsProvider } from "@excalidraw/excalidraw";

export const SINHALA_RE = /[඀-෿]/;
export const hasSinhala = (s: string | undefined | null) => !!s && SINHALA_RE.test(s);

// Sinhala block, plus the joiners and the dotted circle that Sinhala conjuncts and marks rely on
const RANGE = "U+0964-0965,U+0D81-0DF4,U+200C-200D,U+25CC";

/**
 * Font family (as Excalidraw names it) → Sinhala font file. `weight` must match the weight Excalidraw
 * registers for that family, or the browser picks only our face and loses Excalidraw's Latin letters.
 * Helvetica is left out on purpose: it is the computer's own font, and a web font of the same name
 * would hide it. Sinhala in Helvetica uses the computer's Sinhala font instead.
 */
export const SINHALA_FONTS: Record<string, { url: string; name: string; weight?: string }> = {
  // hand-drawn styles: Yaldevi is the roundest, most informal Sinhala font
  Excalifont: { url: yaldevi, name: "Yaldevi" },
  Virgil: { url: yaldevi, name: "Yaldevi" },
  // clean sans styles
  Nunito: { url: notoSans, name: "Noto Sans Sinhala", weight: "500" },
  "Liberation Sans": { url: notoSans, name: "Noto Sans Sinhala" },
  // code styles: there is no monospaced Sinhala font, so use the plainest one
  "Comic Shanns": { url: notoSans, name: "Noto Sans Sinhala" },
  Cascadia: { url: notoSans, name: "Noto Sans Sinhala" },
  // bold display style
  "Lilita One": { url: gemunuBold, name: "Gemunu Libre Bold" },
  // the app's own buttons, notes and AI panel
  "SketchNotes Sinhala": { url: notoSans, name: "Noto Sans Sinhala" },
};

const ours = new Set<FontFace>();

/**
 * Excalidraw measures text on one canvas. Chrome keeps that canvas's old font choice when the same font
 * name is set again, so text measured before a font arrived kept its stand-in width. This measurer starts
 * a fresh canvas whenever fonts finish loading.
 */
function installTextMeasurer() {
  let ctx: CanvasRenderingContext2D | null = null;
  document.fonts.addEventListener("loadingdone", () => { ctx = null; });
  setCustomTextMetricsProvider({
    getLineWidth(text: string, font: string) {
      if (!ctx) ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return 0;
      ctx.font = font;
      return ctx.measureText(text).width;
    },
  });
}

/** Adds the Sinhala faces to the page. Safe to call more than once. */
export function registerSinhalaFonts() {
  if (ours.size || typeof FontFace === "undefined") return;
  installTextMeasurer();
  for (const [family, f] of Object.entries(SINHALA_FONTS)) {
    const face = new FontFace(family, `url(${f.url}) format("woff2")`, {
      unicodeRange: RANGE,
      display: "swap",
      weight: f.weight ?? "400",
    });
    document.fonts.add(face);
    ours.add(face);
  }
}

export const isSinhalaFace = (f: FontFace) => ours.has(f);

/** Downloads every Sinhala face now (they are small), e.g. before placing Sinhala text. */
export async function loadSinhalaFonts() {
  registerSinhalaFonts();
  await Promise.all([...ours].map((f) => (f.status === "loaded" ? f : f.load().catch(() => f))));
}

export const sinhalaFontsReady = () => ours.size > 0 && [...ours].every((f) => f.status === "loaded");
export const anySinhalaFontLoaded = () => [...ours].some((f) => f.status === "loaded");

const toBase64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Excalidraw only embeds its own fonts in SVG exports. When the SVG has Sinhala text, this adds the
 * Sinhala faces for the families it uses, so the file looks the same on other computers.
 */
export async function embedSinhalaInSvg(svg: SVGSVGElement) {
  const texts = [...svg.querySelectorAll("text")].filter((t) => hasSinhala(t.textContent));
  if (!texts.length) return;
  const families = new Set<string>();
  for (const t of texts) {
    const first = (t.getAttribute("font-family") || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (SINHALA_FONTS[first]) families.add(first);
  }
  const cache = new Map<string, string>();
  let css = "";
  for (const family of families) {
    const { url } = SINHALA_FONTS[family];
    if (!cache.has(url)) cache.set(url, toBase64(await (await fetch(url)).arrayBuffer()));
    css += `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${cache.get(url)}) format("woff2");unicode-range:${RANGE};}\n`;
  }
  if (!css) return;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.setAttribute("class", "style-fonts-sinhala");
  style.textContent = css;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.prepend(defs);
  }
  defs.appendChild(style);
}
