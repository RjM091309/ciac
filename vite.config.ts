import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const backendTarget = env.VITE_BACKEND_URL || 'http://127.0.0.1:2501';
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 2500,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          // Pass the browser's address on as X-Forwarded-For — without it
          // the backend sees every request as coming from this proxy (::1),
          // and the audit log records that instead of the real client IP.
          xfwd: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
