// Autumn — type declarations for the window.autumn preload bridge.
//
// The bridge shape is GENERATED from electron/ipc/manifest.json (RE'd from the
// target, October Desktop v1.0.56): 68 namespaces / 572 methods. Every call
// resolves to the standard envelope; `on*` methods subscribe instead.
//
// Wave-0 typing is intentionally LOOSE (index signature): precise per-namespace
// types are generated in Wave 1 (scripts/gen-bridge-types.mjs) once real call
// sites start landing. Until then, unknown-member access type-checks as `any`.

export type Envelope<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

/** A callable bridge method: (params) => envelope. */
export type BridgeCall<T = unknown> = (params?: Record<string, unknown>) => Promise<Envelope<T>>;

/** An `on*` subscription method: returns an unsubscribe function. */
export type BridgeSub<T = unknown> = (cb: (payload: T) => void) => () => void;

export interface ImplementedEntry {
  kind: "bridge" | "core";
  id: string;
  description: string;
}

export interface RecentCall {
  t: number;
  kind: string;
  id: string;
  principal: string;
  ms: number;
  ok: boolean;
  code?: string;
}

export interface InspectorData {
  project: string;
  protocol: { API_VERSION: number; SCHEMA: number };
  counts: Record<string, number>;
  namespaces: Array<{ ns: string; total: number; implemented: number; methods: string[] }>;
  implemented: ImplementedEntry[];
  recent: RecentCall[];
}

export interface AutumnBridge {
  // Generated target namespaces (loose typing until Wave 1) — e.g. bridge.files.read(...)
  [namespace: string]: any;

  // autumn's own dev tooling member: Bridge Inspector data.
  __bridge(): Promise<InspectorData>;

  // Core-RPC transport (registry kind "core", 129 CORE_METHODS / 21 groups):
  // the target's renderer never calls core methods directly, but autumn's
  // ported bus client lives in the renderer — e.g. __core.bus.query({...}).
  __core: Record<string, Record<string, BridgeCall>>;

  // autumn-private ops (electron/ipc/private-ops.js) — no target equivalent.
  __ops: Record<string, BridgeCall>;

  // Pre-facade compat members (removed in Wave 1 when the UI moves onto the facade).
  openFileDialog(opts?: {
    title?: string;
    directory?: boolean;
  }): Promise<string[] | null>;
  onTerminalData(cb: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    /** autumn is the project. */
    autumn: AutumnBridge;
    /** Compatibility alias ONLY, so ported target-renderer code resolves unchanged. */
    october: AutumnBridge;
  }
}

export {};
