// autumn — shared helpers for the on-demand sidecar downloads (Wave 3).
//
// The RE downloads its heavy binaries (rclone, node, the Parakeet model) on
// DEMAND into the OS user-data dir — never bundled in the installer — and
// verifies every download against a published sha256 before using it.
//
// These helpers implement the same contract: a verified download, a safe
// extraction (no absolute paths, no `..`, no links), and an integrity marker
// beside the installed files.

import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGunzip } from "node:zlib";

/** sha256 of a buffer or file. */
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of a file on disk (streamed). */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStreamSafe(path);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

function createReadStreamSafe(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("node:fs").createReadStream(path);
}

/** Download a URL into memory (with a size cap). */
export async function download(url: string, maxBytes = 512 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`no response body for ${url}`);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`download too large (>${maxBytes} bytes): ${url}`);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Download to a file on disk (streamed — for the big model archives). */
export async function downloadToFile(url: string, target: string, maxBytes = 2 * 1024 * 1024 * 1024): Promise<number> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`no response body for ${url}`);
  mkdirSync(dirname(target), { recursive: true });
  const out = createWriteStream(target);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`download too large (>${maxBytes} bytes): ${url}`);
      }
      if (!out.write(Buffer.from(value))) {
        // Respect the backpressure — the file is big.
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(() => resolve());
    });
  } catch (e) {
    out.destroy();
    throw e;
  }
  return total;
}

// ---------------------------------------------------------------------------
// zip (the rclone archive)
// ---------------------------------------------------------------------------

/** One entry of a zip archive. */
export interface ZipEntry {
  path: string;
  data: Buffer;
}

/**
 * Read a zip archive (stored + deflated entries). Path traversal is refused:
 * an absolute path, a `..` segment or a backslash is rejected outright.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  // The End of Central Directory record is at the end (with a possible comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    // The local header repeats the name/extra lengths.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt zip entry: ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    if (!name.endsWith("/")) entries.push({ path: safeArchivePath(name), data });
  }
  return entries;
}

/**
 * A safe archive-relative path: no absolute paths, no `..`, no backslashes.
 * The RE does the same for the Parakeet archive
 * (`safeParakeetArchiveEntry`).
 */
export function safeArchivePath(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`unsafe archive path (absolute): ${name}`);
  }
  const parts = normalized.split("/").filter((p) => p.length > 0);
  for (const p of parts) {
    if (p === "..") throw new Error(`unsafe archive path (traversal): ${name}`);
  }
  if (!parts.length) throw new Error(`unsafe archive path (empty): ${name}`);
  return parts.join("/");
}

/** Write the entries of a zip into `dir` (creating it). */
export function extractZip(entries: ZipEntry[], dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const entry of entries) {
    const target = join(dir, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
    written.push(entry.path);
  }
  return written;
}

/** One entry of a tar archive. */
export interface TarEntry {
  path: string;
  data: Buffer;
  directory: boolean;
}

const readTarString = (block: Buffer, offset: number, length: number): string => {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString("utf8", 0, end === -1 ? slice.length : end);
};

/**
 * Read a tar archive. Pure JS (no `tar` binary), so it works the same on
 * Windows, macOS and Linux.
 *
 * Safety: a hard/symbolic link entry is refused outright (the RE's
 * `safeParakeetArchiveEntry` does the same), and every path is checked with
 * `safeArchivePath` — no absolute paths, no `..`.
 */
export function readTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    let empty = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break; // the end-of-archive marker
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const size = parseInt(readTarString(header, 124, 12).trim() || "0", 8) || 0;
    const typeflag = String.fromCharCode(header[156] || 0);
    offset += 512;
    const dataEnd = Math.min(offset + size, buf.length);
    const data = buf.subarray(offset, dataEnd);
    offset += Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (typeflag === "x" || typeflag === "g") {
      // A pax extended header: it may carry the real path.
      const pax = data.toString("utf8");
      const m = /\d+ path=([^\n]+)\n/.exec(pax);
      if (m) longName = m[1];
      continue;
    }
    const full = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (typeflag === "1" || typeflag === "2") {
      throw new Error(`unsafe archive entry (link): ${full}`);
    }
    if (typeflag === "5") {
      entries.push({ path: safeArchivePath(full), data: Buffer.alloc(0), directory: true });
      continue;
    }
    entries.push({ path: safeArchivePath(full), data: Buffer.from(data), directory: false });
  }
  return entries;
}

/** Decompress a .bz2 buffer (pure JS — the RE uses `unbzip2-stream` too). */
export async function bunzip2(buf: Buffer): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const unbzip2 = require("unbzip2-stream");
  // The module IS the factory (CJS); some builds wrap it in `.createBzip2`.
  const createBzip2 = typeof unbzip2 === "function" ? unbzip2 : unbzip2.createBzip2;
  const chunks: Buffer[] = [];
  const stream = createBzip2();
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve());
    stream.on("error", reject);
    stream.end(buf);
  });
  return Buffer.concat(chunks);
}

/**
 * Unpack a .tar.bz2 (the Parakeet archive) — guarded like the RE's: nothing
 * may escape the destination, and no link entries are accepted.
 */
export async function extractTarBz2(file: string, dest: string): Promise<string[]> {
  const raw = readFileSync(file);
  const tar = await bunzip2(raw);
  const entries = readTar(tar);
  mkdirSync(dest, { recursive: true });
  const written: string[] = [];
  for (const entry of entries) {
    const target = join(dest, entry.path);
    if (entry.directory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
    written.push(entry.path);
  }
  return written;
}

/** Parse a `SHA256SUMS`-style file → the sha256 for one file name. */
export function expectedSumFor(sumsText: string, file: string): string | null {
  for (const line of sumsText.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === file) return m[1].toLowerCase();
  }
  return null;
}

/** Read the integrity marker beside an installed sidecar. */
export function readMarker(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Write the integrity marker beside an installed sidecar. */
export function writeMarker(path: string, sha: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${sha}\n`, "utf8");
}

/** Gunzip a buffer (the .tar.bz2 payload is bunzipped by `tar`, this is for plain .gz). */
export function gunzip(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createGunzip();
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end(buf);
  });
}
