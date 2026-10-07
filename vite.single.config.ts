// Builds the whole app into one HTML file that opens straight from disk (file://).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'preview',
    emptyOutDir: true,
  },
});
