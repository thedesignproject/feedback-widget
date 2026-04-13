import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  envDir: resolve(__dirname, '..'),
  server: {
    port: 5189,
  },
  resolve: {
    alias: {
      'feedback-widget': resolve(__dirname, '../src/index.ts'),
    },
  },
})
