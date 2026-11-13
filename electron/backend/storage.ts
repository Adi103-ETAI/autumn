// autumn — Wave-3 handlers: storage (7 dispatchable; docs/architecture/storage.md).
//
// Autumn delegates cloud storage to a bundled, hash-verified
// **rclone** sidecar: it downloads `rclone-<version>-<os>-<arch>.zip` on
// demand into <userData>/rclone/bin, records the archive's sha256 beside it,
// and drives it with `rclone listremotes / lsjson / authorize / copy`.
//
// autumn keeps that architecture — it is genuinely local, and it keeps the
// installer small (the sidecar is ~25 MB and is downloaded when the user first
// uses cloud storage).
//
// The contract (docs/architecture/storage.md):
//   RCLONE_VERSION      "v1.74.3"
//   asset               rclone-<version>-{osx|windows|linux}-{arm64|amd64}.zip
//   install dir         <userData>/rclone
//   binary              <userData>/rclone/bin/rclone[.exe]
//   integrity marker    <userData>/rclone/bin/.rclone-archive-sha256
//   config              rclone.conf next to the binary
//   OAuth remotes       drive | dropbox | onedrive
//   parsers             listremotes → "name: type"; lsjson → {name,path,isDirectory,size,updatedAt};
//                       the authorize token is JSON between "---> {…} <---"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";
import { userDataDir } from "./store";
import { paramsOf, str, ostr, pick } from "./params";
import {
  download,
  expectedSumFor,
  extractZip,
  readMarker,
  readZip,
  safeArchivePath,
  sha256,
  writeMarker,
} from "./sidecar";

const RCLONE_VERSION = "v1.74.3";
// RCLONE_VERSION already carries the leading "v" (the value).
const SUMS_URL = `https://downloads.rclone.org/${RCLONE_VERSION}/SHA256SUMS`;
const OAUTH_REMOTES = ["drive", "dropbox", "onedrive"];

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});
const notFound = (message: string) => ({
  ok: false as const,
  error: { code: "not-found" as const, message },
});
const handlerError = (message: string) => ({
  ok: false as const,
  error: { code: "handler-error" as const, message },
});

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

const rcloneDir = () => join(userDataDir(), "rclone");
const rcloneBin = () => join(rcloneDir(), "bin", process.platform === "win32" ? "rclone.exe" : "rclone");
const rcloneConfig = () => join(rcloneDir(), "rclone.conf");
const rcloneMarker = () => join(rcloneDir(), "bin", ".rclone-archive-sha256");

/** The asset naming (docs/architecture/storage.md). */
export function rcloneAssetName(version: string, platform: string, arch: string): string | null {
  const os = platform === "darwin" ? "osx" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : null;
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : null;
  if (!os || !a) return null;
  return `rclone-${version}-${os}-${a}.zip`;
}

// ---------------------------------------------------------------------------
// output parsers (the shapes)
// ---------------------------------------------------------------------------

/** `rclone listremotes` → [{name, type}]. */
export function parseListremotes(stdout: string): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  for (const line of stdout.split("\n")) {
    const m = /^(.+?):\s+(\S+)\s*$/.exec(line);
    if (m) out.push({ name: m[1].trim(), type: m[2].trim() });
  }
  return out;
}

/** `rclone lsjson` → [{name, path, isDirectory, size?, updatedAt?}]. */
export function parseLsjson(stdout: string, parentUri: string): Array<{
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
}> {
  let rows: unknown;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const base = parentUri.endsWith("/") || parentUri.endsWith(":") ? parentUri : `${parentUri}/`;
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as Record<string, unknown>).Name === "string")
    .map((r) => ({
      name: r.Name as string,
      path: `${base}${r.Name as string}`,
      isDirectory: !!r.IsDir,
      ...(r.IsDir ? {} : typeof r.Size === "number" && r.Size >= 0 ? { size: r.Size } : {}),
      ...(typeof r.ModTime === "string" ? { updatedAt: r.ModTime } : {}),
    }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

/** `remote:path` → {remote, path} (null when it is not a remote URI). */
export function parseRemoteUri(uri: string): { remote: string; path: string } | null {
  if (uri.startsWith("/") || uri.startsWith("\\")) return null;
  const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(uri);
  if (!m) return null;
  if (m[1].length === 1) return null; // a drive letter, not a remote
  return { remote: m[1], path: m[2] };
}

/** The authorize token blob rclone prints between the `---> {…} <---` markers. */
export function parseAuthorizeToken(stdout: string): string | null {
  const m = /--->\s*([\s\S]*?)\s*<---/.exec(stdout);
  const blob = (m ? m[1] : stdout).trim();
  const start = blob.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < blob.length; i++) {
    if (blob[i] === "{") depth++;
    else if (blob[i] === "}" && --depth === 0) {
      try {
        const obj = JSON.parse(blob.slice(start, i + 1));
        if (obj && typeof obj === "object" && "access_token" in obj) return JSON.stringify(obj);
      } catch {
        /* not the token */
      }
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

export function makeStorageHandlers(deps: W1Deps): RegisteredHandler[] {
  const { spawn, now } = deps;

  /** A pending `rclone authorize` process (cancellable). */
  let pendingConnect: { child: ChildProcLike; remote: string; output: string; startedAt: number } | null = null;

  /** Run the rclone binary and collect its output. */
  function runRclone(args: string[], timeoutMs = 60_000): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((resolve) => {
      const bin = rcloneBin();
      if (!existsSync(bin)) {
        resolve({ code: null, out: "", err: "the rclone sidecar is not installed — run storage.ensure first" });
        return;
      }
      let out = "";
      let err = "";
      let settled = false;
      let child: ChildProcLike;
      try {
        child = spawn.spawn(bin, [...args, "--config", rcloneConfig()], {});
      } catch (e) {
        resolve({ code: null, out: "", err: String((e as Error)?.message ?? e) });
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }, timeoutMs);
      if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
        (timer as unknown as { unref: () => void }).unref();
      }
      child.stdout?.on?.("data", (chunk: Buffer | string) => {
        out += String(chunk);
      });
      child.stderr?.on?.("data", (chunk: Buffer | string) => {
        err += String(chunk);
      });
      child.on("error", (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, out, err: err || e.message });
      });
      child.on("exit", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, out, err });
      });
    });
  }

  /** Is the sidecar installed AND verified? */
  function sidecarState(): { ready: boolean; path: string; verified: boolean; reason?: string } {
    const bin = rcloneBin();
    if (!existsSync(bin)) {
      return { ready: false, path: bin, verified: false, reason: "the rclone sidecar is not downloaded yet" };
    }
    const marker = readMarker(rcloneMarker());
    if (!marker) {
      return { ready: true, path: bin, verified: false, reason: "the sidecar is not checksum-verified" };
    }
    return { ready: true, path: bin, verified: true };
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "storage.ensure",
      description:
        "make the rclone sidecar available; params: {version?} -> {ready, path, version, verified?, reason?} — downloads the platform zip from downloads.rclone.org, verifies it against the published SHA256SUMS, unpacks it into <userData>/rclone and records the integrity marker (never bundled in the installer)",
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const version = typeof obj.version === "string" && obj.version ? obj.version : RCLONE_VERSION;
        const state = sidecarState();
        if (state.ready && state.verified) {
          return { ready: true, path: state.path, version, verified: true };
        }
        const asset = rcloneAssetName(version, process.platform, process.arch);
        if (!asset) {
          return {
            ready: false,
            reason: `no rclone build for ${process.platform}/${process.arch} — the sidecar cannot be installed here`,
          };
        }
        try {
          const sums = await download(`https://downloads.rclone.org/${version}/SHA256SUMS`, 2 * 1024 * 1024);
          const expected = expectedSumFor(sums.toString("utf8"), asset);
          if (!expected) {
            return { ready: false, reason: `the published checksums do not cover ${asset}` };
          }
          const archive = await download(`https://downloads.rclone.org/${version}/${asset}`, 128 * 1024 * 1024);
          const actual = sha256(archive);
          if (actual !== expected) {
            return { ready: false, reason: `the downloaded rclone archive failed its checksum (${actual})` };
          }
          const entries = readZip(archive);
          // The archive holds the binary (and a licence); move it into bin/.
          mkdirSync(join(rcloneDir(), "bin"), { recursive: true });
          for (const entry of entries) {
            const name = entry.path.split("/").pop() ?? entry.path;
            if (!name || name.includes(".")) continue; // only the binary
            const target = join(rcloneDir(), "bin", process.platform === "win32" ? "rclone.exe" : "rclone");
            writeFileSync(target, entry.data);
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              require("node:fs").chmodSync(target, 0o755);
            } catch {
              /* best effort on Windows */
            }
          }
          writeMarker(rcloneMarker(), actual);
          return { ready: true, path: rcloneBin(), version, verified: true };
        } catch (e) {
          return { ready: false, reason: `the rclone sidecar could not be downloaded: ${(e as Error)?.message ?? e}` };
        }
      },
    },
    {
      kind: "bridge",
      id: "storage.remotes",
      description:
        "list the configured storage remotes; params: {} -> [{name, type}] (the real rclone.conf, read with rclone listremotes)",
      handler: async () => {
        const state = sidecarState();
        if (!state.ready) return { supported: false, reason: state.reason };
        const res = await runRclone(["listremotes"]);
        if (res.code !== 0) {
          return { ok: false, error: { code: "handler-error", message: res.err.trim() || "rclone listremotes failed" } };
        }
        return parseListremotes(res.out);
      },
    },
    {
      kind: "bridge",
      id: "storage.connect",
      description:
        "start an OAuth connection for a remote; params: {remote, type?} -> {status, remote, url?} — runs the real rclone authorize; the token blob it prints is stored in the config",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.remote === "string" && obj.remote.length > 0
          ? { ok: true }
          : { ok: false, message: "remote required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const remote = obj.remote as string;
        const type = typeof obj.type === "string" ? obj.type : "drive";
        if (!OAUTH_REMOTES.includes(type)) {
          return badParams(`unsupported remote type ${type} (expected one of ${OAUTH_REMOTES.join(", ")})`);
        }
        const state = sidecarState();
        if (!state.ready) return { supported: false, reason: state.reason };
        if (pendingConnect) {
          return { ok: false, error: { code: "handler-error", message: "a connection is already in progress" } };
        }
        const bin = rcloneBin();
        let child: ChildProcLike;
        try {
          child = spawn.spawn(bin, ["authorize", type, "--config", rcloneConfig()], {});
        } catch (e) {
          return handlerError(`could not start rclone authorize: ${(e as Error)?.message ?? e}`);
        }
        const pending = { child, remote: type, output: "", startedAt: now() };
        pendingConnect = pending;
        child.stdout?.on?.("data", (chunk: Buffer | string) => {
          pending.output += String(chunk);
        });
        child.stderr?.on?.("data", (chunk: Buffer | string) => {
          pending.output += String(chunk);
        });
        child.on("exit", (code: number | null) => {
          const finished = pendingConnect;
          pendingConnect = null;
          if (!finished) return;
          const token = parseAuthorizeToken(finished.output);
          if (token) {
            // The token is appended to the config as a [remote] section.
            const conf = existsSync(rcloneConfig()) ? readFileSync(rcloneConfig(), "utf8") : "";
            writeFileSync(rcloneConfig(), `${conf}\n[${type}]\ntype = ${type}\n${token}\n`, "utf8");
          }
          void code;
        });
        // The browser URL rclone prints is what the user has to open.
        const url = /https?:\/\/[^\s"']+/.exec(pending.output)?.[0] ?? null;
        return { status: "authorizing", remote: type, ...(url ? { url } : {}) };
      },
    },
    {
      kind: "bridge",
      id: "storage.cancelConnect",
      description:
        "cancel a pending storage connection; params: {} -> {cancelled: bool} (kills the running rclone authorize)",
      handler: async () => {
        if (!pendingConnect) return { cancelled: false };
        const pending = pendingConnect;
        pendingConnect = null;
        try {
          pending.child.kill();
        } catch {
          /* already gone */
        }
        return { cancelled: true };
      },
    },
    {
      kind: "bridge",
      id: "storage.disconnect",
      description:
        "disconnect a storage remote; params: {remote} -> {disconnected: bool} (the real rclone config disconnect)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        return typeof obj.remote === "string" && obj.remote.length > 0
          ? { ok: true }
          : { ok: false, message: "remote required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const remote = obj.remote as string;
        const state = sidecarState();
        if (!state.ready) return { supported: false, reason: state.reason };
        const res = await runRclone(["config", "disconnect", remote]);
        return { disconnected: res.code === 0 };
      },
    },
    {
      kind: "bridge",
      id: "storage.list",
      description:
        "list the files on a storage remote; params: {remote|uri, path?} -> [{name, path, isDirectory, size?, updatedAt?}] (the real rclone lsjson)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        const uri = obj.uri ?? (typeof obj.remote === "string" ? `${obj.remote}:${typeof obj.path === "string" ? obj.path : ""}` : undefined);
        return typeof uri === "string" && uri.length > 0
          ? { ok: true }
          : { ok: false, message: "remote or uri required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const uri =
          typeof obj.uri === "string" && obj.uri
            ? obj.uri
            : `${obj.remote as string}:${typeof obj.path === "string" ? obj.path : ""}`;
        if (!parseRemoteUri(uri)) return badParams(`not a remote uri: ${uri}`);
        const state = sidecarState();
        if (!state.ready) return { supported: false, reason: state.reason };
        const res = await runRclone(["lsjson", uri]);
        if (res.code !== 0) {
          return { ok: false, error: { code: "handler-error", message: res.err.trim() || `rclone lsjson failed for ${uri}` } };
        }
        return parseLsjson(res.out, uri);
      },
    },
    {
      kind: "bridge",
      id: "storage.importToLibrary",
      description:
        "copy a file from a storage remote into the local library; params: {remote|uri, targetDir} -> {path, bytes} (the real rclone copy)",
      schema: (p) => {
        const { obj } = paramsOf(p);
        const uri = obj.uri ?? (typeof obj.remote === "string" ? `${obj.remote}:${typeof obj.path === "string" ? obj.path : ""}` : undefined);
        return typeof uri === "string" && uri.length > 0 && typeof obj.targetDir === "string" && obj.targetDir.length > 0
          ? { ok: true }
          : { ok: false, message: "remote (or uri) and targetDir required" };
      },
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const uri =
          typeof obj.uri === "string" && obj.uri
            ? obj.uri
            : `${obj.remote as string}:${typeof obj.path === "string" ? obj.path : ""}`;
        if (!parseRemoteUri(uri)) return badParams(`not a remote uri: ${uri}`);
        const targetDir = obj.targetDir as string;
        const state = sidecarState();
        if (!state.ready) return { supported: false, reason: state.reason };
        mkdirSync(targetDir, { recursive: true });
        const res = await runRclone(["copy", uri, targetDir], 300_000);
        if (res.code !== 0) {
          return { ok: false, error: { code: "handler-error", message: res.err.trim() || `rclone copy failed for ${uri}` } };
        }
        const name = uri.split("/").filter(Boolean).pop() ?? "download";
        const path = join(targetDir, name);
        let bytes = 0;
        try {
          bytes = require("node:fs").statSync(path).size;
        } catch {
          /* rclone may have renamed it — report the copy without a size */
        }
        return { path, bytes };
      },
    },
  ];

  return handlers;
}
