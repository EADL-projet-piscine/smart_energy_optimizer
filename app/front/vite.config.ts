import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const cible = env.VITE_API_PROXY_TARGET || 'http://10.43.43.80:8000'

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: cible,
          changeOrigin: true,
          timeout: 3000,
        },
      },
    },
  }
})
