// @ts-check
import { defineConfig } from "astro/config"
import tailwindcss from "@tailwindcss/vite"
import { optimizeTablerIconsImport } from "./src/plugins/vite-plugin-optimize-tabler-icons.ts"
import svelte from "@astrojs/svelte"

export default defineConfig({
  vite: {
    plugins: [tailwindcss(), optimizeTablerIconsImport()],
    server: {
      host: "0.0.0.0", // listen on all interfaces
      port: 4321,
      hmr: {
        host: "192.168.178.27",
        protocol: "ws",
        port: 4321,
      },
    },
    build: {
      rollupOptions: {
        external: ["@tauri-apps/plugin-process", "@tauri-apps/plugin-updater"],
      },
    },
  },

  integrations: [svelte()],
})
