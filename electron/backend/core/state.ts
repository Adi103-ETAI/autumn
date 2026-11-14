// autumn — the core protocol's local state (Wave 4, doc 35 §7).
//
// The core protocol's own state — the intents, the capabilities, the launch
// grants, the delivery policy, the staged terminal images — is local, small
// and short-lived, so it lives in flat JSON files under the user-data dir
// (the same pattern the rest of autumn uses for its own state).
//
// Everything here is real: a granted capability is really granted, an
// expired one is really refused, a staged image really lands on disk.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { userDataDir } from "../store";

/** A flat JSON file in the user-data dir, written atomically. */
export class StateFile<T> {
  private readonly file: string;
  private readonly fallback: () => T;

  constructor(name: string, fallback: () => T) {
    this.file = join(userDataDir(), "db", name);
    this.fallback = fallback;
  }

  /** The path (for the docs and the diagnostics). */
  get path(): string {
    return this.file;
  }

  /** Read the file (never throws — a damaged file falls back). */
  read(): T {
    try {
      if (!existsSync(this.file)) return this.fallback();
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      return (parsed as T) ?? this.fallback();
    } catch {
      return this.fallback();
    }
  }

  /** Write the file atomically. */
  write(value: T): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, this.file);
  }

  /** Remove the file. */
  clear(): void {
    try {
      rmSync(this.file, { force: true });
    } catch {
      /* already gone */
    }
  }
}

/** One capability grant: a method list and an expiry. */
export interface CapabilityGrant {
  id: string;
  /** The methods this grant covers. */
  methods: string[];
  /** When it stops working (ms). */
  expiresAt: number;
  /** What it was granted for. */
  purpose?: string;
  createdAt: number;
}

/** One queued intent. */
export interface QueuedIntent {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  ackedAt?: number;
}

/** One launch grant: a short-lived permission to start a terminal. */
export interface LaunchGrant {
  id: string;
  terminalId: string;
  harness?: string;
  accountId?: string;
  env?: Record<string, string>;
  expiresAt: number;
  createdAt: number;
  usedAt?: number;
}

/** The delivery policy: what the bus may deliver and to whom. */
export interface DeliveryPolicy {
  mode: "auto" | "ask" | "off";
  updatedAt: number;
}

/** One staged terminal image (a screenshot the phone relay sent). */
export interface StagedImage {
  id: string;
  nodeId: string;
  file: string;
  bytes: number;
  createdAt: number;
  expiresAt: number;
}
