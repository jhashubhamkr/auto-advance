'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
assert.equal(manifest.manifest_version, 3);
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
assert.equal(manifest.version, packageInfo.version);
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[''].version);
assert.match(fs.readFileSync(path.join(root, 'content/settings.js'), 'utf8'), /const DEBUG = false;/, 'Public package must disable debug logs by default');
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.background, { service_worker: 'background.js' });
assert.deepEqual(manifest.host_permissions, manifest.content_scripts[0].matches);
const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
for (const entry of manifest.content_scripts) {
  for (const match of entry.matches) assert.match(match, /^https:\/\/(www\.)?(youtube|instagram)\.com\/\*$/);
}
const files = [...scripts, 'content/page-status.js', 'background.js', manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), 'popup/popup.js', 'popup/popup.css'];
for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), `Missing ${file}`);
for (const file of [...scripts, 'content/page-status.js', 'background.js', 'popup/popup.js']) {
  execFileSync(process.execPath, ['--check', path.join(root, file)]);
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(code, /\beval\s*\(|\bnew\s+Function\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b/);
}
const html = fs.readFileSync(path.join(root, manifest.action.default_popup), 'utf8');
assert.doesNotMatch(html, /\son\w+\s*=|<script(?![^>]*\bsrc=)|src=["']https?:/i);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (match[1].startsWith('https://')) { assert.match(match[1], /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/); continue; }
  assert.ok(fs.existsSync(path.resolve(root, 'popup', match[1])));
}
for (const match of fs.readFileSync(path.join(root, 'popup/popup.css'), 'utf8').matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) assert.ok(fs.existsSync(path.resolve(root, 'popup', match[1])));
assert.doesNotMatch(html, /Save settings|onlyWhenTabVisible/);
assert.doesNotMatch(html, /your-username|placeholder/i);
for (const [size, file] of Object.entries(manifest.icons)) {
  const png = fs.readFileSync(path.join(root, file));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), Number(size)); assert.equal(png.readUInt32BE(20), Number(size));
}
console.log(`Manifest, ${scripts.length + 3} JavaScript files, SVG popup assets, storage permission with matching YouTube/Instagram hosts and toolbar PNGs verified.`);
