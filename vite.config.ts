import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Pre-bundling maplibre-gl can drop its web worker chunk, which leaves
    // the map silently stuck at "loading". Serve it unbundled in dev.
    exclude: ["maplibre-gl"],
  },
});
