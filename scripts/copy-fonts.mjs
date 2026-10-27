// Copies Excalidraw's fonts into public/ so the app works fully offline.
import { cpSync, existsSync } from "node:fs";
const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
if (existsSync(src)) cpSync(src, "public/fonts", { recursive: true });
