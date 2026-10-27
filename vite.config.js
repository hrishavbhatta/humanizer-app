import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // relative asset paths so dist/ works on any static host or subfolder
  build: { chunkSizeWarningLimit: 800 }, // compromise (offline part-of-speech tagger) makes the single bundle ~620 kB; it is loaded from local assets
})
