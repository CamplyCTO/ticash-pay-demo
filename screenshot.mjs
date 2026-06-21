import { chromium } from 'playwright';

const url = process.env.URL || 'http://127.0.0.1:3100/admin';
const browser = await chromium.launch({ headless: true });
const httpCredentials = process.env.BASIC_AUTH_USER
  ? { username: process.env.BASIC_AUTH_USER, password: process.env.BASIC_AUTH_PASS || '' }
  : undefined;
const page = await browser.newPage({ viewport: { width: 1320, height: 1500 }, httpCredentials });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });

// Wait until the client JS has actually fetched + rendered real ledger rows.
await page.waitForFunction(() => {
  const feed = document.getElementById('feed');
  return feed && feed.querySelectorAll('tr').length > 0 && !feed.textContent.includes('sem lançamentos');
}, { timeout: 20000 });
await page.waitForFunction(() => document.getElementById('kpi-vol').textContent !== '—', { timeout: 5000 });

await page.screenshot({ path: 'admin-screenshot.png', fullPage: true });

// Pull rendered values back out to prove it's data-driven, not a static shell.
const result = {
  kpiLancamentos: (await page.textContent('#kpi-vol'))?.trim(),
  kpiAgentes: (await page.textContent('#kpi-agents'))?.trim(),
  kpiClientes: (await page.textContent('#kpi-customers'))?.trim(),
  kpiDivergencias: (await page.textContent('#kpi-div'))?.trim(),
  reconNote: (await page.textContent('#recon-note'))?.trim(),
  feedRows: await page.$$eval('#feed tr', (r) => r.length),
  balanceRows: await page.$$eval('#balances tr', (r) => r.length),
  customerRows: await page.$$eval('#customers tr', (r) => r.length),
  health: (await page.textContent('#health'))?.trim(),
  consoleErrors: errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
