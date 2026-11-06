import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // El backend solo autoriza este origen (WEB_ORIGINS). Si el puerto está ocupado,
    // es mejor que Vite falle con un aviso a que salte a otro y el login dé 403.
    port: 5173,
    strictPort: true,
    allowedHosts: true, // Permite conexiones entrantes desde URLs de Dev Tunnels
    proxy: {
      '/api/v1': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});