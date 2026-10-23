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
    coverage: {
      provider: 'v8',
      // text : journal de CI ; coverage.txt : résumé du run ; html : artefact.
      reporter: ['text', ['text', { file: 'coverage.txt' }], 'html'],
      // Tout fichier source compte, testé ou non — sinon la couverture ne
      // mesure que ce qu'on a bien voulu mesurer.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/App.tsx',
        'src/vite-env.d.ts',
        'src/services/model.ts',
        'src/data/**',
        'src/tests/**',
      ],
      // Tout est mesuré et affiché ; seul ce qui est réellement couvert est
      // verrouillé. Les hooks use* sont encore à zéro : le seuil sera étendu
      // quand leurs tests arriveront.
      thresholds: {
        'src/components/**': { statements: 85, branches: 80, functions: 85, lines: 85 },
        'src/screens/**': { statements: 80, branches: 75, functions: 75, lines: 80 },
        'src/services/format.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/services/history.ts': { statements: 85, branches: 80, functions: 90, lines: 90 },
        'src/services/normalize.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/services/summary.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/api/client.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
      },
    },
  },
})
