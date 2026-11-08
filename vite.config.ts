import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? './' : '/',
  plugins: [
    react(),
    VitePWA({
      // A new service worker takes over as soon as it is ready. This is safe for data: every write is an atomic
      // transaction, and an older copy of the app that meets a newer database refuses to write (see OutdatedScreen).
      registerType: 'autoUpdate',
      workbox: { cleanupOutdatedCaches: true },
      manifest: {
        name: '50K Sparutmaning',
        short_name: 'Spar',
        description: 'Ett lugnt, privat sparande – steg för steg.',
        lang: 'sv',
        theme_color: '#0b1116',
        background_color: '#0b1116',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
})
