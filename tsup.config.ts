import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/main/index.ts' },
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
    entry: { index: 'src/preload/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist/preload',
    treeshake: true,
    external: ['electron', 'rig-foundation'],
  },
  {
    entry: { index: 'src/renderer/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist/renderer',
    treeshake: true,
    external: ['electron'],
  },
]);
