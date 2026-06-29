// Render the exported web apps in real Chromium and screenshot the screens.
// Usage: node shoot.mjs <dist-dir> <out-prefix> <route1> <route2> ...
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const [distDir, outPrefix, ...routes] = process.argv.slice(2);
const PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.map': 'application/json' };

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  for (const cand of [p, p + '.html', join(p, 'index.html')]) {
    const f = join(distDir, cand);
    if (existsSync(f) && extname(f)) return f;
  }
  return join(distDir, 'index.html'); // SPA fallback
}

const server = createServer(async (req, res) => {
  try {
    const file = resolveFile(req.url);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir('screens', { recursive: true });
const browser = await chromium.launch();
let shots = 0;
for (const route0 of routes) {
  const route = route0.startsWith('/') ? route0 : '/' + route0;
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // let RN-web hydrate + fonts settle
    const name = `screens/${outPrefix}-${route.replace(/[\/()?=&]/g, '_') || 'home'}-${scheme}.png`;
    await page.screenshot({ path: name });
    console.log('shot', name);
    shots++;
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`done: ${shots} screenshots`);
