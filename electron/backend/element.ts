// autumn — Wave-2 handlers: element (1 dispatchable; docs/architecture/backend.md-1).
//
// element.resolve(...) — the design-element resolution hook. No
// semantics are documented in the evidence beyond the call site; the honest
// reading: given a renderer-side element descriptor (tag + attrs), normalize it
// into a canonical, validated shape with a stable id the canvas can re-attach.
//
// Implemented FOR REAL as a descriptor normalizer — everything returned is derived
// from the input; nothing about a DOM/filesystem is invented.

import { createHash } from "node:crypto";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/** HTML tag name: starts with a letter, lowercase alnum/hyphen (custom elements included). */
const TAG_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ATTR_KEY_RE = /^([a-zA-Z][a-zA-Z0-9-_]*|data-[a-zA-Z0-9-_]+|aria-[a-zA-Z0-9-_]+)$/;
const MAX_ATTRS = 50;
const MAX_VALUE_LEN = 1024;

export function makeElementHandlers(deps: W1Deps): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "element.resolve",
      description:
        "validate + normalize a renderer element descriptor; params: { tag: string, attrs?: Record<string,string|number|boolean> (≤50) } -> { tag, attrs, id } (id is a stable hash of tag+attrs)",
      schema: (p) => {
        if (typeof p?.tag !== "string" || !TAG_RE.test(p.tag)) {
          return { ok: false, message: "tag must be a lowercase tag name (a-z0-9-, starts with a letter)" };
        }
        if (p?.attrs !== undefined) {
          if (typeof p.attrs !== "object" || p.attrs === null || Array.isArray(p.attrs)) {
            return { ok: false, message: "attrs must be an object of string|number|boolean" };
          }
          const entries = Object.entries(p.attrs);
          if (entries.length > MAX_ATTRS) return { ok: false, message: `at most ${MAX_ATTRS} attrs` };
          for (const [k, v] of entries) {
            if (!ATTR_KEY_RE.test(k)) return { ok: false, message: `invalid attr name: ${k}` };
            if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
              return { ok: false, message: `attr ${k} must be string|number|boolean` };
            }
            if (typeof v === "number" && !Number.isFinite(v)) return { ok: false, message: `attr ${k} must be finite` };
            if (String(v).length > MAX_VALUE_LEN) return { ok: false, message: `attr ${k} exceeds ${MAX_VALUE_LEN} chars` };
          }
        }
        return { ok: true };
      },
      handler: (p) => {
        if (typeof p?.tag !== "string" || !TAG_RE.test(p.tag)) {
          return badParams("tag must be a lowercase tag name (a-z0-9-, starts with a letter)");
        }
        const attrs: Record<string, string | number | boolean> = {};
        if (p.attrs !== undefined) {
          if (typeof p.attrs !== "object" || p.attrs === null || Array.isArray(p.attrs)) {
            return badParams("attrs must be an object of string|number|boolean");
          }
          const entries = Object.entries(p.attrs);
          if (entries.length > MAX_ATTRS) return badParams(`at most ${MAX_ATTRS} attrs`);
          for (const [k, v] of entries as Array<[string, string | number | boolean]>) {
            if (!ATTR_KEY_RE.test(k)) return badParams(`invalid attr name: ${k}`);
            if (!["string", "number", "boolean"].includes(typeof v)) return badParams(`attr ${k} must be string|number|boolean`);
            if (typeof v === "number" && !Number.isFinite(v)) return badParams(`attr ${k} must be finite`);
            if (String(v).length > MAX_VALUE_LEN) return badParams(`attr ${k} exceeds ${MAX_VALUE_LEN} chars`);
            attrs[k] = v;
          }
        }
        // Stable id: sorted key order so attribute order never changes identity.
        const canonical = JSON.stringify([p.tag, Object.keys(attrs).sort().map((k) => [k, attrs[k]])]);
        const id = `el-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
        return { tag: p.tag, attrs, id };
      },
    },
  ];

  return handlers;
}
