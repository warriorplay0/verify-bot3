import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        registro: resolve(root, "registro.html"),
        login: resolve(root, "login.html"),
        verificar: resolve(root, "verificar.html"),
      },
    },
  },
});
