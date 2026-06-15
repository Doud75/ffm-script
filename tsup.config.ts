import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
