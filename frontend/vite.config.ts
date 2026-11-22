import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the API runs on :8000 and is proxied, so the browser sees one origin
// (session cookies work for fetch and for <img> page renders; no CORS).
const API = process.env.VITE_API_ORIGIN ?? 'http://localhost:8000'
const proxy = Object.fromEntries(['/api', '/auth', '/public', '/health'].map((p) => [p, { target: API, changeOrigin: true }]))

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
