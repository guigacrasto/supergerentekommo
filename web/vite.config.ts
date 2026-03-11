import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

/** Substitui %VITE_*% no index.html usando defaults quando env var não está definida */
function htmlEnvPlugin(defaults: Record<string, string>): Plugin {
  return {
    name: 'html-env-defaults',
    transformIndexHtml(html) {
      return html.replace(/%(\w+)%/g, (match, key) => defaults[key] ?? match);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  const appName = env.VITE_APP_NAME || 'SuperGerente';
  const appShortName = env.VITE_APP_SHORT_NAME || 'SG';
  const appDescription = env.VITE_APP_DESCRIPTION || 'Painel de gestao comercial inteligente';
  const themeColor = env.VITE_APP_THEME_COLOR || '#9566F2';

  return {
    plugins: [
      react(),
      tailwindcss(),
      htmlEnvPlugin({
        VITE_APP_NAME: appName,
        VITE_APP_SHORT_NAME: appShortName,
        VITE_APP_DESCRIPTION: appDescription,
        VITE_APP_THEME_COLOR: themeColor,
      }),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico'],
        manifest: {
          name: appName,
          short_name: appShortName,
          description: appDescription,
          start_url: '/',
          display: 'standalone',
          background_color: '#12081E',
          theme_color: themeColor,
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'https://supergerentekommo-production.up.railway.app',
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
