import { defineConfig } from 'vite';

// GitHub Pages serves a project site under /<repo>/, so assets need that prefix.
// The camera catalogue is fetched with a relative URL, which resolves correctly
// under both this base and the bare dev-server root.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/world-live-wall/' : '/',
  build: { target: 'es2022' },
});
