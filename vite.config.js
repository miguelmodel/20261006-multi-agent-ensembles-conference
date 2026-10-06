import { defineConfig } from 'vite';

// Local-first: development and visual review always use base '/'.
// Publishing (orchestrator only) passes `--base=/<repo-name>/` on the CLI.
export default defineConfig({
  base: '/',
  server: {
    strictPort: false,
  },
  preview: {
    strictPort: false,
  },
  build: {
    assetsInlineLimit: 0,
  },
});
