#!/usr/bin/env node
/**
 * Package the built game into a single distributable ZIP.
 *
 * The archive is written with Node's own `zlib`, so there is no dependency on a
 * system `zip` binary — `npm run zip` works on Windows, macOS and Linux.
 *
 * Contents:
 *
 *   surf-rush/
 *     index.html          <- open this, or serve the folder
 *     assets/...          <- bundled JS/CSS from `vite build`
 *     README.md
 *     package.json
 *     PLAY.md             <- controls + how to run, for anyone who gets the ZIP
 *
 * The build is fully static and uses relative paths (`base: './'`), so the
 * folder works when served by any static file server — and, apart from ES
 * modules needing http(s), straight from disk in a modern browser.
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'release');

/* ------------------------------------------------------------------ *
 * ZIP writer (deflate, no external tooling)
 * ------------------------------------------------------------------ */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const VERSION = 20;
const FLAG_UTF8 = 1 << 11;

/** MS-DOS date/time pair for a JS Date. */
function dosDateTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

class ZipWriter {
  constructor() {
    /** @type {{name:string, data:Buffer, crc:number, size:number, method:number, offset:number, mtime:Date}[]} */
    this.entries = [];
  }

  /**
   * @param {string} name path inside the archive, `/`-separated
   * @param {Buffer} data
   */
  add(name, data) {
    const crc = typeof crc32 === 'function' ? crc32(data) : legacyCrc32(data);
    const stored = Buffer.byteLength(data);
    const compressed = deflateRawSync(data, { level: 9 });
    // Never store something that got *bigger* than the original.
    const payload = compressed.length < stored ? compressed : data;
    this.entries.push({
      name,
      data: payload,
      crc,
      size: stored,
      method: payload === data ? 0 : 8,
      offset: 0,
      mtime: new Date(),
    });
  }

  toBuffer() {
    const chunks = [];
    let offset = 0;

    for (const entry of this.entries) {
      entry.offset = offset;
      const name = Buffer.from(entry.name, 'utf8');
      const { time, day } = dosDateTime(entry.mtime);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(LOCAL_HEADER, 0);
      local.writeUInt16LE(VERSION, 4);
      local.writeUInt16LE(FLAG_UTF8, 6);
      local.writeUInt16LE(entry.method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(entry.crc, 14);
      local.writeUInt32LE(entry.data.length, 18);
      local.writeUInt32LE(entry.size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);

      chunks.push(local, name, entry.data);
      offset += local.length + name.length + entry.data.length;
    }

    const centralStart = offset;
    for (const entry of this.entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const { time, day } = dosDateTime(entry.mtime);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(CENTRAL_HEADER, 0);
      central.writeUInt16LE(VERSION, 4);
      central.writeUInt16LE(VERSION, 6);
      central.writeUInt16LE(FLAG_UTF8, 8);
      central.writeUInt16LE(entry.method, 10);
      central.writeUInt16LE(time, 12);
      central.writeUInt16LE(day, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.data.length, 20);
      central.writeUInt32LE(entry.size, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30); // extra
      central.writeUInt16LE(0, 32); // comment
      central.writeUInt16LE(0, 34); // disk
      central.writeUInt16LE(0, 36); // internal attrs
      central.writeUInt32LE(0, 38); // external attrs
      central.writeUInt32LE(entry.offset, 42);

      chunks.push(central, name);
      offset += central.length + name.length;
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_RECORD, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    end.writeUInt16LE(0, 20);
    chunks.push(end);

    return Buffer.concat(chunks);
  }
}

/** Fallback CRC-32 for Node versions without `zlib.crc32`. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function legacyCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Collection
 * ------------------------------------------------------------------ */

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const PLAY_MD = `# Surf Rush — quick start

## Run it

The build is static. Serve the folder with any static file server and open it:

    npx serve .
    # or
    python3 -m http.server 8080

Then visit the printed address (for example http://localhost:8080/).

Opening \`index.html\` directly with \`file://\` will **not** work: browsers
refuse to load ES modules from the file system. Use a server.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | A / ←, D / → | swipe left / right, or the on-screen arrows |
| Jump | Space / ↑ / W | swipe up, or the JUMP button |
| Duck | S / ↓ | swipe down, or the DUCK button |
| Pause | P / Esc | the pause button in the HUD |

Enter confirms the highlighted option on menus.

## Sound

Audio is synthesised in the browser and stays muted until you interact with the
page — that is a browser rule, not a bug. Click or press a key once and the
music and effects fade in.
`;

async function main() {
  if (!existsSync(DIST) || !existsSync(join(DIST, 'index.html'))) {
    console.log('dist/ not found — running the production build first…');
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build produced no index.html');

  const zip = new ZipWriter();
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = 'surf-rush';

  let bytes = 0;
  for (const file of await walk(DIST)) {
    const name = [prefix, relative(DIST, file).split(sep).join('/')].join('/');
    const data = readFileSync(file);
    bytes += data.length;
    zip.add(name, data);
  }

  for (const file of ['README.md', 'package.json', 'LICENSE']) {
    const full = join(ROOT, file);
    if (existsSync(full)) zip.add(`${prefix}/${file}`, readFileSync(full));
  }
  zip.add(`${prefix}/PLAY.md`, Buffer.from(PLAY_MD, 'utf8'));

  mkdirSync(OUT_DIR, { recursive: true });
  const target = join(OUT_DIR, `surf-rush-${stamp}.zip`);
  const buffer = zip.toBuffer();
  writeFileSync(target, buffer);

  // Keep the newest archive only, so `release/` never fills up.
  for (const entry of await readdir(OUT_DIR)) {
    if (!entry.endsWith('.zip')) continue;
    const full = join(OUT_DIR, entry);
    if (full !== target) rmSync(full, { force: true });
  }

  const size = statSync(target).size;
  console.log(`\n  surf-rush packaged`);
  console.log(`  ${zip.entries.length} files, ${humanBytes(bytes)} uncompressed`);
  console.log(`  ${relative(ROOT, target)}  (${humanBytes(size)}, ${((1 - size / bytes) * 100).toFixed(0)}% saved)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

void createReadStream;
void basename;
