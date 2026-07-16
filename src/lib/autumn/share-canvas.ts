// Autumn — Share canvas via URL.
// Encodes the current canvas state (nodes/edges/tasks/canvasName) into a
// compressed, base64url-encoded hash fragment that can be shared as a URL.
// On page load, the hash is decoded and the canvas is restored.

"use client";

import { gzip, ungzip } from "pako";
import { toast } from "sonner";
import type { AutumnEdge, AutumnNode, AutumnTask } from "./types";
import { useAutumnStore } from "./store";

export interface CanvasShareState {
  nodes: AutumnNode[];
  edges: AutumnEdge[];
  tasks: AutumnTask[];
  canvasName: string;
}

const HASH_PREFIX = "#canvas=";

// --- base64url helpers (browser-only; btoa/atob) ---

function bytesToBase64Url(bytes: Uint8Array): string {
  // Convert bytes to a binary string (chunked to avoid call-stack limits
  // for very large canvases — String.fromCharCode.apply is bounded).
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  // btoa -> base64
  let b64 = btoa(binary);
  // base64 -> base64url
  b64 = b64.replace(/\+/g, "-").replace(/\//g, "_");
  // strip trailing =
  b64 = b64.replace(/=+$/, "");
  return b64;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  // base64url -> base64
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // pad with =
  while (b64.length % 4) b64 += "=";
  // atob -> binary string
  const binary = atob(b64);
  // binary string -> Uint8Array
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode the given canvas state into a `#canvas=<base64url-gzipped-json>`
 * hash string suitable for setting as `window.location.hash`.
 */
export function encodeCanvasToHash(state: CanvasShareState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  const compressed = gzip(bytes);
  const b64url = bytesToBase64Url(compressed);
  return `${HASH_PREFIX}${b64url}`;
}

/**
 * Decode a `#canvas=<encoded>` hash string back into a CanvasShareState.
 * Returns null on any decoding/parsing error or shape mismatch.
 */
export function decodeCanvasFromHash(hash: string): CanvasShareState | null {
  try {
    if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
    const b64url = hash.slice(HASH_PREFIX.length);
    if (!b64url) return null;
    const compressed = base64UrlToBytes(b64url);
    // pako.ungzip autodetects gzip headers and returns the inflated bytes.
    // Passing `{ to: "string" }` makes it return a UTF-8 decoded string.
    const json = ungzip(compressed, { to: "string" });
    const parsed = JSON.parse(json) as Partial<CanvasShareState>;
    if (
      !parsed ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.edges) ||
      !Array.isArray(parsed.tasks) ||
      typeof parsed.canvasName !== "string"
    ) {
      return null;
    }
    return {
      nodes: parsed.nodes,
      edges: parsed.edges,
      tasks: parsed.tasks,
      canvasName: parsed.canvasName,
    };
  } catch (err) {
    console.warn("[share-canvas] decode failed", err);
    return null;
  }
}

/**
 * Convenience helper for the TopBar Share button and the Command Palette
 * "Share canvas via URL" command. Reads the current canvas state from the
 * Zustand store, encodes it, sets the URL hash, and shows a toast.
 */
export function shareCurrentCanvas() {
  const store = useAutumnStore.getState();
  const hash = encodeCanvasToHash({
    nodes: store.nodes,
    edges: store.edges,
    tasks: store.tasks,
    canvasName: store.canvasName,
  });
  if (typeof window !== "undefined") {
    window.location.hash = hash;
  }
  toast.success("Canvas share link copied to address bar", {
    description: "Copy the URL from the address bar to share this canvas.",
  });
}
