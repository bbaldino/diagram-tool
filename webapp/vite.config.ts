import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend now runs as a standalone Express server (see server/index.ts).
// In dev, that server runs on :8080 and Vite proxies the API + MCP to it, so
// the frontend keeps HMR while dev and prod exercise the same server code.
const API_TARGET = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/mcp': { target: API_TARGET, changeOrigin: true },
    },
  },
})
