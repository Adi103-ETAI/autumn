#!/usr/bin/env node
// gen-ipc-manifest.mjs — generate electron/ipc/manifest.json from the target's
// reverse-engineering oracles (, autumn/evidence/inventories/*.md).
//
// This is the "is the test oracle" mechanism from the build plan (docs/architecture/ipc-facade.md):
//   - core-methods.md     -> core RPC groups + 129 methods (conformance source)
//   - preload-api.md      -> 68 bridge namespaces + 572 second-level methods
//   - renderer-usage.md   -> 476 calls the target's own renderer makes (contract source)
//
// The manifest is COMMITTED so tests run self-contained; only this generator needs the
// oracles. Re-run:  node scripts/gen-ipc-manifest.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "electron", "ipc", "manifest.json");

// Oracle dir: sibling autumn/evidence/inventories (repo sits in work-autumn next to autumn/),
// overridable via EVIDENCE_DIR.
const CANDIDATES = [
  process.env.EVIDENCE_DIR,
  path.resolve(REPO, "..", "autumn", "evidence", "inventories"),
  path.resolve(REPO, "evidence", "inventories"),
].filter(Boolean);
const INV = CANDIDATES.find((p) => fs.existsSync(path.join(p, "core-methods.md")));
if (!INV) {
  console.error("gen-ipc-manifest: core-methods.md not found. Tried:\n  " + CANDIDATES.join("\n  "));
  console.error("Set EVIDENCE_DIR to the inventories directory.");
  process.exit(1);
}

/** Parse a "- **NAME** (n): `a`, `b`" block list into { NAME: [tokens] }. */
function parseBlocks(file) {
  const out = {};
  const src = fs.readFileSync(path.join(INV, file), "utf8");
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^- \*\*(.+?)\*\*(?: \((\d+)\))?: (.*)$/);
    if (!m) continue;
    const name = m[1];
    const methods = [...m[3].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    if (m[2] && Number(m[2]) !== methods.length) {
      console.warn(`  ! ${file}: ${name} header says ${m[2]}, parsed ${methods.length}`);
    }
    out[name] = methods;
  }
  return out;
}

const core = parseBlocks("core-methods.md"); // { group: ["agent.begin", ...] }
const bridge = parseBlocks("preload-api.md"); // { ns: ["list", ...] }
const rendererUsage = parseBlocks("renderer-usage.md"); // { ns: ["start", ...] }

/**
 * Autumn's own names for the methods whose inventory names carry the upstream
 * product's name. The public API belongs to Autumn, so the contract uses
 * Autumn's names.
 *
 * The mapping lives with the inventories it describes (evidence/inventories),
 * not here: the upstream names are upstream data.
 */
const RENAMES_FILE = path.join(INV, "autumn-renames.json");
let RENAMED = {};
try {
  RENAMED = JSON.parse(fs.readFileSync(RENAMES_FILE, "utf8")).renames ?? {};
} catch {
  console.warn("  ! autumn-renames.json is missing — the contract keeps the upstream names");
}

function rename(list) {
  return list.map((m) => {
    const dot = m.lastIndexOf(".");
    if (dot === -1) return RENAMED[m] ?? m;
    const head = m.slice(0, dot + 1);
    const tail = m.slice(dot + 1);
    return RENAMED[tail] ? head + RENAMED[tail] : m;
  });
}

for (const ns of Object.keys(bridge)) bridge[ns] = rename(bridge[ns]);
for (const ns of Object.keys(rendererUsage)) rendererUsage[ns] = rename(rendererUsage[ns]);
for (const g of Object.keys(core)) core[g] = rename(core[g]);

const sum = (o) => Object.values(o).reduce((a, v) => a + v.length, 0);

const manifest = {
  project: "autumn",
  product: { name: "Autumn", version: "1.0.0" },
  generatedAt: new Date().toISOString(),
  generatedFrom: ["core-methods.md", "preload-api.md", "renderer-usage.md"],
  // Autumn's versioned core protocol (docs/architecture/ipc-facade.md).
  protocol: { API_VERSION: 2, SCHEMA: 8 },
  principals: ["desktop", "cli", "remote", "local-client", "capability"],
  counts: {
    bridgeNamespaces: Object.keys(bridge).length,
    bridgeMethods: sum(bridge),
    coreGroups: Object.keys(core).length,
    coreMethods: sum(core),
    rendererNamespaces: Object.keys(rendererUsage).length,
    rendererCalls: sum(rendererUsage),
    // The nested members beyond the second-level ones.
    nestedMembers: 691,
  },
  core: { groups: core },
  bridge: { namespaces: bridge },
  rendererUsage: { namespaces: rendererUsage },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");

const c = manifest.counts;
console.log(`gen-ipc-manifest -> ${path.relative(REPO, OUT)}`);
console.log(
  `  bridge: ${c.bridgeNamespaces} ns / ${c.bridgeMethods} methods | ` +
    `core: ${c.coreGroups} groups / ${c.coreMethods} methods | ` +
    `renderer usage: ${c.rendererNamespaces} ns / ${c.rendererCalls} calls`
);
