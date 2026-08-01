import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/**
 * Two aliases, and the distinction between them matters.
 *
 * `@domain` reaches OUT of this project into the repo's own domain layer, so
 * the payroll arithmetic is not duplicated here: the screens run the exact
 * statutory engine the covenant is tested against.
 *
 * `@ui` is the SmartHR design system's own clean-architecture shell — theme,
 * navigation and the vendor-script runtime — brought across from the eSahod
 * frontend project. It is presentation infrastructure and knows nothing about
 * payroll, which is why it does not get to be called `@domain`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': resolvePath('../src/domain'),
      '@ui': resolvePath('./src/ui'),
    },
  },
  server: {
    port: 5173,
    open: false,
    // The domain source lives one level above the Vite root.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
