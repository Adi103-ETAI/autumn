# Voice

On-device speech recognition, and the voice-intent compiler.

```
electron/backend/voice-pack.ts   the pack: the model, the runtime, the manager
electron/backend/voice.ts         the fifteen voice methods
```

## The size question, answered

> **The model is not in the installer.**

| Artifact | Size | Where it lives | In the installer? |
|---|---:|---|---|
| The Parakeet model + the VAD model | ~600 MB | `<userData>/voice-models/` | ❌ **downloaded after the install** |
| The speech runtime | ~30 MB | `<userData>/voice-models/runtime/` | ❌ optional, fetched on demand |
| The tar reader + the bzip2 decompressor | ~140 KB | the app tree | ✅ (tiny) |

The installer stays at ~200 MB. The model is fetched the first time the user
asks for on-device speech, and it can be deleted again from the app.

## The pack

| | |
|---|---|
| Model | `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` |
| Engine | `sherpa` (the ASR model: `parakeet-tdt-0.6b-v2`) |
| Pack version | 1 |
| Components | `asr` (the rest are `not-supported` in this pack) |
| Expected size | 600 MB |
| Free space needed | 750 MB (the pack size plus a quarter) |

## The methods

| Method | What it does |
|---|---|
| `voice.voicePack` | The pack status — `status`, `prepare`, `retry` or `delete`. |
| `voice.parakeet` | The legacy status alias: `status` or `ensureModel`. |
| `voice.compile` | Compile a spoken command into an intent. |
| `voice.cancelCompile` | Cancel a running compile. |
| `voice.intentReady` | Whether the intent compiler is ready. |

The rest of the voice surface — the microphone, the platform TTS, the tokens,
the usage counters — is in `voice.ts` as well.

## The pack status

```js
{
  version: 1,
  state: "idle" | "preparing" | "ready" | "error" | "unsupported",
  phase: "checking" | "downloading-asr" | "verifying" | "ready" | "error",
  components: { asr: "pending" | "ready" | "not-supported", vad: …, tts: …, speakerModel: … },
  engine: "sherpa",
  asrModel: "parakeet-tdt-0.6b-v2",
  progress: 0.42,
  errorCode: "disk-space" | "integrity" | "network" | "load" | "unknown",
  errorMessage: "…"
}
```

**Reading the status never downloads anything.** The model is only fetched when
the user asks for it (`prepare`), so the app never surprises anybody with a
600 MB download.

## The install

```
1. the VAD model      → silero_vad.onnx        sha256-verified
2. the model archive  → …-parakeet-tdt-0.6b-v2-int8.tar.bz2   sha256-verified
3. the extraction     → pure JS: bzip2 → tar, path-guarded
4. the markers        → .autumn-sha256, .silero-vad-sha256
5. the readiness check→ encoder + decoder + joiner + tokens + both markers
```

Everything is verified before it is used:

- the archive's **sha256** must match the published one, or the install fails
  and nothing is left behind;
- the extraction **refuses** a path that escapes the model folder and
  **refuses** a link entry — nothing is written outside the destination;
- the model is only `ready` when the files are structurally complete **and**
  both markers are on disk.

The errors are classified, so the UI can say what went wrong:

| `errorCode` | When |
|---|---|
| `disk-space` | Not enough free space for the pack. |
| `integrity` | The checksum failed, or the extraction was incomplete. |
| `network` | The download failed. |
| `load` | The runtime could not be loaded. |
| `unknown` | Anything else. |

## The runtime

The speech runtime (`sherpa-onnx-node`) is **optional**. It is not a
dependency of the app — that would add ~30 MB to every installer — so:

- if it is installed, it is used;
- if it is not, `voice.parakeet` says so (`available:false` with the reason)
  and the pack manager still tracks the **model**, which is the big part.

The runtime is fetched on demand into `<userData>/voice-models/runtime/`.

## The voice-intent compiler

`voice.compile` turns a spoken command into an intent:

```js
await window.autumn.voice.compile({ utterance: "open the finder" });
// { kind: "steps", steps: [{ do: "open_finder", params: {} }], say: "opening" }
```

The shapes are the ones the compiler contract defines:

| Shape | Meaning |
|---|---|
| `{kind:"ask", ask, options?}` | The compiler needs the human to choose. |
| `{kind:"steps", steps, say?, expectsReply?}` | The plan. |
| `{kind:"reply", text}` | A plain answer. |

**The compile runs on a local provider** — an agent CLI that is installed on
the machine. There is no hosted fallback: if no provider is available, the
answer is an honest `ask`, never an invented intent.

```js
await window.autumn.voice.intentReady();
// { ready: false, reason: "no agent harness is installed on this machine …" }
```

`voice.cancelCompile` really aborts a compile that is running.

## The tests

`electron/backend/voice-pack.test.js` drives the **whole install pipeline**
against a local HTTP server: the archive is really downloaded, sha256-verified,
bzip2-decompressed and extracted, the markers are written and the pack really
becomes `ready`. It also asserts that a corrupted archive is refused by the
checksum, and that a traversing path and a link entry are refused before
anything is written.
