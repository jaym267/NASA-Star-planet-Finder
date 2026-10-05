import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Send /api requests to FastAPI during development
    proxy: { "/api": "http://localhost:8000" },
  },
});
