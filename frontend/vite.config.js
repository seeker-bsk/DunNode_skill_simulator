import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':    'http://localhost:5000',
      '/tree':   'http://localhost:5000',
      '/jobs':   'http://localhost:5000',
      '/ping':   'http://localhost:5000',
      '/media':  'http://localhost:5000',
      '/skills': 'http://localhost:5000',
    },
  },
})
