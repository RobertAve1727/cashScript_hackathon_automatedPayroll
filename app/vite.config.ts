import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The app is a self-contained Vite project, but the payroll arithmetic is NOT
 * duplicated here: `@domain` aliases straight into the repo's domain layer
 * (zero-dependency TypeScript), so the screens run the exact statutory engine
 * the covenant is tested against.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('../src/domain', import.meta.url)),
    },
  },
  server: {
    // The domain source lives one level above the Vite root.
    fs: { allow: ['..'] },
  },
  build: {
    target: 'es2022',
  },
});
