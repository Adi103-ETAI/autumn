// autumn — Wave-2 handlers: video (4 dispatchable; docs/architecture/backend.md).
//
// The contract:
//   pickInput — opens the native openFile dialog with filters
//     ["mp4","mov","m4v","webm","mkv","avi"] and resolves the picked path or
//     null when canceled → autumn does the same; WITHOUT the Electron runtime
//     there is no dialog, so it resolves null (nothing was selected — the
//     ported renderer's `if (!input) return;` stays truthful; never a fake path).
//   subtitle(input, opts) — positional; validates the input file exists, parses
//     the SRT (validates too; malformed → bad-params), then runs the real
//     ffmpeg transcode `-vf subtitles=…` to <dir>/<name>.subbed.mp4 (or opts.outPath).
//   bgm(input, audioPath, opts) — positional; mixes the audio track under the
//     video via ffmpeg filter_complex amix (volume-scaled) to <dir>/<name>.bgm.mp4.
//   cancel(input, kind?) — claims jobs PER INPUT (videoCancel(runningInput,
//     runningKind ?? undefined)) → kill the tracked ffmpeg child for that input
//     (optionally narrowed to a kind); nothing running → honest
//     {cancelled:false, reason} — not an error envelope.
//
// ffmpeg gate (docs/architecture/backend.md/§2h): absent from PATH → {supported:false, reason}
// per-op. Every run is a REAL child_process (deps.spawn — fakeable in tests,
// which is also what keeps Windows CI from needing ffmpeg), tracked in a
// per-input job registry, and journaled to <userData>/video/jobs.json (there is
// no manifest event for this namespace, so the journal is the progress record).
//
// W2-11 (FULL): ffmpeg's stderr carries the real progress ("time=00:00:12.34")
// — it is parsed and journaled per job (the progress record). `cancel` accepts
// the per-input shape AND a jobId, so a caller that only knows the job id
// can still stop the run. The output paths follow the (next to the input).

import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { ChildProcLike, W1Deps } from "./w1-deps";
import { userDataDir } from "./store";
import { paramsOf, str, ostr, pick, lazyElectron, resolveBin } from "./params";

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

type JobKind = "subtitle" | "bgm";
interface Job {
  jobId: string;
  input: string;
  kind: JobKind;
  proc: ChildProcLike;
  startedAt: number;
  outPath: string;
}
interface JobRecord {
  jobId: string;
  input: string;
  kind: JobKind;
  outPath: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "failed" | "cancelled";
  bytes?: number;
  ms?: number;
  tail?: string;
  /** The last progress ffmpeg reported ("time=00:00:12.34" → seconds). */
  progressSeconds?: number;
}

const videoDir = () => join(userDataDir(), "video");
const journalFile = () => join(videoDir(), "jobs.json");

function journal(rec: JobRecord): void {
  try {
    mkdirSync(videoDir(), { recursive: true });
    let list: JobRecord[] = [];
    try {
      const raw = JSON.parse(readFileSync(journalFile(), "utf8")) as JobRecord[] | { jobs: JobRecord[] };
      list = Array.isArray(raw) ? raw : (raw.jobs ?? []);
    } catch {
      list = [];
    }
    const idx = list.findIndex((r) => r.jobId === rec.jobId);
    if (idx >= 0) list[idx] = rec;
    else list.unshift(rec);
    writeFileSync(journalFile(), JSON.stringify(list.slice(0, 200), null, 2), "utf8");
  } catch {
    /* journaling is best-effort */
  }
}

/** Minimal strict SRT parse: every blank-line-separated block must be
 *  "index / timestamp --> timestamp / text". At least one block required. */
export function parseSrt(raw: string): { ok: true; cues: number } | { ok: false; message: string } {
  const blocks = raw.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  if (!blocks.length || (blocks.length === 1 && !blocks[0].trim())) return { ok: false, message: "malformed SRT: empty file" };
  let cues = 0;
  const ts = /^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}$/;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length);
    if (lines.length < 3) return { ok: false, message: `malformed SRT: block ${cues + 1} needs index, timestamps, and text` };
    if (!/^\d+$/.test(lines[0].trim())) return { ok: false, message: `malformed SRT: block ${cues + 1} index is not a number` };
    if (!ts.test(lines[1].trim())) return { ok: false, message: `malformed SRT: block ${cues + 1} has an invalid timestamp line` };
    cues++;
  }
  return { ok: true, cues };
}

/**
 * Does the file really carry an audio track? ffmpeg prints the stream table
 * to stderr; we read it (no output file is produced). The probe runs through
 * deps.spawn like every other child process (so it is fakeable in tests) and
 * never hangs: a probe that does not answer within PROBE_TIMEOUT_MS falls
 * back to "assume there is audio" (the classic mix path).
 */
const PROBE_TIMEOUT_MS = 5_000;

export function makeVideoHandlers(deps: W1Deps): RegisteredHandler[] {
  const { spawn, now } = deps;

  const live = new Map<string, Job>(); // key: `${input}::${kind}` (per-input claim)
  const keyOf = (input: string, kind?: JobKind) => (kind ? `${input}::${kind}` : input);
  const findJob = (input: string, kind?: JobKind): Job | undefined => {
    if (kind) return live.get(keyOf(input, kind));
    for (const [key, job] of live) if (key.startsWith(`${input}::`)) return job;
    return undefined;
  };

  /** Does the file carry an audio track? (real ffmpeg stream table) */
  function hasAudioTrack(bin: string, file: string): Promise<boolean> {
    return new Promise((resolve) => {
      let out = "";
      let settled = false;
      const finish = (hasAudio: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(hasAudio);
      };
      const timer = setTimeout(() => finish(true), PROBE_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
      let child: ChildProcLike;
      try {
        child = spawn.spawn(bin, ["-hide_banner", "-i", file], {});
      } catch {
        finish(true); // cannot probe → assume audio (the classic mix path)
        return;
      }
      child.stderr?.on?.("data", (chunk: Buffer | string) => {
        out += String(chunk);
      });
      child.stdout?.on?.("data", (chunk: Buffer | string) => {
        out += String(chunk);
      });
      child.on("error", () => finish(true));
      child.on("exit", () => finish(/Stream #\d+:\d+.*: Audio:/m.test(out)));
    });
  }

  /** Shared ffmpeg run: spawn, wait for exit, verify the output, journal it. */
  function runFfmpeg(bin: string, args: string[], meta: { input: string; kind: JobKind; outPath: string }): Promise<
    { ok: true; result: { path: string; bytes: number; durationMs: number; jobId: string } } | { ok: false; error: { code: string; message: string } }
  > {
    return new Promise((resolve) => {
      const jobId = `${meta.kind}-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const startedAt = now();
      let settled = false;
      const finish = (out: { ok: true; result: any } | { ok: false; error: { code: string; message: string } }) => {
        if (settled) return;
        settled = true;
        live.delete(keyOf(meta.input, meta.kind));
        resolve(out);
      };
      let child: ChildProcLike;
      try {
        child = spawn.spawn(bin, args, {});
      } catch (e) {
        finish({ ok: false, error: { code: "handler-error", message: String((e as Error)?.message ?? e) } });
        return;
      }
      const job: Job = { jobId, input: meta.input, kind: meta.kind, proc: child, startedAt, outPath: meta.outPath };
      live.set(keyOf(meta.input, meta.kind), job);
      journal({ jobId, input: meta.input, kind: meta.kind, outPath: meta.outPath, startedAt, status: "running" });

      let tail = "";
      let progressSeconds: number | undefined;
      child.stderr?.on?.("data", (chunk: Buffer | string) => {
        tail = `${tail}${String(chunk)}`.slice(-800);
        // ffmpeg reports progress as "time=00:00:12.34" — parse it for real.
        const m = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(chunk));
        if (m) {
          const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          if (Number.isFinite(secs) && (progressSeconds === undefined || secs > progressSeconds)) {
            progressSeconds = secs;
            journal({ jobId, input: meta.input, kind: meta.kind, outPath: meta.outPath, startedAt, status: "running", progressSeconds: secs });
          }
        }
      });
      child.on("error", (err: Error) => {
        journal({ jobId, input: meta.input, kind: meta.kind, outPath: meta.outPath, startedAt, endedAt: now(), status: "failed", tail: err.message });
        finish({ ok: false, error: { code: "handler-error", message: err.message } });
      });
      child.on("exit", (code: number | null) => {
        const ms = now() - startedAt;
        const progress = progressSeconds !== undefined ? { progressSeconds } : {};
        if (code === 0 && existsSync(meta.outPath)) {
          const bytes = statSync(meta.outPath).size;
          journal({ jobId, input: meta.input, kind: meta.kind, outPath: meta.outPath, startedAt, endedAt: now(), status: "done", bytes, ms, ...progress });
          finish({ ok: true, result: { path: meta.outPath, bytes, durationMs: ms, jobId, ...progress } });
        } else {
          const message = code === 0 ? `ffmpeg produced no output at ${meta.outPath}` : `ffmpeg exited ${code}${tail ? `: ${tail.split("\n").slice(-4).join(" ").trim()}` : ""}`;
          journal({ jobId, input: meta.input, kind: meta.kind, outPath: meta.outPath, startedAt, endedAt: now(), status: "failed", ms, tail, ...progress });
          finish({ ok: false, error: { code: "handler-error", message } });
        }
      });
    });
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "video.pickInput",
      description:
        "open the native video file picker (filters mp4/mov/m4v/webm/mkv/avi); params: {} -> path string | null (canceled — or no dialog without the Electron runtime; never a fabricated path)",
      handler: async () => {
        const dialog = lazyElectron()?.dialog;
        if (!dialog?.showOpenDialog) return null;
        try {
          const res = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] }],
          });
          if (res.canceled || !res.filePaths?.length) return null;
          return res.filePaths[0];
        } catch {
          return null;
        }
      },
    },
    {
      kind: "bridge",
      id: "video.subtitle",
      description:
        "burn subtitles into a video; params: input (positional) or {path, srtPath?, outPath?} — SRT parsed strictly (bad-params when malformed), real ffmpeg `-vf subtitles=` run to <dir>/<name>.subbed.mp4 -> {path, bytes, durationMs, jobId}; ffmpeg absent -> {supported:false, reason}",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        return str(obj, pos, "path", "input") || typeof pos[0] === "string" ? { ok: true } : { ok: false, message: "input required" };
      },
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const input = str(obj, pos, "path", "input") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        if (!input) return badParams("input required");
        if (!existsSync(input)) return notFound(`video not found: ${input}`);
        const base = basename(input, extname(input));
        const dir = dirname(input);
        const srtPath = ostr(obj, "srtPath") ?? (typeof pos[1] === "string" ? pos[1] : undefined) ?? join(dir, `${base}.srt`);
        if (!existsSync(srtPath)) return notFound(`subtitle file not found: ${srtPath}`);
        let srt: string;
        try {
          srt = readFileSync(srtPath, "utf8");
        } catch (e) {
          return handlerError(String((e as Error)?.message ?? e));
        }
        const parsed = parseSrt(srt);
        if (!parsed.ok) return badParams(parsed.message);
        const bin = resolveBin("ffmpeg");
        if (!bin) return { supported: false, reason: "ffmpeg required for media transcoding" };
        if (findJob(input, "subtitle")) return handlerError(`subtitle job already running for ${input} — cancel it first`);
        const outPath = ostr(obj, "outPath") ?? (typeof pos[2] === "string" ? pos[2] : undefined) ?? join(dir, `${base}.subbed.mp4`);
        // Path is passed via argv (no shell) — escape only the filter's quoting.
        const filterPath = srtPath.replace(/\\/g, "/").replace(/'/g, "\\'");
        const args = ["-y", "-i", input, "-vf", `subtitles=filename='${filterPath}'`, "-c:a", "copy", outPath];
        // Unwrap: success is the plain payload (registry adds {ok:true,result});
        // failure is already an envelope and passes through unchanged.
        const ran = await runFfmpeg(bin, args, { input, kind: "subtitle", outPath });
        return ran.ok ? ran.result : ran;
      },
    },
    {
      kind: "bridge",
      id: "video.bgm",
      description:
        "mix background music under a video; params: input, audioPath (positional (input, bgmPath)) or named — real ffmpeg amix (volume-scaled bgm, video stream copied) to <dir>/<name>.bgm.mp4 -> {path, bytes, durationMs, jobId}; ffmpeg absent -> {supported:false, reason}",
      schema: (p) => {
        const { obj, pos } = paramsOf(p);
        const input = ostr(obj, "path", "input") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const audio = ostr(obj, "audioPath", "bgmPath") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        return typeof input === "string" && typeof audio === "string"
          ? { ok: true }
          : { ok: false, message: "input and audioPath required" };
      },
      handler: async (params) => {
        const { obj, pos } = paramsOf(params);
        const input = ostr(obj, "path", "input") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const audio = ostr(obj, "audioPath", "bgmPath") ?? (typeof pos[1] === "string" ? pos[1] : undefined);
        if (!input || !audio) return badParams("input and audioPath required");
        if (!existsSync(input)) return notFound(`video not found: ${input}`);
        if (!existsSync(audio)) return notFound(`audio not found: ${audio}`);
        const bin = resolveBin("ffmpeg");
        if (!bin) return { supported: false, reason: "ffmpeg required for media transcoding" };
        if (findJob(input, "bgm")) return handlerError(`bgm job already running for ${input} — cancel it first`);
        const volume = typeof obj.volume === "number" && Number.isFinite(obj.volume) && obj.volume >= 0 ? obj.volume : 1;
        const base = basename(input, extname(input));
        const dir = dirname(input);
        const outPath = ostr(obj, "outPath") ?? (typeof pos[2] === "string" ? pos[2] : undefined) ?? join(dir, `${base}.bgm.mp4`);
        // Does the video really carry an audio track? A clip without one cannot
        // be mixed with [0:a] — the music simply becomes the audio track.
        const videoHasAudio = await hasAudioTrack(bin, input);
        const filter = videoHasAudio
          ? volume === 1
            ? `[0:a][1:a]amix=inputs=2:duration=first[a]`
            : `[1:a]volume=${volume}[a1];[0:a][a1]amix=inputs=2:duration=first[a]`
          : volume === 1
            ? `[1:a]anull[a]`
            : `[1:a]volume=${volume}[a]`;
        const args = [
          "-y",
          "-i",
          input,
          "-i",
          audio,
          "-filter_complex",
          filter,
          "-map",
          "0:v",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          outPath,
        ];
        const ran = await runFfmpeg(bin, args, { input, kind: "bgm", outPath });
        return ran.ok ? ran.result : ran;
      },
    },
    {
      kind: "bridge",
      id: "video.cancel",
      description:
        "cancel a running media job; params: input, kind? (positional (runningInput, runningKind ?? undefined)) or {jobId} -> {cancelled:true, jobId} | {cancelled:false, reason} when nothing runs for that input (the claim is per-input, like the target)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        // A caller that only knows the job id can still stop the run. The job
        // ids are `${kind}-<time36>-<rand>` — that shape is how a positional
        // argument is told apart from an input path.
        const firstPos = typeof pos[0] === "string" ? pos[0] : undefined;
        const positionalJobId = firstPos && /^(subtitle|bgm)-[a-z0-9]+-[a-z0-9]+$/.test(firstPos) ? firstPos : undefined;
        const jobId = ostr(obj, "jobId") ?? positionalJobId;
        if (jobId) {
          for (const [, job] of live) {
            if (job.jobId !== jobId) continue;
            try {
              job.proc.kill();
            } catch {
              /* raced to completion */
            }
            live.delete(keyOf(job.input, job.kind));
            journal({
              jobId: job.jobId,
              input: job.input,
              kind: job.kind,
              outPath: job.outPath,
              startedAt: job.startedAt,
              endedAt: now(),
              status: "cancelled",
              ms: now() - job.startedAt,
            });
            return { cancelled: true, jobId: job.jobId, kind: job.kind };
          }
          return { cancelled: false, reason: `no running media job with id ${jobId}` };
        }
        const input = str(obj, pos, "path", "input") ?? (typeof pos[0] === "string" ? pos[0] : undefined);
        const kindRaw = ostr(obj, "kind") ?? (typeof pos[1] === "string" ? (pos[1] as string) : undefined);
        if (!input) return badParams("input required");
        if (kindRaw !== undefined && kindRaw !== "subtitle" && kindRaw !== "bgm") {
          return badParams(`unknown job kind: ${kindRaw} (expected subtitle|bgm)`);
        }
        const job = findJob(input, kindRaw as JobKind | undefined);
        if (!job) return { cancelled: false, reason: "no running media job for that input" };
        try {
          job.proc.kill();
        } catch {
          /* raced to completion */
        }
        live.delete(keyOf(job.input, job.kind));
        journal({
          jobId: job.jobId,
          input: job.input,
          kind: job.kind,
          outPath: job.outPath,
          startedAt: job.startedAt,
          endedAt: now(),
          status: "cancelled",
          ms: now() - job.startedAt,
        });
        return { cancelled: true, jobId: job.jobId, kind: job.kind };
      },
    },
  ];

  return handlers;
}
