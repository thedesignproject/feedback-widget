import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
      exclude: ['src/__tests__/**', '**/*.test.*', '**/*.d.ts'],
    },
  },
})
