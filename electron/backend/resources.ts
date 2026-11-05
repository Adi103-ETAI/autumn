// autumn — Wave-2 handlers: resources (1 dispatchable + pressure/processMemory push; doc 32 §W2-1).
//
// `resources.pressure` does a REAL reading: process RSS vs total system memory, plus
// OS load average. Events come from real calls only — pressure transitions emit
// `onPressure`, RSS bucket (256MB) crossings emit `onProcessMemory`. No timers —
// emission happens on real facade calls, which keeps tests deterministic.

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

export type PressureLevel = "ok" | "warning" | "critical";

/** Heuristic pressure thresholds vs total system memory (documented, tunable). */
export function pressureLevel(rssBytes: number, totalBytes: number): PressureLevel {
  if (totalBytes <= 0) return "ok";
  const ratio = rssBytes / totalBytes;
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.6) return "warning";
  return "ok";
}

/** 256MB bucket index for RSS — used for onProcessMemory bucket-change emission. */
const bucket = (rss: number) => Math.floor(rss / (256 * 1024 * 1024));

export function makeResourcesHandlers(deps: W1Deps): RegisteredHandler[] {
  const { emit, now } = deps;

  // Transient pressure-tracker state (per factory; only transitions emit).
  let lastLevel: string | undefined;
  let lastBucket: number | undefined;

  const os = require("node:os");

  const reading = () => {
    const mem = process.memoryUsage();
    const total = os.totalmem();
    const level = pressureLevel(mem.rss, total);
    const heapUsedRatio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;
    return { rss: mem.rss, heapUsedRatio, level, total, loadAvg: os.loadavg() };
  };

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "resources.pressure",
      description:
        "system/process pressure reading; params: {} -> { level: 'ok'|'warning'|'critical', rssBytes, heapUsedRatio, totalMemBytes, loadAvg: [1m,5m,15m], ts }; emits onPressure/onProcessMemory on real transitions",
      schema: () => ({ ok: true }),
      handler: () => {
        const r = reading();
        const ts = now();
        const mem = process.memoryUsage();
        // Transition-based producers — a subscription with real trigger conditions.
        if (lastLevel !== undefined && r.level !== lastLevel) {
          emit("resources.onPressure", { level: r.level, previous: lastLevel, rssBytes: r.rss, heapUsedRatio: r.heapUsedRatio, ts });
        }
        const b = bucket(mem.rss);
        if (lastBucket !== undefined && b !== lastBucket) {
          emit("resources.onProcessMemory", { rssBytes: mem.rss, bucket: b, ts });
        }
        lastLevel = r.level;
        lastBucket = b;
        return {
          level: r.level,
          rssBytes: r.rss,
          heapUsedRatio: Number(r.heapUsedRatio.toFixed(4)),
          totalMemBytes: r.total,
          loadAvg: r.loadAvg.map((n: number) => Number(n.toFixed(2))),
          ts,
        };
      },
    },
  ];

  return handlers;
}
