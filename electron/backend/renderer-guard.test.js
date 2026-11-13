"use strict";
// autumn — M3 renderer guard (docs/architecture/ipc-facade.md): Next.js is now RENDERER-ONLY.
//
// The backend lives exclusively in the Electron main process (14 handlers in
// electron/backend). This test permanently enforces the two invariants that
// keep it that way:
//
//   1. No renderer code reaches the backend over HTTP — every call goes
//      through the window.autumn IPC facade (src/lib/autumn/bridge.ts).
//   2. No SSE/EventSource — output streams as facade `on*` events.
//
// If this test fails: a direct HTTP call site crept back in. Route it through
// `api.*` from "@/lib/autumn/bridge" instead.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "..", "src");

/** Recursively collect .ts/.tsx files under dir. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Strip line and block comments so prose about HTTP never trips the guard. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("no renderer HTTP call sites remain (IPC facade is the only path)", () => {
  const files = walk(SRC);
  assert.ok(files.length > 50, `expected many src files, found ${files.length}`);

  const violations = [];
  for (const file of files) {
    const rel = path.relative(SRC, file);
    const code = stripComments(fs.readFileSync(file, "utf8"));
    // HTTP client usage aimed at our API paths (any method/shape).
    if (/\bfetch\s*\(\s*[`"']\/api\//.test(code)) {
      violations.push(`${rel}: fetch("/api/…") call site`);
    }
    // Template-literal URLs built elsewhere but still API paths.
    if (/[`"']\/api\/[a-z]/.test(code)) {
      violations.push(`${rel}: "/api/…" path literal`);
    }
    if (/\bnew\s+EventSource\s*\(/.test(code)) {
      violations.push(`${rel}: EventSource (SSE replaced by facade on* events)`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `renderer must use window.autumn via src/lib/autumn/bridge.ts — violations:\n` +
      violations.map((v) => `  ${v}`).join("\n"),
  );
});

test("the API routes are gone (Next is renderer-only)", () => {
  const apiDir = path.join(SRC, "app", "api");
  assert.equal(
    fs.existsSync(apiDir),
    false,
    "src/app/api must not exist — the backend is hosted in Electron main " +
      "(electron/backend/handlers.ts); see docs/architecture/ipc-facade.md",
  );
});

test("the bridge adapter is the renderer's single backend entry point", () => {
  const bridge = path.join(SRC, "lib", "autumn", "bridge.ts");
  assert.ok(fs.existsSync(bridge), "src/lib/autumn/bridge.ts must exist");
  const code = fs.readFileSync(bridge, "utf8");
  assert.ok(
    !/\bfetch\s*\(/.test(stripComments(code)),
    "bridge.ts itself must not use fetch — it wraps window.autumn",
  );
});
