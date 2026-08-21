import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: "./" makes every asset path relative, so the build works whether it's
// served from a user/org root (user.github.io) OR a project subpath
// (user.github.io/weft/). No config needed per-repo.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // SOURCEMAPS ON. A production error arrives as `undefined is not an object (evaluating
  // 'e.length')` without them, which names no file, no line and no variable — the maps cost nothing
  // at runtime (browsers fetch them only when devtools is open) and turn the next one into a place.
  build: { outDir: "dist", chunkSizeWarningLimit: 1200, sourcemap: true },
});
