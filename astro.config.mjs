// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    server: {
      host: "0.0.0.0", // listen on all interfaces
      port: 4321,
      hmr: {
        host: "192.168.178.27", // your PC’s LAN IP
        protocol: "ws",
        port: 4321,
      },
    },
  },
});
