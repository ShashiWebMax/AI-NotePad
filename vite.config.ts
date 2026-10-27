import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH is the sub-folder the site is served from, e.g. "/sketchnotes/" on GitHub Pages.
// Locally and in Docker it is "/".
const base = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

export default defineConfig({
  base,
  plugins: [react()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  server: { port: 5173, host: "localhost" },
  preview: { port: 5173, host: "localhost" },
});
