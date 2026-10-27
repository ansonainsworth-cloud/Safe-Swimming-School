# safeswimmingschool.com (Astro static site)

Static rebuild of the former GoDaddy WordPress site, for Cloudflare Pages.

- Build: `npm ci && npm run build` (output: `dist/`). Node 20 (`.nvmrc`); set `NODE_VERSION=20` in Pages.
- Cloudflare Pages settings: framework preset Astro, build command `npm run build`, output directory `dist`.
- Shared layout: `src/layouts/Base.astro` (GA4 G-QYHBN3T4DB, meta, canonical, schema), header/menu `src/components/Header.astro`, footer `src/components/Footer.astro`, menu and footer links in `src/data/site.js`.
- Migrated page bodies (HTML): `src/content/pages/*.html`; titles, meta descriptions and schema: `src/data/migrated-pages.json`.
- New pages: `src/pages/books.astro`, `src/pages/adaptive-swim-lessons.astro`, `src/pages/water-aerobics.astro`.
- Redirects: `public/_redirects`. Noindex headers: `public/_headers`. `robots.txt` in `public/`; `sitemap.xml` is generated.
- Theme CSS/JS and images are mirrored from WordPress under `public/wp-content/` and `public/wp-includes/`, at the same paths, so old image URLs keep working.
- The Tally registration form (yPed66) is embedded on `/enroll/`.
- The installable lesson app is a separate project in `school/` (its own Pages site and Worker). It is not part of this marketing build. See `school/README.md`.
