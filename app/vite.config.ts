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
  /**
   * The dependency pre-bundler needs the same target as the build.
   *
   * `build.target` below only governs the production bundle. In dev, Vite
   * pre-bundles dependencies with esbuild under its own default target list
   * (chrome87, safari14, es2020 …), and `@bitauth/libauth` uses a top-level
   * await to resolve its WASM crypto instances. ES2020 has no top-level
   * await, so `npm run dev` failed while `npm run build` succeeded — the kind
   * of split that looks like a broken install rather than a config gap.
   */
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
