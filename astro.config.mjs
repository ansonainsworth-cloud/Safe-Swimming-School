import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://safeswimmingschool.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
