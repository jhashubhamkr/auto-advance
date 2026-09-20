'use strict';
// Approved circled chevron only. Uses the development browser-check runtime.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = path.resolve(__dirname, '../icons');
const variants = [
  { svg: 'auto-advance', png: 'icon-light', disc: '#00b0ff', glyph: '#ffffff' },
  { svg: 'auto-advance-dark', png: 'icon', disc: '#00b0ff', glyph: '#092b40' },
  { svg: 'auto-advance-disabled-light', png: 'icon-gray', disc: '#cfd7df', glyph: '#6e7984' },
  { svg: 'auto-advance-disabled-dark', png: 'icon-gray-dark', disc: '#293e4d', glyph: '#718594' }
];
async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route('**/*', (route) => route.abort());
    for (const variant of variants) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" color="${variant.glyph}"><circle cx="50" cy="50" r="46" fill="${variant.disc}"/><path d="M40 29 61 50 40 71" fill="none" stroke="currentColor" stroke-width="12" stroke-linejoin="miter"/></svg>`;
      fs.writeFileSync(path.join(directory, `${variant.svg}.svg`), svg + '\n');
      for (const size of [16, 32, 48, 128]) {
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
        await page.screenshot({ path: path.join(directory, `${variant.png}-${size}.png`), omitBackground: true });
      }
    }
  } finally { await browser.close(); }
  console.log('Generated approved circled chevron: 4 SVG theme/state variants and 16 PNG exports.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
