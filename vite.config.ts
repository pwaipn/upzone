import { defineConfig } from "vite";

export default defineConfig({
  // Project pages live at pwaipn.github.io/upzone/; local dev stays at /.
  base: process.env.GITHUB_ACTIONS ? "/upzone/" : "/",
  optimizeDeps: {
    // Pre-bundling maplibre-gl can drop its web worker chunk, which leaves
    // the map silently stuck at "loading". Serve it unbundled in dev.
    exclude: ["maplibre-gl"],
  },
});
