import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'fs';

/**
 * Simple plugin that copies the preload .cjs file to dist-electron/preload/
 * without any transformation. This avoids vite/rollup converting require()
 * to import — which breaks Electron's preload scripts.
 */
function copyPreloadPlugin(): Plugin {
  const src = path.resolve(__dirname, 'src/main/preload.cjs');
  const destDir = path.resolve(__dirname, 'dist-electron/preload');
  const dest = path.join(destDir, 'preload.cjs');

  function doCopy() {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
  }

  return {
    name: 'copy-preload',
    buildStart() {
      doCopy();
    },
    // Re-copy on file change during dev
    handleHotUpdate({ file }) {
      if (file === src) {
        doCopy();
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    copyPreloadPlugin(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'xlsx', 'papaparse'],
            },
          },
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
