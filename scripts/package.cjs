'use strict';
// A deterministic, uncompressed ZIP writer keeps packaging dependency-free.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'check.cjs')], { stdio: 'inherit' });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const iconAssets = ['auto-advance', 'auto-advance-dark', 'auto-advance-disabled-light', 'auto-advance-disabled-dark'].map((name) => `icons/${name}.svg`)
  .concat([16, 32, 48, 128].flatMap((size) => ['icon', 'icon-light', 'icon-gray', 'icon-gray-dark'].map((name) => `icons/${name}-${size}.png`)));
const files = [...new Set(['manifest.json', 'LICENSE', 'PRIVACY.md', 'background.js', 'content/page-status.js',
  ...iconAssets, 'icons/brands/youtube.svg', 'icons/brands/instagram.svg', 'icons/brands/github.svg', 'icons/brands/LICENSE.md', 'icons/brands/README.md',
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])]),
  manifest.action.default_popup, 'popup/popup.js', 'popup/popup.css', ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)])].sort();
const local = [], central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file), source = fs.readFileSync(path.join(root, file));
  // Match Git's LF text normalization so Windows/Linux produce the same ZIP.
  const data = /\.(js|json|css|html|svg|md)$/.test(file) || file === 'LICENSE'
    ? Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n')) : source;
  const crc = crc32(data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  local.push(header, name, data);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  central.push(directory, name); offset += header.length + name.length + data.length;
}
const index = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
const output = path.join(root, 'dist', `auto-advance-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, Buffer.concat([...local, index, end]));
fs.writeFileSync(output + '.sha256', createHash('sha256').update(fs.readFileSync(output)).digest('hex') + '  ' + path.basename(output) + '\n');
console.log(`Packaged ${files.length} production files: ${output}`);
