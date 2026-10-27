import pages from '../data/migrated-pages.json';
const SITE = 'https://safeswimmingschool.com';
const extra = ['/books/', '/adaptive-swim-lessons/', '/water-aerobics/', '/baby-bath-time-water-comfort/', '/locations/wellington/winter-package/'];
export function GET() {
  const paths = [...pages.map((p) => p.path), ...extra];
  const today = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
