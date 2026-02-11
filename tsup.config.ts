import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'main/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist/main',
    treeshake: true,
    external: ['electron', 'rig-foundation'],
  },
  {
    entry: { index: 'preload/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist/preload',
    treeshake: true,
    external: ['electron', 'rig-foundation'],
  },
]);
