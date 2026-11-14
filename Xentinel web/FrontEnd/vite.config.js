import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Los hosts estáticos (Render, GitHub Pages) responden con 404.html las rutas que no son
// archivos: con la misma página, el enrutador de React abre /login, /restablecer-contrasena, etc.
function respaldoRutas() {
  let salida;
  return {
    name: 'xentinel-respaldo-rutas',
    apply: 'build',
    configResolved(config) {
      salida = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(join(salida, 'index.html'), join(salida, '404.html'));
    },
  };
}

export default defineConfig({
  plugins: [react(), respaldoRutas()],
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