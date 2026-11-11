// autumn — Wave-2 handlers: voice (15 dispatchable; doc 32 §2f).
//
// RE-derived (October app.asar out/main/index.js):
//   micPermission  — RE micPermissionStatus(): "unknown" unless darwin/win32, then
//     systemPreferences.getMediaAccessStatus("microphone") mapped granted→"granted",
//     denied|restricted→"denied", not-determined→"prompt", else "unknown" (string).
//   ensureMicAccess — RE: win32 → status!=="denied"; darwin → real askForMediaAccess;
//     any other platform → true (boolean).
//   openMicSettings — RE: darwin → x-apple.systempreferences URL, win32 →
//     ms-settings:privacy-microphone, else {opened:false, guidance} (autumn wording).
//   speak(text) — RE voiceSpeak: String(text ?? "").slice(0, 500); engine returns a
//     BOOLEAN the renderer awaits ("playback finished") → autumn spawns the platform
//     TTS (say / powershell System.Speech / spd-say) and resolves true on exit 0,
//     false when the TTS binary is absent or the run fails. Never a truthy object.
//   stopSpeak — kills the tracked TTS child (boolean: killed something or not).
//   reportUsage — RE validates a usage report ({sessionId, purpose, seconds}) and
//     answers {ok:false, code:"invalid_request"} on a bad shape → autumn stores real
//     counters in <userData>/voice/usage.json (also accepts doc's {kind, ms}).
//   deleteOldModel — RE returns {deleted, freedMb} → autumn deletes stale files
//     under <userData>/voice/cache/ (default older than 30 days).
//   mic — RE exposes voice.mic as a nested control object (start/stop/mute/unmute/
//     lockBypass); flat manifest id → {action:"..."} (record mode per doc §2f:
//     ffmpeg capture to <userData>/voice/<ts>.wav; ffmpeg absent → honest
//     {supported:false, reason}).
//   deepgramToken / openaiRealtimeToken — NO fake tokens, ever: env key required
//     (DEEPGRAM_API_KEY / OPENAI_API_KEY), else {supported:false, reason}; with a
//     key a real main-process HTTPS mint runs and failures surface as error
//     envelopes (doc 32 §2f — main-process https/fetch only, never renderer).
//
// Boundary ids (doc 32 §2a — never implemented, never faked):
//   compile, cancelCompile, intentReady, parakeet, voicePack → not-implemented.
//
// Deviation from doc §2f (recorded in §7): openMicSettings on Linux returns
// {opened:false, guidance} rather than a not-implemented envelope — the envelope
// is reserved for the enumerated boundary ids.

import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";
import { loadJson, saveJson, userDataDir } from "./store";
import { paramsOf, str, ostr, pick, lazyElectron, resolveBin } from "./params";

const notImplemented = (what: string) => ({
  ok: false as const,
  error: { code: "not-implemented" as const, message: what },
});
const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

const voiceDir = () => join(userDataDir(), "voice");
const usageFile = () => join(voiceDir(), "usage.json");
const cacheDir = () => join(voiceDir(), "cache");

interface Usage {
  sessions: number;
  seconds: number;
  byKind: Record<string, { count: number; ms: number }>;
}
function readUsage(): Usage {
  const u = loadJson<Usage>(usageFile(), { sessions: 0, seconds: 0, byKind: {} });
  return { sessions: u.sessions ?? 0, seconds: u.seconds ?? 0, byKind: u.byKind ?? {} };
}

/** Platform TTS argv, or null when this platform has no known TTS binary. */
function ttsFor(text: string, opts: { voice?: string; rate?: number }): { bin: string; args: string[] } | null {
  if (process.platform === "darwin") {
    const args: string[] = [];
    if (typeof opts.rate === "number" && opts.rate > 0) args.push("-r", String(Math.round(opts.rate)));
    if (opts.voice) args.push("-v", opts.voice);
    args.push(text);
    return { bin: "say", args };
  }
  if (process.platform === "win32") {
    // argv-passed PowerShell (no shell interpolation → no injection).
    const rate = typeof opts.rate === "number" && opts.rate > 0 ? `; $s.Rate = ${Math.round(opts.rate)}` : "";
    const voice = opts.voice ? `; $s.SelectVoice(${JSON.stringify(opts.voice)})` : "";
    const script =
      "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer" +
      rate +
      voice +
      `; $s.Speak(${JSON.stringify(text)})`;
    return { bin: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
  const args: string[] = [];
  if (typeof opts.rate === "number" && opts.rate > 0) args.push("-r", String(Math.round(opts.rate)));
  args.push("-w", text); // -w: wait for playback to finish (matches the awaited boolean)
  return { bin: "spd-say", args };
}

export function makeVoiceHandlers(deps: W1Deps): RegisteredHandler[] {
  const { spawn, now } = deps;

  // Live children (module scope — cleared between tests via require.cache).
  let speaking: ChildProcLike | null = null;
  let recording: { proc: ChildProcLike; path: string; startedAt: number } | null = null;
  let muted = false;
  let lockBypass = false;

  const handlers: RegisteredHandler[] = [
    // ----- microphone platform probes ----------------------------------------
    {
      kind: "bridge",
      id: "voice.micPermission",
      description:
        "microphone permission status (RE micPermissionStatus); params: {} -> 'granted'|'denied'|'prompt'|'unknown' (string; 'unknown' without the Electron systemPreferences API)",
      handler: () => {
        if (process.platform !== "darwin" && process.platform !== "win32") return "unknown";
        const sp = lazyElectron()?.systemPreferences;
        if (!sp?.getMediaAccessStatus) return "unknown";
        try {
          const status = sp.getMediaAccessStatus("microphone");
          if (status === "granted") return "granted";
          if (status === "denied" || status === "restricted") return "denied";
          if (status === "not-determined") return "prompt";
          return "unknown";
        } catch {
          return "unknown";
        }
      },
    },
    {
      kind: "bridge",
      id: "voice.ensureMicAccess",
      description:
        "ensure microphone access (RE ensureMicAccess); params: {} -> boolean (win32: not-denied; darwin: real askForMediaAccess when Electron is present; other platforms: true)",
      handler: async () => {
        if (process.platform === "win32") {
          const sp = lazyElectron()?.systemPreferences;
          if (!sp?.getMediaAccessStatus) return true; // RE: non-granted status on win32 without the API → not denied
          try {
            return sp.getMediaAccessStatus("microphone") !== "denied";
          } catch {
            return true;
          }
        }
        if (process.platform !== "darwin") return true; // RE: every other platform → true
        const sp = lazyElectron()?.systemPreferences;
        if (!sp) return false; // cannot prompt without Electron — honest false, not a fake grant
        try {
          if (sp.getMediaAccessStatus("microphone") === "granted") return true;
          return await sp.askForMediaAccess("microphone");
        } catch {
          return false;
        }
      },
    },
    {
      kind: "bridge",
      id: "voice.openMicSettings",
      description:
        "open the OS microphone privacy settings (RE); params: {} -> {opened:true} (darwin/win32 via shell.openExternal) | {opened:false, guidance} on Linux or without Electron — guidance, not an error",
      handler: async () => {
        const electron = lazyElectron();
        const urls: Record<string, string> = {
          darwin: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
          win32: "ms-settings:privacy-microphone",
        };
        const url = urls[process.platform];
        if (url && electron?.shell?.openExternal) {
          try {
            await electron.shell.openExternal(url);
            return { opened: true };
          } catch {
            /* fall through to guidance */
          }
        }
        return {
          opened: false,
          guidance:
            process.platform === "linux"
              ? "Microphone controls vary by Linux desktop. Open your system Sound or Privacy settings and allow microphone access for Autumn."
              : "Open your system's Privacy → Microphone settings and allow microphone access for Autumn.",
        };
      },
    },

    // ----- TTS -----------------------------------------------------------------
    {
      kind: "bridge",
      id: "voice.speak",
      description:
        "speak text with the OS TTS (RE voiceSpeak: positional text, sliced to 500 chars); params: text or {text, voice?, rate?} -> boolean (true only when the platform TTS actually ran to completion; false when unavailable/failed)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const raw = str(obj, pos, "text");
        const text = (raw ?? "").slice(0, 500);
        if (!text) return false;
        const tts = ttsFor(text, { voice: ostr(obj, "voice"), rate: typeof obj.rate === "number" ? obj.rate : undefined });
        if (!tts || !resolveBin(tts.bin)) return false;
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const done = (v: boolean) => {
            if (settled) return;
            settled = true;
            if (speaking === child) speaking = null;
            resolve(v);
          };
          let child: ChildProcLike;
          try {
            child = spawn.spawn(tts.bin, tts.args, {});
          } catch {
            resolve(false);
            return;
          }
          speaking = child;
          child.on("error", () => done(false));
          child.on("exit", (code) => done(code === 0));
        });
      },
    },
    {
      kind: "bridge",
      id: "voice.stopSpeak",
      description: "stop OS TTS playback (RE engineStopSpeaking); params: {} -> boolean (true when a live utterance was killed)",
      handler: () => {
        if (!speaking) return false;
        try {
          speaking.kill();
        } catch {
          /* already dead */
        }
        speaking = null;
        return true;
      },
    },

    // ----- mic capture / control ---------------------------------------------
    {
      kind: "bridge",
      id: "voice.mic",
      description:
        "microphone control (RE voice.mic: start/stop/mute/unmute/lockBypass + doc §2f record mode); params: {action:'start'|'stop'|'mute'|'unmute'|'lockBypass'|'state', durationMs?, outFile?} -> action results; start records via ffmpeg → {supported:false, reason} when ffmpeg is absent",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const action = str(obj, pos, "action") ?? (obj.durationMs || obj.outFile ? "start" : "state");
        if (action === "mute") {
          muted = true;
          return { muted, state: recording ? "recording" : "idle" };
        }
        if (action === "unmute") {
          muted = false;
          return { muted, state: recording ? "recording" : "idle" };
        }
        if (action === "lockBypass") {
          const on = obj.on !== undefined ? obj.on : pos[1]; // action rides at pos[0]
          if (typeof on !== "boolean") return badParams("on must be boolean");
          lockBypass = on;
          return { lockBypass };
        }
        if (action === "state") {
          return {
            state: recording ? "recording" : "idle",
            muted,
            lockBypass,
            ...(recording ? { path: recording.path, startedAt: recording.startedAt } : {}),
          };
        }
        if (action === "stop") {
          if (!recording) return { stopped: false, state: "idle" };
          const current = recording; // snapshot: the exit listener nulls `recording` synchronously
          try {
            current.proc.kill();
          } catch {
            /* already exited */
          }
          let bytes = 0;
          try {
            bytes = statSync(current.path).size;
          } catch {
            /* output not flushed — report 0 honestly */
          }
          const out = { stopped: true, path: current.path, bytes, durationMs: now() - current.startedAt };
          recording = null;
          return out;
        }
        if (action === "start") {
          if (recording) return { started: true, path: recording.path, alreadyRecording: true };
          const bin = resolveBin("ffmpeg");
          if (!bin) return { supported: false, reason: "ffmpeg required for mic capture" };
          const outFile =
            typeof obj.outFile === "string" && obj.outFile.length > 0
              ? obj.outFile
              : join(voiceDir(), `${Date.now()}.wav`);
          const durationMs = typeof obj.durationMs === "number" && obj.durationMs > 0 ? Math.min(obj.durationMs, 60_000) : 10_000;
          mkdirSync(voiceDir(), { recursive: true });
          // Platform capture source (doc §2f: dshow / avfoundation / alsa).
          const src: string[] =
            process.platform === "win32"
              ? ["-f", "dshow", "-i", "audio=Microphone"]
              : process.platform === "darwin"
                ? ["-f", "avfoundation", "-i", ":0"]
                : ["-f", "alsa", "-i", "default"];
          const args = ["-y", ...src, "-t", String(Math.max(1, Math.round(durationMs / 1000))), outFile];
          try {
            const proc = spawn.spawn(bin, args, {});
            recording = { proc, path: outFile, startedAt: now() };
            proc.on("error", () => {
              if (recording?.proc === proc) recording = null;
            });
            proc.on("exit", () => {
              if (recording?.proc === proc) recording = null;
            });
            return { started: true, path: outFile, durationMs, recording: true };
          } catch (e) {
            return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
          }
        }
        return badParams(`unknown mic action: ${action}`);
      },
    },

    // ----- BYO cloud tokens (never faked) -------------------------------------
    {
      kind: "bridge",
      id: "voice.deepgramToken",
      description:
        "mint a scoped Deepgram token; params: {} -> {token, expiresAt, scoped:true} via a REAL main-process HTTPS call when DEEPGRAM_API_KEY is set, else {supported:false, reason} — no fake tokens, ever",
      handler: async () => {
        const key = process.env.DEEPGRAM_API_KEY;
        if (!key) return { supported: false, reason: "DEEPGRAM_API_KEY not configured — set it to mint real Deepgram tokens" };
        try {
          const res = await fetch("https://api.deepgram.com/v1/auth/token", {
            method: "POST",
            headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
          });
          if (!res.ok) return { ok: false, error: { code: "handler-error", message: `Deepgram token request failed (${res.status})` } };
          const body = (await res.json()) as { access_token?: string; token?: string; expires_in?: number };
          const token = body.access_token ?? body.token;
          if (!token) return { ok: false, error: { code: "handler-error", message: "Deepgram returned no token" } };
          return { token, ...(body.expires_in ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}), scoped: true };
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },
    {
      kind: "bridge",
      id: "voice.openaiRealtimeToken",
      description:
        "mint an OpenAI Realtime session; params: {language?, delay?, model?, voice?} -> real session JSON from /v1/realtime/sessions when OPENAI_API_KEY is set (main-process HTTPS), else {supported:false, reason} — never a fabricated session",
      handler: async (params) => {
        const { obj } = paramsOf(params);
        const key = process.env.OPENAI_API_KEY;
        if (!key) return { supported: false, reason: "OPENAI_API_KEY not configured — set it to mint real Realtime sessions" };
        try {
          const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: obj.model ?? "gpt-4o-realtime-preview", voice: obj.voice ?? "alloy" }),
          });
          if (!res.ok) return { ok: false, error: { code: "handler-error", message: `OpenAI realtime session failed (${res.status})` } };
          return await res.json();
        } catch (e) {
          return { ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } };
        }
      },
    },

    // ----- usage / model cache ------------------------------------------------
    {
      kind: "bridge",
      id: "voice.reportUsage",
      description:
        "record voice usage counters; params: RE {sessionId, purpose, seconds} or doc {kind, ms} -> {ok:true, usage}; an unusable shape answers {ok:false, code:'invalid_request'} (RE) — counters persisted to <userData>/voice/usage.json",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const single = typeof params === "string" ? params : undefined;
        // object keys first; positional RE order is (sessionId, purpose, seconds)
        const sessionId = ostr(obj, "sessionId") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const purpose = ostr(obj, "purpose") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        const seconds = obj.seconds !== undefined ? obj.seconds : pos[2];
        const kind = ostr(obj, "kind");
        const ms = pick(obj, pos, "ms");
        const usage = readUsage();

        const reShape = sessionId !== undefined && purpose !== undefined && typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0;
        const docShape = (kind !== undefined && typeof ms === "number") || single !== undefined;
        if (reShape) {
          usage.sessions += 1;
          usage.seconds += seconds as number;
        } else if (docShape) {
          const k = kind ?? single ?? "voice";
          const bucket = usage.byKind[k] ?? { count: 0, ms: 0 };
          bucket.count += 1;
          bucket.ms += typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
          usage.byKind[k] = bucket;
        } else {
          return { ok: false, code: "invalid_request" };
        }
        mkdirSync(voiceDir(), { recursive: true });
        saveJson(usageFile(), usage);
        return { ok: true, usage };
      },
    },
    {
      kind: "bridge",
      id: "voice.deleteOldModel",
      description:
        "delete stale voice model/cache files; params: {olderThanDays?} (default 30) -> {deleted, freedMb} (RE shape) — real files under <userData>/voice/cache/ only",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const days = typeof obj.olderThanDays === "number" && obj.olderThanDays >= 0 ? obj.olderThanDays : 30;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let count = 0;
        let bytes = 0;
        try {
          mkdirSync(cacheDir(), { recursive: true });
          for (const name of readdirSync(cacheDir())) {
            const file = join(cacheDir(), name);
            try {
              const st = statSync(file);
              if (st.mtimeMs < cutoff) {
                if (st.isFile()) {
                  unlinkSync(file);
                  count += 1;
                  bytes += st.size;
                }
              }
            } catch {
              /* raced away */
            }
          }
        } catch {
          /* no cache dir — nothing to delete */
        }
        return { deleted: count > 0, freedMb: Math.round(bytes / 1e6) };
      },
    },

    // ----- boundary ids (doc 32 §2a) ------------------------------------------
    {
      kind: "bridge",
      id: "voice.compile",
      description:
        "compile a voice command; params: {} -> not-implemented envelope (voice-pack ecosystem, doc 32 §2a boundary id)",
      handler: () => notImplemented("autumn has no voice packs — compile is a platform-boundary id (doc 32 §2a)"),
    },
    {
      kind: "bridge",
      id: "voice.cancelCompile",
      description:
        "cancel a running voice compile; params: {} -> not-implemented envelope (voice-pack ecosystem, doc 32 §2a boundary id)",
      handler: () => notImplemented("autumn has no voice packs — cancelCompile is a platform-boundary id (doc 32 §2a)"),
    },
    {
      kind: "bridge",
      id: "voice.intentReady",
      description:
        "voice intent readiness; params: {} -> not-implemented envelope (voice-pack ecosystem, doc 32 §2a boundary id)",
      handler: () => notImplemented("autumn has no voice packs — intentReady is a platform-boundary id (doc 32 §2a)"),
    },
    {
      kind: "bridge",
      id: "voice.parakeet",
      description:
        "on-device STT engine control (RE voice.parakeet: status/ensureModel/start/stop); params: {action?} -> not-implemented envelope (~1 GB local STT model, doc 32 §2a boundary id)",
      handler: () => notImplemented("autumn does not ship the ~1 GB on-device STT model — parakeet is a platform-boundary id (doc 32 §2a)"),
    },
    {
      kind: "bridge",
      id: "voice.voicePack",
      description:
        "voice-pack status/prepare/retry (RE voice.voicePack); params: {action?} -> not-implemented envelope (voice-pack ecosystem, doc 32 §2a boundary id)",
      handler: () => notImplemented("autumn has no voice packs — voicePack is a platform-boundary id (doc 32 §2a)"),
    },
  ];

  return handlers;
}
