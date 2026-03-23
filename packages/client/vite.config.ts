import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:6049',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'pixi.js'],
  },
});
