import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/rcj-soccer-lab/' : '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: 'localhost', port: 3000, strictPort: true },
  build: { outDir: 'dist/client', emptyOutDir: true, target: 'es2022' },
});
