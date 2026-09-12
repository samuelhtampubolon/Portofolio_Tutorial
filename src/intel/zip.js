/**
 * A minimal ZIP writer.
 *
 * The release package has to arrive as one file — a folder of eleven downloads
 * is not a deliverable — and pulling in a compression library for that would
 * break the project's one hard rule: no dependencies, no network, nothing to
 * install. So this writes the format by hand.
 *
 * Entries are STORED, not deflated. Deflate would need a full compressor for a
 * package that is mostly already-compressed PNG and binary STL, where the gain
 * is a few percent. A stored ZIP is a completely valid ZIP: every operating
 * system, archive tool and language runtime opens it.
 *
 * Deliberately not implemented: Zip64. Past 4GB the offsets in the central
 * directory overflow, so `zip()` refuses rather than writing an archive that
 * looks fine and unpacks as garbage. A CAD release package is megabytes.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return enc.encode(String(data));
}

/** MS-DOS date and time, which is what the format stores. */
function dosStamp(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

class Writer {
  constructor(size) { this.b = new Uint8Array(size); this.p = 0; }
  u16(v) { this.b[this.p++] = v & 0xff; this.b[this.p++] = (v >>> 8) & 0xff; }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  bytes(a) { this.b.set(a, this.p); this.p += a.length; }
}

/**
 * Build a ZIP.
 * @param {Array<{name: string, data: string|Uint8Array|ArrayBuffer, date?: Date}>} files
 * @returns {Blob}
 */
export function zip(files) {
  const entries = files
    .filter(f => f && f.name && f.data != null)
    .map((f) => {
      const name = enc.encode(f.name.replace(/^\/+/, ''));
      const data = toBytes(f.data);
      return { name, data, crc: crc32(data), ...dosStamp(f.date || new Date()) };
    });

  const localSize = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error('Package is larger than 4GB, which needs Zip64');

  const w = new Writer(total);
  const offsets = [];

  for (const e of entries) {
    offsets.push(w.p);
    w.u32(0x04034b50);      // local file header
    w.u16(20);              // version needed
    w.u16(0x0800);          // flags: UTF-8 names
    w.u16(0);               // method: stored
    w.u16(e.time); w.u16(e.day);
    w.u32(e.crc);
    w.u32(e.data.length);   // compressed
    w.u32(e.data.length);   // uncompressed
    w.u16(e.name.length);
    w.u16(0);               // no extra field
    w.bytes(e.name);
    w.bytes(e.data);
  }

  const centralStart = w.p;
  entries.forEach((e, i) => {
    w.u32(0x02014b50);      // central directory header
    w.u16(20); w.u16(20);   // version made by / needed
    w.u16(0x0800);
    w.u16(0);
    w.u16(e.time); w.u16(e.day);
    w.u32(e.crc);
    w.u32(e.data.length);
    w.u32(e.data.length);
    w.u16(e.name.length);
    w.u16(0); w.u16(0);     // extra, comment
    w.u16(0);               // disk number
    w.u16(0);               // internal attributes
    w.u32(0);               // external attributes
    w.u32(offsets[i]);
    w.bytes(e.name);
  });

  w.u32(0x06054b50);        // end of central directory
  w.u16(0); w.u16(0);
  w.u16(entries.length); w.u16(entries.length);
  w.u32(centralSize);
  w.u32(centralStart);
  w.u16(0);

  return new Blob([w.b.subarray(0, w.p)], { type: 'application/zip' });
}

export { crc32 };
