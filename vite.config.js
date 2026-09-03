import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        humanInstincts: fileURLToPath(new URL('./index.html', import.meta.url)),
        dashboard: fileURLToPath(new URL('./dashboard.html', import.meta.url)),
        // mobile-concept.html is deliberately NOT built for production — it is the
        // unapproved visual-reboot sandbox. `vite dev` still serves it locally.
      },
    },
  },
})
