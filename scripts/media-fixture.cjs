'use strict';
// Maintenance-only fixture generator. The committed WebM is sufficient for tests.
// Requires sharp (SHARP_MODULE can reference an existing installation).
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const fs = require('node:fs');
const path = require('node:path');
function vint(n) { if (n < 127) return Buffer.from([0x80 | n]); if (n < 16383) return Buffer.from([0x40 | (n >> 8), n & 255]); return Buffer.from([0x20 | (n >> 16), (n >> 8) & 255, n & 255]); }
function element(id, ...data) { const body = Buffer.concat(data); return Buffer.concat([Buffer.from(id, 'hex'), vint(body.length), body]); }
const uint = (n) => n < 256 ? Buffer.from([n]) : n < 65536 ? Buffer.from([n >> 8, n & 255]) : Buffer.from([n >> 16, (n >> 8) & 255, n & 255]);
async function main() {
  const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#176c53' } }).webp({ quality: 70 }).toBuffer();
  let vp8;
  for (let offset = 12; offset + 8 <= webp.length;) {
    const size = webp.readUInt32LE(offset + 4);
    if (webp.toString('ascii', offset, offset + 4) === 'VP8 ') vp8 = webp.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!vp8) throw new Error('WebP did not contain VP8 keyframe');
  const header = element('1a45dfa3', element('4286', uint(1)), element('42f7', uint(1)), element('42f2', uint(4)), element('42f3', uint(8)), element('4282', Buffer.from('webm')), element('4287', uint(2)), element('4285', uint(2)));
  const duration = Buffer.alloc(8); duration.writeDoubleBE(650);
  const info = element('1549a966', element('2ad7b1', uint(1000000)), element('4489', duration), element('4d80', Buffer.from('local-fixture')), element('5741', Buffer.from('local-fixture')));
  const tracks = element('1654ae6b', element('ae', element('d7', uint(1)), element('73c5', uint(1)), element('83', uint(1)), element('86', Buffer.from('V_VP8')), element('e0', element('b0', uint(64)), element('ba', uint(64)))));
  const blocks = [];
  for (let time = 0; time < 650; time += 50) {
    const prefix = Buffer.from([0x81, time >> 8, time & 255, 0x80]); blocks.push(element('a3', prefix, vp8));
  }
  const result = Buffer.concat([header, element('18538067', info, tracks, element('1f43b675', element('e7', uint(0)), ...blocks))]);
  const dir = path.resolve(__dirname, '../tests/fixtures'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'short.webm'), result);
  console.log(`Generated original 650 ms VP8 fixture (${result.length} bytes).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
