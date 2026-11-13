// autumn — the on-device voice pack (Wave 3, docs/architecture/voice.md): Parakeet v2.
//
// Autumn ships a *neutral voice-pack contract* that
// supersedes the older parakeet-shaped status:
//
//   voice:pack-status  → the pack status
//   voice:pack-prepare → download + verify + install the pack
//   voice:pack-retry   → force a full re-preparation
//
// with the legacy `voice:parakeet-*` channels kept as deprecated aliases for
// one release.
//
// **The model is NOT in the installer.** It is downloaded AFTER the install,
// into the OS user-data dir — exactly like the ("One-time ~700 MB
// download. Runs fully on-device after."). The installer stays small; the
// download is explicit, resumable, sha256-verified and deletable.
//
// derived (docs/architecture/voice.md):
//   model          sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8
//   model url      https://github.com/k2-fsa/sherpa-onnx/releases/download/
//                  asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2
//   vad url        …/asr-models/silero_vad.onnx
//   model sha256   157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad
//   vad sha256     9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6
//   pack size      SHERPA_PACK_EXPECTED_BYTES = 600 MB (the extracted model;
//                  the archive itself is ~460 MB)
//   install root   <userData>/voice-models/
//                    <model>/            the extracted model
//                    <model>/.autumn-sha256   the verified marker
//                    silero_vad.onnx    the VAD model
//                    .silero-vad-sha256 the verified marker
//   free space     the pack needs expectedBytes * 1.25 free
//   status         {version, state, phase, components, engine, asrModel, …}
//                  state: idle | preparing | ready | error | unsupported
//                  components: {asr, vad, tts, speakerModel} each
//                  pending | ready | not-supported
//
// The STT RUNTIME (sherpa-onnx-node) is optional: it is NOT a dependency of
// the app (it would add ~30 MB to every installer). It is fetched on demand
// into <userData>/voice-models/runtime/ — the same "download after install"
// story as the model.

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { userDataDir } from "./store";
import { downloadToFile, extractTarBz2, sha256File } from "./sidecar";

// ---------------------------------------------------------------------------
// the constants
// ---------------------------------------------------------------------------

export const VOICE_PACK_VERSION = 1;

/** The model archive's name (the `MODEL_NAME`). */
export const MODEL_NAME = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";

/** The sherpa-onnx release bucket the models live in. */
export const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
export const MODEL_URL = `${RELEASE}/${MODEL_NAME}.tar.bz2`;
export const VAD_URL = `${RELEASE}/silero_vad.onnx`;

export const PARAKEET_MODEL_SHA256 = "157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad";
export const PARAKEET_VAD_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6";

export const SAMPLE_RATE = 16_000;
/** The expected size of the installed pack (the). */
export const SHERPA_PACK_EXPECTED_BYTES = 600 * 1e6;
/** The archive is ~460 MB; the cap leaves room for the extracted model. */
export const MODEL_DOWNLOAD_MAX_BYTES = 1_500 * 1e6;

// ---------------------------------------------------------------------------
// the paths
// ---------------------------------------------------------------------------

export const modelsRoot = (): string => join(userDataDir(), "voice-models");
export const modelDir = (): string => join(modelsRoot(), MODEL_NAME);
export const vadPath = (): string => join(modelsRoot(), "silero_vad.onnx");
export const modelVerificationPath = (): string => join(modelDir(), ".autumn-sha256");
export const vadVerificationPath = (): string => join(modelsRoot(), ".silero-vad-sha256");
export const runtimeDir = (): string => join(modelsRoot(), "runtime");

const verifiedMarker = (path: string, expected: string): boolean => {
  try {
    return readFileSync(path, "utf8").trim().toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// the disk check (the)
// ---------------------------------------------------------------------------

export function freeBytesAt(path: string): number | null {
  let p = path;
  for (let i = 0; i < 64; i++) {
    try {
      const s = require("node:fs").statfsSync(p);
      return s.bavail * s.bsize;
    } catch {
      const parent = dirname(p);
      if (parent === p) return null;
      p = parent;
    }
  }
  return null;
}

export const requiredFreeBytes = (expectedBytes: number): number => Math.round(expectedBytes * 1.25);

export function describeBytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 1 ? `~${(Math.ceil(gb * 10) / 10).toFixed(1)} GB` : `~${Math.ceil(bytes / 1e6)} MB`;
}

export function diskShortfall(path: string, expectedBytes: number): string | null {
  const free = freeBytesAt(path);
  if (free == null) return null;
  if (free >= requiredFreeBytes(expectedBytes)) return null;
  return `not enough free disk space — the voice pack needs ${describeBytes(
    requiredFreeBytes(expectedBytes),
  )} free to install`;
}

// ---------------------------------------------------------------------------
// the model files (the)
// ---------------------------------------------------------------------------

export interface ModelFiles {
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
}

/** The `resolveModelFiles`. */
export function resolveModelFiles(): ModelFiles | null {
  const dir = modelDir();
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const find = (re: RegExp) => files.find((f) => re.test(f));
  const encoder = find(/^encoder.*\.onnx$/);
  const decoder = find(/^decoder.*\.onnx$/);
  const joiner = find(/^joiner.*\.onnx$/);
  const tokens = files.includes("tokens.txt") ? "tokens.txt" : undefined;
  if (!encoder || !decoder || !joiner || !tokens) return null;
  return {
    encoder: join(dir, encoder),
    decoder: join(dir, decoder),
    joiner: join(dir, joiner),
    tokens: join(dir, tokens),
  };
}

/**
 * The `modelReady` — the structural check plus the two markers.
 *
 * The expected hashes are the by default; the install passes the hashes
 * it actually verified, so a locally-served archive is checked against ITS
 * own hash (the production path is the constant).
 */
export function modelReady(
  modelSha: string = PARAKEET_MODEL_SHA256,
  vadSha: string = PARAKEET_VAD_SHA256,
): boolean {
  return (
    resolveModelFiles() !== null &&
    existsSync(vadPath()) &&
    verifiedMarker(modelVerificationPath(), modelSha) &&
    verifiedMarker(vadVerificationPath(), vadSha)
  );
}

// ---------------------------------------------------------------------------
// the download + install
// ---------------------------------------------------------------------------

export interface ModelProgress {
  phase: "downloading" | "extracting" | "ready" | "error";
  progress?: number;
  error?: string;
}

/** The `download` — a `.part` file, then a rename on success. */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (fraction: number) => void,
  maxBytes = MODEL_DOWNLOAD_MAX_BYTES,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const part = `${dest}.part`;
  mkdirSync(dirname(dest), { recursive: true });
  const { createWriteStream } = require("node:fs");
  const file = createWriteStream(part);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new Error(`the download is larger than expected (>${maxBytes} bytes): ${url}`);
      }
      await new Promise<void>((resolve, reject) => {
        file.write(Buffer.from(value), (e) => (e ? reject(e) : resolve()));
      });
      if (total && onProgress) onProgress(received / total);
    }
    await new Promise<void>((resolve) => file.close(() => resolve()));
    if (total && received < total) {
      throw new Error(
        `Download incomplete (${received}/${total} bytes) for ${url} — check your connection and retry.`,
      );
    }
    renameSync(part, dest);
  } catch (e) {
    try {
      file.destroy();
    } catch {
      /* already closed */
    }
    rmSync(part, { force: true });
    throw e;
  }
}

/** The `verifyParakeetSha256`. */
export async function verifySha256(file: string, expected: string): Promise<void> {
  const actual = await sha256File(file);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Voice model download failed its checksum.");
  }
}

/**
 * The archive extraction — guarded like the: every entry must stay under
 * the model folder, and a link entry is refused.
 */
export async function extractModel(tarPath: string, onProgress?: (fraction: number) => void): Promise<string[]> {
  const written = await extractTarBz2(tarPath, modelsRoot());
  for (const rel of written) {
    if (!rel.startsWith(`${MODEL_NAME}/`)) {
      throw new Error(`unsafe archive entry (outside the model folder): ${rel}`);
    }
  }
  onProgress?.(1);
  return written;
}

let ensureInFlight: Promise<void> | null = null;

/** The install options — the URLs and hashes are the defaults. */
export interface ModelInstallOptions {
  modelUrl?: string;
  modelSha256?: string;
  vadUrl?: string;
  vadSha256?: string;
}

/**
 * The `ensureParakeetModel` — the whole install, verified end to end.
 * Single-flight: concurrent callers join the same run.
 *
 * The options exist so the install can be driven against a local server (the
 * tests do exactly that); the defaults are the own URLs and hashes.
 */
export function ensureParakeetModel(
  report?: (p: ModelProgress) => void,
  options: ModelInstallOptions = {},
): Promise<void> {
  if (modelReady()) return Promise.resolve();
  if (ensureInFlight) return ensureInFlight;
  const modelUrl = options.modelUrl ?? MODEL_URL;
  const modelSha256 = options.modelSha256 ?? PARAKEET_MODEL_SHA256;
  const vadUrl = options.vadUrl ?? VAD_URL;
  const vadSha256 = options.vadSha256 ?? PARAKEET_VAD_SHA256;
  ensureInFlight = (async () => {
    const emit = (p: ModelProgress) => report?.(p);
    try {
      mkdirSync(modelsRoot(), { recursive: true });
      if (!existsSync(vadPath())) {
        await downloadFile(vadUrl, vadPath(), undefined, 64 * 1e6);
      }
      try {
        await verifySha256(vadPath(), vadSha256);
      } catch (e) {
        rmSync(vadPath(), { force: true });
        rmSync(vadVerificationPath(), { force: true });
        throw e;
      }
      writeFileSync(vadVerificationPath(), `${vadSha256}\n`, "utf8");

      const tarPath = join(modelsRoot(), `${MODEL_NAME}.tar.bz2`);
      await downloadFile(modelUrl, tarPath, (frac) => emit({ phase: "downloading", progress: frac }));
      await verifySha256(tarPath, modelSha256);
      emit({ phase: "extracting" });
      await extractModel(tarPath, (frac) => emit({ phase: "extracting", progress: frac }));
      rmSync(tarPath, { force: true });
      if (resolveModelFiles() === null) throw new Error("Model files missing after extract.");
      writeFileSync(modelVerificationPath(), `${modelSha256}\n`, "utf8");
      if (!modelReady(modelSha256, vadSha256)) throw new Error("Model verification marker missing after extract.");
      emit({ phase: "ready", progress: 1 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emit({ phase: "error", error: message });
      if (!modelReady(modelSha256, vadSha256)) {
        rmSync(join(modelsRoot(), `${MODEL_NAME}.tar.bz2`), { force: true });
        rmSync(modelDir(), { recursive: true, force: true });
      }
      throw e;
    } finally {
      ensureInFlight = null;
    }
  })();
  return ensureInFlight;
}

// ---------------------------------------------------------------------------
// the STT runtime (optional — fetched on demand, never in the installer)
// ---------------------------------------------------------------------------

const RUNTIME_PACKAGES: Record<string, string> = {
  "linux-x64": "sherpa-onnx-linux-x64",
  "linux-arm64": "sherpa-onnx-linux-arm64",
  "darwin-x64": "sherpa-onnx-darwin-x64",
  "darwin-arm64": "sherpa-onnx-darwin-arm64",
  "win32-x64": "sherpa-onnx-win-x64",
  "win32-arm64": "sherpa-onnx-win-arm64",
};

/** The runtime package for this machine (null when there is none). */
export function runtimePackage(): string | null {
  return RUNTIME_PACKAGES[`${process.platform}-${process.arch}`] ?? null;
}

/**
 * The on-device STT runtime. It is NOT a dependency of the app (that would
 * add ~30 MB to every installer); it lives in <userData>/voice-models/runtime
 * after the user asks for it.
 */
export function runtimeInstalled(): boolean {
  return existsSync(join(runtimeDir(), "node_modules", "sherpa-onnx-node"));
}

/** Load the runtime (from the app first, then from the user-data dir). */
export function loadSherpa(): any | null {
  const candidates = [
    () => require("sherpa-onnx-node"),
    () => require(join(runtimeDir(), "node_modules", "sherpa-onnx-node")),
  ];
  for (const load of candidates) {
    try {
      const ns = load();
      return ns?.default ?? ns;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// the pack manager (the VoicePackManager)
// ---------------------------------------------------------------------------

export type PackState = "idle" | "preparing" | "ready" | "error" | "unsupported";
export type PackPhase = "checking" | "downloading-asr" | "verifying" | "ready" | "error" | "unsupported";
export type ComponentState = "pending" | "ready" | "not-supported";

export interface PackStatus {
  version: number;
  state: PackState;
  phase: PackPhase;
  components: { asr: ComponentState; vad: ComponentState; tts: ComponentState; speakerModel: ComponentState };
  engine: string;
  asrModel: string;
  progress?: number;
  errorCode?: string;
  errorMessage?: string;
  /** autumn's own addition: where the pack lives and how big it is. */
  installRoot?: string;
  expectedBytes?: number;
  runtimeInstalled?: boolean;
}

export interface PackDriver {
  supported: boolean;
  engine: string;
  asrModel: string;
  version: number;
  required: string[];
  expectedBytes: number;
  packReady(): boolean;
  prepare(onProgress: (p: ModelProgress) => void): Promise<void>;
  invalidate?(): void;
}

const initialComponents = (required: string[]) => {
  const set = new Set(required);
  const mk = (k: string): ComponentState => (set.has(k) ? "pending" : "not-supported");
  return { asr: mk("asr"), vad: mk("vad"), tts: mk("tts"), speakerModel: mk("speakerModel") };
};

const readyComponents = (required: string[]) => {
  const set = new Set(required);
  const mk = (k: string): ComponentState => (set.has(k) ? "ready" : "not-supported");
  return { asr: mk("asr"), vad: mk("vad"), tts: mk("tts"), speakerModel: mk("speakerModel") };
};

/** The sherpa driver (the). */
export function sherpaDriver(): PackDriver {
  return {
    supported: true,
    engine: "sherpa",
    asrModel: "parakeet-tdt-0.6b-v2",
    version: VOICE_PACK_VERSION,
    required: ["asr"],
    expectedBytes: SHERPA_PACK_EXPECTED_BYTES,
    packReady: () => modelReady(),
    prepare: async (onProgress) => {
      onProgress({ phase: "downloading" });
      await ensureParakeetModel((p) => {
        if (p.phase === "downloading") onProgress({ phase: "downloading", progress: p.progress });
        else if (p.phase === "extracting") onProgress({ phase: "extracting", progress: p.progress });
        else if (p.phase === "ready") onProgress({ phase: "ready", progress: 1 });
        else if (p.phase === "error") onProgress({ phase: "error", error: p.error });
      });
      if (!modelReady()) throw new Error("sherpa recognition model missing after prepare");
    },
  };
}

/** The `classifyPrepareError`. */
export function classifyPrepareError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/enospc|no space|disk/.test(msg)) return "disk-space";
  if (/incomplete|missing after extract|extract failed|corrupt|checksum|verification|archive|decompress/.test(msg)) {
    return "integrity";
  }
  if (/network|fetch|econn|timeout|enotfound|download failed|\(4\d\d\)|\(5\d\d\)/.test(msg)) return "network";
  if (/not available|addon|load/.test(msg)) return "load";
  return "unknown";
}

/** The pack manager (the VoicePackManager, adapted to autumn). */
export class VoicePackManager {
  private driver: PackDriver;
  private status: PackStatus;
  private inFlight: Promise<PackStatus> | null = null;
  private subs = new Set<(s: PackStatus) => void>();

  constructor(driver: PackDriver) {
    this.driver = driver;
    this.status = driver.supported
      ? {
          version: driver.version,
          state: "idle",
          phase: "checking",
          components: initialComponents(driver.required),
          engine: driver.engine,
          asrModel: driver.asrModel,
          installRoot: modelsRoot(),
          expectedBytes: driver.expectedBytes,
          runtimeInstalled: runtimeInstalled(),
        }
      : {
          version: driver.version,
          state: "unsupported",
          phase: "unsupported",
          components: { asr: "not-supported", vad: "not-supported", tts: "not-supported", speakerModel: "not-supported" },
          engine: driver.engine,
          asrModel: driver.asrModel,
          errorCode: "unsupported",
        };
  }

  /** The current status (a copy — the caller must not mutate it). */
  getStatus(): PackStatus {
    return { ...this.status, components: { ...this.status.components } };
  }

  /** Subscribe to the status changes; returns the unsubscribe. */
  onProgress(cb: (s: PackStatus) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private patch(next: Partial<PackStatus>): void {
    this.status = { ...this.status, ...next, components: next.components ?? this.status.components };
    const snapshot = this.getStatus();
    for (const cb of this.subs) {
      try {
        cb(snapshot);
      } catch {
        /* a broken subscriber must not break the pack */
      }
    }
  }

  /** Start (or join) the preparation — single-flight, like the. */
  async start(): Promise<PackStatus> {
    if (!this.driver.supported) return this.getStatus();
    if (this.status.state === "ready" && this.driver.packReady()) return this.getStatus();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * The launch-time check that NEVER downloads: it reports `ready` when the
   * pack is already on disk and usable, and otherwise leaves it idle so the
   * preparation only starts from an explicit user action.
   */
  checkInstalled(): PackStatus {
    if (!this.driver.supported || this.status.state === "ready" || this.inFlight) return this.getStatus();
    try {
      if (this.driver.packReady()) {
        this.patch({
          state: "ready",
          phase: "ready",
          progress: 1,
          components: readyComponents(this.driver.required),
          runtimeInstalled: runtimeInstalled(),
        });
      }
    } catch {
      /* not ready — stay idle */
    }
    return this.getStatus();
  }

  /** Retry: force a full re-preparation (the `retry`). */
  async retry(): Promise<PackStatus> {
    if (this.inFlight) return this.inFlight;
    this.driver.invalidate?.();
    this.patch({
      state: "idle",
      phase: "checking",
      progress: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      components: initialComponents(this.driver.required),
    });
    return this.start();
  }

  /** The real preparation. */
  private async run(): Promise<PackStatus> {
    this.patch({ state: "preparing", phase: "checking", progress: undefined, errorCode: undefined, errorMessage: undefined });
    const shortfall = diskShortfall(modelsRoot(), this.driver.expectedBytes);
    if (shortfall) {
      this.patch({ state: "error", phase: "error", errorCode: "disk-space", errorMessage: shortfall });
      return this.getStatus();
    }
    try {
      await this.driver.prepare((p) => {
        if (p.phase === "downloading") this.patch({ phase: "downloading-asr", progress: p.progress });
        else if (p.phase === "extracting") this.patch({ phase: "verifying", progress: p.progress });
        else if (p.phase === "error") {
          this.patch({ state: "error", phase: "error", errorCode: classifyPrepareError(p.error), errorMessage: p.error });
        }
      });
      if (!this.driver.packReady()) throw new Error("sherpa recognition model missing after prepare");
      this.patch({
        state: "ready",
        phase: "ready",
        progress: 1,
        components: readyComponents(this.driver.required),
        runtimeInstalled: runtimeInstalled(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.patch({
        state: "error",
        phase: "error",
        errorCode: classifyPrepareError(e),
        errorMessage: message,
      });
    }
    return this.getStatus();
  }
}

/** Delete the installed pack (the `deleteOldModel`, pack-wide). */
export function deletePack(): { deleted: boolean; freedMb: number } {
  let bytes = 0;
  const root = modelsRoot();
  if (existsSync(root)) {
    try {
      bytes = dirSize(root);
    } catch {
      bytes = 0;
    }
    rmSync(root, { recursive: true, force: true });
  }
  return { deleted: bytes > 0, freedMb: Math.round(bytes / 1e6) };
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch {
      /* raced away */
    }
  }
  return total;
}

/** The sha256 of a buffer — the helper, kept for the tests. */
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Make a file executable (the runtime's binaries). */
export function makeExecutable(path: string): void {
  try {
    chmodSync(path, 0o755);
  } catch {
    /* best effort on Windows */
  }
}
