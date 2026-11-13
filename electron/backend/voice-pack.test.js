"use strict";
// layer-1 tests for the on-device voice pack (docs/architecture/voice.md): the Parakeet model.
//
// THE WHOLE INSTALL PIPELINE IS EXERCISED FOR REAL against a local HTTP
// server: the archive is really downloaded, really sha256-verified, really
// decompressed (bzip2) and really extracted — and the traversal guard, the
// verification markers and the "ready" state are all checked on disk.
//
// The model is ~460 MB in production, so the test drives the install with the
// SAME code against a small archive served locally (the URLs and the hashes
// are the install options; the defaults are the).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
require("../ts-register");
const { useTempUserData } = require("./store.ts");

const {
  MODEL_NAME,
  MODEL_URL,
  VAD_URL,
  PARAKEET_MODEL_SHA256,
  PARAKEET_VAD_SHA256,
  SHERPA_PACK_EXPECTED_BYTES,
  VOICE_PACK_VERSION,
  SAMPLE_RATE,
  modelsRoot,
  modelDir,
  vadPath,
  modelVerificationPath,
  vadVerificationPath,
  modelReady,
  resolveModelFiles,
  ensureParakeetModel,
  verifySha256,
  downloadFile,
  VoicePackManager,
  sherpaDriver,
  classifyPrepareError,
  diskShortfall,
  requiredFreeBytes,
  describeBytes,
  deletePack,
  runtimePackage,
  runtimeInstalled,
} = require("./voice-pack.ts");
const { sha256 } = require("./voice-pack.ts");
const { readTar, extractTarBz2, safeArchivePath } = require("./sidecar.ts");

// ---------------------------------------------------------------------------
// a tiny tar writer (so the test can build a REAL archive)
// ---------------------------------------------------------------------------

function tarHeader(name, size, typeflag = "0") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii"); // the checksum placeholder
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  // The checksum is computed with the checksum field filled with spaces.
  header.write("        ", 148, 8, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

/** Build a tar archive from {path, data} entries. */
function makeTar(files) {
  const blocks = [];
  for (const file of files) {
    const data = Buffer.from(file.data ?? "");
    blocks.push(tarHeader(file.path, data.length, file.type ?? "0"));
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // the end-of-archive marker
  return Buffer.concat(blocks);
}

/** Compress with the system bzip2 (the test skips when it is missing). */
function bzip2(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autumn-bz2-"));
  const src = path.join(dir, "in.tar");
  fs.writeFileSync(src, buf);
  execFileSync("bzip2", ["-kf", src]);
  const out = fs.readFileSync(`${src}.bz2`);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function hasBzip2() {
  try {
    execFileSync("bzip2", ["--help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The model files the `resolveModelFiles` looks for. */
const MODEL_FILES = [
  { path: `${MODEL_NAME}/encoder.int8.onnx`, data: "encoder" },
  { path: `${MODEL_NAME}/decoder.int8.onnx`, data: "decoder" },
  { path: `${MODEL_NAME}/joiner.int8.onnx`, data: "joiner" },
  { path: `${MODEL_NAME}/tokens.txt`, data: "tokens" },
];

beforeEach(() => {
  useTempUserData();
});

// ---------------------------------------------------------------------------
// the constants (the)
// ---------------------------------------------------------------------------

test("the pack's constants are the", () => {
  assert.equal(MODEL_NAME, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8");
  assert.equal(
    MODEL_URL,
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
  );
  assert.equal(VAD_URL, "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx");
  assert.equal(PARAKEET_MODEL_SHA256, "157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad");
  assert.equal(PARAKEET_VAD_SHA256, "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6");
  assert.equal(SHERPA_PACK_EXPECTED_BYTES, 600 * 1e6);
  assert.equal(VOICE_PACK_VERSION, 1);
  assert.equal(SAMPLE_RATE, 16000);
});

test("the model is NOT in the installer — it lives in the user-data dir", () => {
  assert.match(modelsRoot(), /voice-models$/);
  assert.notEqual(modelsRoot(), __dirname);
  assert.ok(modelsRoot().includes(".autumn") || process.env.AUTUMN_USER_DATA_DIR);
});

// ---------------------------------------------------------------------------
// the readiness check
// ---------------------------------------------------------------------------

test("modelReady is false until the model AND the two markers are there", () => {
  assert.equal(modelReady(), false);
  // The model files alone are not enough.
  fs.mkdirSync(modelDir(), { recursive: true });
  for (const file of MODEL_FILES) fs.writeFileSync(path.join(modelDir(), path.basename(file.path)), file.data);
  assert.equal(resolveModelFiles() !== null, true, "the files are found");
  assert.equal(modelReady(), false, "the verification markers are still missing");
  fs.writeFileSync(vadPath(), "vad");
  fs.writeFileSync(modelVerificationPath(), `${PARAKEET_MODEL_SHA256}\n`);
  fs.writeFileSync(vadVerificationPath(), `${PARAKEET_VAD_SHA256}\n`);
  assert.equal(modelReady(), true);
});

// ---------------------------------------------------------------------------
// the download + verify + extract (the real pipeline)
// ---------------------------------------------------------------------------

test("the whole install really happens: download → sha256 → bzip2 → extract → markers", async (t) => {
  if (!hasBzip2()) {
    t.skip("no bzip2 on this machine");
    return;
  }
  // The local server serves the model archive and the VAD model.
  const archive = bzip2(makeTar(MODEL_FILES));
  const archiveSha = sha256(archive);
  const vad = Buffer.from("silero-vad-bytes");
  const vadSha = sha256(vad);

  const server = http.createServer((req, res) => {
    if (req.url === "/model.tar.bz2") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": archive.length });
      res.end(archive);
      return;
    }
    if (req.url === "/silero_vad.onnx") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": vad.length });
      res.end(vad);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  try {
    const progress = [];
    await ensureParakeetModel(
      (p) => progress.push(p),
      {
        modelUrl: `http://127.0.0.1:${port}/model.tar.bz2`,
        modelSha256: archiveSha,
        vadUrl: `http://127.0.0.1:${port}/silero_vad.onnx`,
        vadSha256: vadSha,
      },
    );

    // The files are really on disk.
    assert.equal(modelReady(archiveSha, vadSha), true, "the pack is ready");
    const files = resolveModelFiles();
    assert.ok(files, "the model files resolve");
    for (const key of ["encoder", "decoder", "joiner", "tokens"]) {
      assert.ok(fs.existsSync(files[key]), `${key} exists`);
    }
    assert.ok(fs.existsSync(vadPath()));
    // The markers carry the verified hashes.
    assert.equal(fs.readFileSync(modelVerificationPath(), "utf8").trim(), archiveSha);
    assert.equal(fs.readFileSync(vadVerificationPath(), "utf8").trim(), vadSha);
    // The archive is removed after the install.
    assert.equal(fs.existsSync(path.join(modelsRoot(), `${MODEL_NAME}.tar.bz2`)), false);
    // The progress really reported the download and the ready state.
    assert.ok(progress.some((p) => p.phase === "downloading"));
    assert.ok(progress.some((p) => p.phase === "ready"));
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test("a corrupted archive is refused — the checksum really guards the install", async (t) => {
  if (!hasBzip2()) {
    t.skip("no bzip2 on this machine");
    return;
  }
  const archive = bzip2(makeTar(MODEL_FILES));
  const server = http.createServer((req, res) => {
    if (req.url === "/model.tar.bz2") {
      res.writeHead(200, { "content-length": archive.length });
      res.end(archive);
      return;
    }
    if (req.url === "/silero_vad.onnx") {
      res.writeHead(200, { "content-length": 4 });
      res.end("vad!");
      return;
    }
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await assert.rejects(
      () =>
        ensureParakeetModel(undefined, {
          modelUrl: `http://127.0.0.1:${port}/model.tar.bz2`,
          modelSha256: "0".repeat(64), // the WRONG hash
          vadUrl: `http://127.0.0.1:${port}/silero_vad.onnx`,
          vadSha256: sha256(Buffer.from("vad!")),
        }),
      /checksum/,
    );
    assert.equal(modelReady(), false, "a failed checksum leaves the pack unusable");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test("verifySha256 really compares the hash", async () => {
  const file = path.join(os.tmpdir(), `autumn-sha-${process.pid}.bin`);
  fs.writeFileSync(file, "hello");
  await verifySha256(file, sha256("hello"));
  await assert.rejects(() => verifySha256(file, "0".repeat(64)), /checksum/);
  fs.rmSync(file, { force: true });
});

// ---------------------------------------------------------------------------
// the traversal guard
// ---------------------------------------------------------------------------

test("the archive reader refuses a path that escapes the destination", () => {
  assert.equal(safeArchivePath("model/file.onnx"), "model/file.onnx");
  assert.throws(() => safeArchivePath("/etc/passwd"), /absolute/);
  assert.throws(() => safeArchivePath("../escape"), /traversal/);
  assert.throws(() => safeArchivePath("a/../../escape"), /traversal/);
});

test("a link entry in the archive is refused", () => {
  const tar = makeTar([{ path: `${MODEL_NAME}/link`, data: "", type: "2" }]);
  assert.throws(() => readTar(tar), /link/);
});

test("an escaping path in the archive is refused before anything is written", () => {
  const tar = makeTar([{ path: "../escape.txt", data: "x" }]);
  assert.throws(() => readTar(tar), /traversal/);
});

test("the tar reader reads the real entries", () => {
  const tar = makeTar(MODEL_FILES);
  const entries = readTar(tar);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].path, `${MODEL_NAME}/encoder.int8.onnx`);
  assert.equal(entries[0].data.toString(), "encoder");
});

// ---------------------------------------------------------------------------
// the disk check
// ---------------------------------------------------------------------------

test("the disk check is the (1.25x the pack size)", () => {
  assert.equal(requiredFreeBytes(SHERPA_PACK_EXPECTED_BYTES), 750_000_000);
  assert.equal(describeBytes(750_000_000), "~750 MB");
  assert.equal(describeBytes(2_000_000_000), "~2.0 GB");
  // The tmp dir has room here, so there is no shortfall.
  assert.equal(diskShortfall(os.tmpdir(), SHERPA_PACK_EXPECTED_BYTES), null);
});

// ---------------------------------------------------------------------------
// the pack manager
// ---------------------------------------------------------------------------

test("the pack manager: idle → prepare → ready, with the progress pushed", async (t) => {
  if (!hasBzip2()) {
    t.skip("no bzip2 on this machine");
    return;
  }
  const archive = bzip2(makeTar(MODEL_FILES));
  const vad = Buffer.from("vad-bytes");
  const server = http.createServer((req, res) => {
    if (req.url === "/model.tar.bz2") {
      res.writeHead(200, { "content-length": archive.length });
      res.end(archive);
      return;
    }
    res.writeHead(200, { "content-length": vad.length });
    res.end(vad);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  // A driver over the local server (the same shape as the sherpa driver).
  const driver = {
    ...sherpaDriver(),
    packReady: () => modelReady(sha256(archive), sha256(vad)),
    prepare: async (onProgress) => {
      onProgress({ phase: "downloading", progress: 0.5 });
      await ensureParakeetModel(undefined, {
        modelUrl: `http://127.0.0.1:${port}/model.tar.bz2`,
        modelSha256: sha256(archive),
        vadUrl: `http://127.0.0.1:${port}/silero_vad.onnx`,
        vadSha256: sha256(vad),
      });
    },
  };
  const manager = new VoicePackManager(driver);
  const seen = [];
  manager.onProgress((s) => seen.push(s));

  const idle = manager.getStatus();
  assert.equal(idle.state, "idle");
  assert.equal(idle.phase, "checking");
  assert.equal(idle.version, 1);
  assert.equal(idle.engine, "sherpa");
  assert.equal(idle.asrModel, "parakeet-tdt-0.6b-v2");
  assert.equal(idle.components.asr, "pending");
  assert.equal(idle.components.vad, "not-supported");
  assert.equal(idle.components.tts, "not-supported");

  const ready = await manager.start();
  assert.equal(ready.state, "ready");
  assert.equal(ready.phase, "ready");
  assert.equal(ready.progress, 1);
  assert.equal(ready.components.asr, "ready");
  assert.ok(seen.length > 1, "the progress was really pushed");
  assert.ok(seen.some((s) => s.state === "preparing"));

  // A second start is a no-op (it is ready).
  const again = await manager.start();
  assert.equal(again.state, "ready");
  await new Promise((r) => server.close(r));
});

test("the pack manager reports a failure honestly", async () => {
  const driver = {
    ...sherpaDriver(),
    prepare: async () => {
      throw new Error("Download failed (503) for https://example.invalid/model.tar.bz2");
    },
  };
  const manager = new VoicePackManager(driver);
  const res = await manager.start();
  assert.equal(res.state, "error");
  assert.equal(res.phase, "error");
  assert.equal(res.errorCode, "network");
  assert.match(res.errorMessage, /503/);
});

test("classifyPrepareError is the", () => {
  assert.equal(classifyPrepareError(new Error("ENOSPC: no space left on device")), "disk-space");
  assert.equal(classifyPrepareError(new Error("Voice model download failed its checksum.")), "integrity");
  assert.equal(classifyPrepareError(new Error("Download failed (500)")), "network");
  assert.equal(classifyPrepareError(new Error("the addon could not be loaded")), "load");
  assert.equal(classifyPrepareError(new Error("something else")), "unknown");
});

test("deletePack really removes the installed pack", () => {
  fs.mkdirSync(modelDir(), { recursive: true });
  fs.writeFileSync(path.join(modelDir(), "encoder.onnx"), "x".repeat(2048));
  fs.writeFileSync(vadPath(), "vad");
  const res = deletePack();
  assert.equal(res.deleted, true);
  assert.ok(res.freedMb >= 0);
  assert.equal(fs.existsSync(modelsRoot()), false);
});

// ---------------------------------------------------------------------------
// the runtime (optional — never in the installer)
// ---------------------------------------------------------------------------

test("the STT runtime is optional and is not in the app tree", () => {
  // The runtime package for this machine (null where there is none).
  const pkg = runtimePackage();
  if (pkg) assert.match(pkg, /^sherpa-onnx-(linux|darwin|win32)-/);
  // It is not installed by default (it would add ~30 MB to every installer).
  assert.equal(runtimeInstalled(), false);
});
