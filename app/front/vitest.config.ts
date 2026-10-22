import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/tests/**/*.test.{ts,tsx}'],
    // jsdom fournit un DOM aux tests de composants ; les tests de services
    // s'en passent très bien et n'en souffrent pas.
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    restoreMocks: true,
  },
})
