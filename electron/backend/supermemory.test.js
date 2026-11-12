"use strict";
// layer-1 tests for the Wave-3 supermemory handlers (doc 35 §2): team memory
// over MCP, with the RE's least-privilege grant model.
//
// The provider path is tested against a REAL local MCP server (an http server
// that speaks the JSON-RPC the RE's client speaks), so the handshake, the tool
// discovery, the space listing and the key verification are genuinely
// exercised — not mocked away.
//
// The grant model is tested against the RE's exact semantics:
//   mint  → one grant per (canvas, node), bound to an intentId + a live agent
//   check → no-grant | intent-changed | access-insufficient | execution-changed
//   a 'recall' grant CANNOT write ('recall-and-contribute' can)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
require("../ts-register");
const reg = require("../ipc/registry");
const manifest = require("../ipc/manifest.json");
const { useTempUserData } = require("./store.ts");

const {
  makeSupermemoryHandlers,
  isSupermemoryApiKeyShape,
  normalizeContainerTag,
  normalizeSpaces,
  resolveProviderTool,
  createGrantStore,
  createSpaceSelectionStore,
  normalizeCredentials,
  SEARCH_TOOLS,
  SPACE_TOOLS,
  WRITE_TOOLS,
  GRANT_ELIGIBLE_HARNESSES,
  SUPERMEMORY_MCP_URL,
} = require("./supermemory.ts");

const DISPATCHABLE = manifest.bridge.namespaces.supermemory.filter((m) => !/^on[A-Z]/.test(m)); // 7

// ---------------------------------------------------------------------------
// a REAL local MCP provider
// ---------------------------------------------------------------------------

async function startProvider(opts = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let req2 = {};
      try {
        req2 = JSON.parse(body || "{}");
      } catch {
        /* ignore */
      }
      calls.push({ method: req2.method, body: req2, auth: req.headers.authorization });
      const reply = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: req2.id ?? 1, result }));
      };
      if (req2.method === "initialize") {
        if (opts.rejectKey && String(req.headers.authorization || "").includes(opts.rejectKey)) {
          res.writeHead(401);
          res.end(JSON.stringify({ jsonrpc: "2.0", id: req2.id, error: { code: -32001, message: "unauthorized" } }));
          return;
        }
        reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } });
        return;
      }
      if (req2.method === "tools/list") {
        reply({ tools: opts.tools ?? [{ name: "search_memory" }, { name: "listSpaces" }, { name: "add_memory" }] });
        return;
      }
      if (req2.method === "tools/call") {
        const name = req2.params?.name;
        if (name === "listSpaces") {
          const payload = { spaces: [{ name: "Team brain", containerTag: "team", visibility: "shared", emoji: "🧠" }] };
          reply({ content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload });
          return;
        }
        reply({ content: [{ type: "text", text: "ok" }] });
        return;
      }
      reply({});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ---------------------------------------------------------------------------
// deps
// ---------------------------------------------------------------------------

function build(overrides = {}) {
  const state = {
    emitted: [],
    opened: [],
    nodes: {
      "node-live": { id: "node-live", kind: "terminal", data: JSON.stringify({ harness: "codex", agentPid: 4242, agentStartToken: "tok-1" }) },
      "node-chat": { id: "node-chat", kind: "chat", data: JSON.stringify({ harness: "claude" }) },
      "node-ineligible": { id: "node-ineligible", kind: "terminal", data: JSON.stringify({ harness: "not-an-agent" }) },
    },
  };
  const deps = {
    db: {
      node: {
        findUnique: async ({ where: { id } }) => state.nodes[id] ?? null,
      },
    },
    emit: (id, payload) => state.emitted.push([id, payload]),
    now: () => Date.now(),
    shell: {
      openExternal: async (url) => {
        state.opened.push(url);
      },
      openPath: async () => "",
      showItemInFolder: () => {},
    },
    ...overrides,
  };
  const handlers = makeSupermemoryHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  const dispatch = async (id, params = {}) => {
    reg.reset();
    for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
    return reg.dispatch({ kind: "bridge", id, params });
  };
  return { handlers, byId, call, dispatch, state, deps };
}

beforeEach(() => {
  reg.reset();
  useTempUserData();
});

// ---------------------------------------------------------------------------
// surface
// ---------------------------------------------------------------------------

test("id surface: 7 supermemory ids, all in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 7);
  assert.deepEqual(
    handlers.map((h) => h.id).sort(),
    DISPATCHABLE.map((m) => `supermemory.${m}`).sort(),
  );
  for (const h of handlers) assert.ok(reg.inManifest("bridge", h.id), `${h.id} not in manifest`);
});

test("the manifest's onGrantChanged is a push, not a dispatchable method", () => {
  assert.ok(manifest.bridge.namespaces.supermemory.includes("onGrantChanged"));
  const { handlers } = build();
  assert.equal(
    handlers.some((h) => h.id === "supermemory.onGrantChanged"),
    false,
    "the push is produced by emit(), never dispatched",
  );
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

test("status with no credential is the RE's signed-out shape", async () => {
  const { call } = build();
  const res = await call("supermemory.status", {});
  assert.equal(res.state, "signed-out");
  assert.equal(res.credentialKind, null);
  assert.deepEqual(res.spaces, []);
  assert.equal(res.selectedSpace, null);
  assert.equal(res.scope, "provider-space");
  assert.ok(["keychain", "memory"].includes(res.vaultMode));
});

test("status really talks to the provider: the spaces come from its listSpaces tool", async () => {
  const provider = await startProvider();
  try {
    const { call } = build();
    const key = "sm_abcdefghijklmnop";
    const connected = await call("supermemory.connectApiKey", { apiKey: key, endpoint: provider.url });
    assert.equal(connected.ok, true);
    assert.equal(connected.verified, true, "the provider really accepted the key");

    const res = await call("supermemory.status", {});
    assert.equal(res.state, "connected");
    assert.equal(res.credentialKind, "api-key");
    assert.equal(res.spaces.length, 1);
    assert.equal(res.spaces[0].containerTag, "team");
    assert.equal(res.spaces[0].name, "Team brain");
    assert.equal(res.selectedSpace.containerTag, "team", "a single space is selected automatically");
    assert.ok(provider.calls.some((c) => c.method === "tools/list"), "the provider really got tools/list");
    assert.ok(provider.calls.some((c) => c.method === "tools/call"), "the provider really got tools/call");
    assert.ok(
      provider.calls.every((c) => !c.auth || c.auth === `Bearer ${key}`),
      "the key is sent as a bearer token",
    );
  } finally {
    await provider.close();
  }
});

test("status says so when the provider is unreachable — it never fakes a connection", async () => {
  const provider = await startProvider();
  const url = provider.url;
  await provider.close();
  const { call } = build();
  await call("supermemory.connectApiKey", { apiKey: "sm_abcdefghijklmnop", endpoint: url });
  const res = await call("supermemory.status", {});
  assert.equal(res.state, "connected", "the credential is still there");
  assert.ok(res.error, "but the failure is reported");
  assert.deepEqual(res.spaces, []);
});

// ---------------------------------------------------------------------------
// connectApiKey
// ---------------------------------------------------------------------------

test("connectApiKey refuses a key that is not shaped like one (the RE's check)", async () => {
  const { call } = build();
  const res = await call("supermemory.connectApiKey", { apiKey: "nope" });
  assert.equal(res.ok, false);
  assert.match(res.error, /sm_/);
});

test("isSupermemoryApiKeyShape is the RE's regex", () => {
  assert.equal(isSupermemoryApiKeyShape("sm_abcdefghij"), true);
  assert.equal(isSupermemoryApiKeyShape("sm_abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(isSupermemoryApiKeyShape("sk_abcdefghij"), false);
  assert.equal(isSupermemoryApiKeyShape("sm_short"), false, "the RE needs at least 10 more chars");
  assert.equal(isSupermemoryApiKeyShape(123), false);
});

test("connectApiKey verifies the key against the provider, for real", async () => {
  const provider = await startProvider({ rejectKey: "sm_rejectedkey" });
  try {
    const { call } = build();
    const res = await call("supermemory.connectApiKey", { apiKey: "sm_rejectedkey000", endpoint: provider.url });
    assert.equal(res.ok, false);
    assert.match(res.error, /rejected/i);
  } finally {
    await provider.close();
  }
});

test("signOut really removes the credential", async () => {
  const provider = await startProvider();
  try {
    const { call } = build();
    await call("supermemory.connectApiKey", { apiKey: "sm_abcdefghijklmnop", endpoint: provider.url });
    const out = await call("supermemory.signOut", {});
    assert.equal(out.ok, true);
    const res = await call("supermemory.status", {});
    assert.equal(res.state, "signed-out");
    assert.equal(res.credentialKind, null);
  } finally {
    await provider.close();
  }
});

// ---------------------------------------------------------------------------
// spaces
// ---------------------------------------------------------------------------

test("selectSpace only accepts a space the provider really offers", async () => {
  const provider = await startProvider();
  try {
    const { call } = build();
    await call("supermemory.connectApiKey", { apiKey: "sm_abcdefghijklmnop", endpoint: provider.url });
    const bad = await call("supermemory.selectSpace", { containerTag: "not-a-space" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /does not offer/);
    const good = await call("supermemory.selectSpace", { containerTag: "team" });
    assert.equal(good.ok, true);
  } finally {
    await provider.close();
  }
});

test("selectSpace validates the tag itself (the RE's normalizeContainerTag)", async () => {
  const { call } = build();
  const bad = await call("supermemory.selectSpace", { containerTag: "" });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid/);
});

test("normalizeContainerTag is the RE's rule", () => {
  assert.equal(normalizeContainerTag("team"), "team");
  assert.equal(normalizeContainerTag(""), null);
  assert.equal(normalizeContainerTag("x".repeat(129)), null, "max 128 chars");
  assert.equal(normalizeContainerTag("a b"), null, "control bytes are refused");
});

test("normalizeSpaces is the RE's normalization", () => {
  assert.deepEqual(normalizeSpaces(null), []);
  assert.deepEqual(normalizeSpaces({ spaces: ["a", "a", "b"] }), [
    { name: "a", containerTag: "a" },
    { name: "b", containerTag: "b" },
  ]);
  const spaces = normalizeSpaces({ containerTags: ["x"] });
  assert.equal(spaces[0].containerTag, "x");
  const projects = normalizeSpaces({ projects: [{ id: "p1", name: "P" }] });
  assert.equal(projects[0].containerTag, "p1");
  assert.equal(projects[0].name, "P");
  const rich = normalizeSpaces({ spaces: [{ containerTag: "t", name: "T", visibility: "shared", emoji: "🧠", memoryCount: 3 }] });
  assert.equal(rich[0].visibility, "shared");
  assert.equal(rich[0].emoji, "🧠");
  assert.equal(rich[0].memoryCount, 3);
});

test("the space selection is persisted in the user's own data dir", async () => {
  const provider = await startProvider();
  try {
    const { call } = build();
    await call("supermemory.connectApiKey", { apiKey: "sm_abcdefghijklmnop", endpoint: provider.url });
    await call("supermemory.selectSpace", { containerTag: "team" });
    const file = path.join(require("./store.ts").userDataDir(), "supermemory-space.json");
    assert.ok(fs.existsSync(file), "the selection is written");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).containerTag, "team");
  } finally {
    await provider.close();
  }
});

test("the space selection store clears when the space disappears", () => {
  const store = createSpaceSelectionStore();
  store.set("team");
  assert.equal(store.get(), "team");
  store.clear();
  assert.equal(store.get(), null);
  assert.throws(() => store.set(""), /Invalid/);
});

// ---------------------------------------------------------------------------
// grants — the RE's least-privilege model
// ---------------------------------------------------------------------------

test("grant needs a live, eligible agent; the reason is the RE's", async () => {
  const { call } = build();
  const ineligible = await call("supermemory.grant", {
    canvasId: "c1",
    nodeId: "node-ineligible",
    intentId: "i1",
    access: "recall",
  });
  assert.equal(ineligible.ok, false);
  assert.match(ineligible.error, /No eligible agent/);

  const missing = await call("supermemory.grant", {
    canvasId: "c1",
    nodeId: "does-not-exist",
    intentId: "i1",
    access: "recall",
  });
  assert.equal(missing.ok, false);
});

test("grant validates its input (the RE's shape)", async () => {
  const { dispatch } = build();
  const bad = await dispatch("supermemory.grant", { canvasId: "c1", nodeId: "n1", intentId: "i1", access: "write" });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
  const missingIntent = await dispatch("supermemory.grant", { canvasId: "c1", nodeId: "n1", access: "recall" });
  assert.equal(missingIntent.ok, false);
});

test("granting pushes supermemory.onGrantChanged (active)", async () => {
  const { call, state } = build();
  const res = await call("supermemory.grant", {
    canvasId: "c1",
    nodeId: "node-live",
    intentId: "i1",
    access: "recall",
  });
  assert.equal(res.ok, true);
  const push = state.emitted.find(([id]) => id === "supermemory.onGrantChanged");
  assert.ok(push, "the grant change is pushed");
  assert.equal(push[1].state, "active");
  assert.equal(push[1].canvasId, "c1");
  assert.equal(push[1].nodeId, "node-live");
  assert.equal(push[1].intentId, "i1");
});

test("revoking pushes supermemory.onGrantChanged (inactive)", async () => {
  const { call, state } = build();
  await call("supermemory.grant", { canvasId: "c1", nodeId: "node-live", intentId: "i1", access: "recall" });
  state.emitted.length = 0;
  const res = await call("supermemory.revoke", { canvasId: "c1", nodeId: "node-live" });
  assert.equal(res.ok, true);
  const push = state.emitted.find(([id]) => id === "supermemory.onGrantChanged");
  assert.ok(push);
  assert.equal(push[1].state, "inactive");
});

test("revoking an unknown grant is a no-op, not an error", async () => {
  const { call, state } = build();
  const res = await call("supermemory.revoke", { canvasId: "c1", nodeId: "ghost" });
  assert.equal(res.ok, true);
  assert.equal(state.emitted.length, 0, "nothing really changed, so nothing is pushed");
});

test("the grant store enforces the RE's least privilege and intent binding", async () => {
  const probe = {
    probe: async () => ({ kind: "terminal", harness: "codex", agentPid: 1, agentStartToken: "t" }),
    verify: async () => true,
  };
  const changes = [];
  const store = createGrantStore(probe, () => 1000, (c) => changes.push(c));

  assert.deepEqual(await store.check("c", "n"), { ok: false, denial: "no-grant" });

  const minted = await store.mint({ canvasId: "c", nodeId: "n", intentId: "i1", access: "recall" });
  assert.equal(minted.ok, true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].state, "active");

  // A recall grant can read…
  const read = await store.check("c", "n", { intentId: "i1" });
  assert.equal(read.ok, true);
  // …but it cannot write.
  const write = await store.check("c", "n", { intentId: "i1", needContribute: true });
  assert.equal(write.ok, false);
  assert.equal(write.denial, "access-insufficient");

  // A different intent is refused.
  const otherIntent = await store.check("c", "n", { intentId: "i2" });
  assert.equal(otherIntent.ok, false);
  assert.equal(otherIntent.denial, "intent-changed");

  // A contribute grant can write.
  await store.mint({ canvasId: "c", nodeId: "n", intentId: "i2", access: "recall-and-contribute" });
  const write2 = await store.check("c", "n", { intentId: "i2", needContribute: true });
  assert.equal(write2.ok, true);

  // Re-minting pushes the old grant to inactive first.
  assert.equal(changes.filter((c) => c.state === "inactive").length, 1);
});

test("a grant dies when the agent run changes (the RE's execution-changed)", async () => {
  let live = true;
  const probe = {
    probe: async () => ({ kind: "terminal", harness: "codex", agentPid: 1, agentStartToken: "t" }),
    verify: async () => live,
  };
  const changes = [];
  const store = createGrantStore(probe, () => 1, (c) => changes.push(c));
  await store.mint({ canvasId: "c", nodeId: "n", intentId: "i1", access: "recall" });
  live = false;
  const res = await store.check("c", "n", { intentId: "i1" });
  assert.equal(res.ok, false);
  assert.equal(res.denial, "execution-changed");
  assert.equal(store.peek("c", "n"), null, "the dead grant is dropped");
  assert.equal(changes[changes.length - 1].state, "inactive");
});

test("an ineligible harness is refused by the store too", async () => {
  const probe = {
    probe: async () => ({ kind: "terminal", harness: "not-an-agent" }),
    verify: async () => true,
  };
  const store = createGrantStore(probe);
  const res = await store.mint({ canvasId: "c", nodeId: "n", intentId: "i1", access: "recall" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /No eligible agent/);
});

test("the eligible harnesses are the RE's list", () => {
  for (const h of ["claude", "codex", "opencode", "hermes", "cursor", "gemini"]) {
    assert.ok(GRANT_ELIGIBLE_HARNESSES.includes(h), `${h} should be eligible`);
  }
  assert.equal(GRANT_ELIGIBLE_HARNESSES.includes("terminal"), false);
});

// ---------------------------------------------------------------------------
// the tool resolution + credential shapes (the RE's)
// ---------------------------------------------------------------------------

test("the provider tool lists are the RE's", () => {
  assert.deepEqual(SEARCH_TOOLS, ["search_memory", "recall", "search", "searchSupermemory"]);
  assert.deepEqual(SPACE_TOOLS, ["listSpaces", "listContainerTags", "listProjects"]);
  assert.ok(WRITE_TOOLS.includes("add_memory"));
  assert.equal(SUPERMEMORY_MCP_URL, "https://mcp.supermemory.ai/mcp");
});

test("resolveProviderTool picks the first candidate the provider offers", () => {
  assert.equal(resolveProviderTool(["add_memory", "search"], SEARCH_TOOLS), "search");
  assert.equal(resolveProviderTool(["listProjects"], SPACE_TOOLS), "listProjects");
  assert.equal(resolveProviderTool(["nothing"], SEARCH_TOOLS), null);
  assert.equal(resolveProviderTool(null, SEARCH_TOOLS), null);
});

test("normalizeCredentials is the RE's shape check", () => {
  assert.deepEqual(normalizeCredentials({ kind: "api-key", apiKey: "k" }), { kind: "api-key", apiKey: "k" });
  assert.equal(normalizeCredentials({ kind: "api-key", apiKey: "  " }), null);
  assert.equal(normalizeCredentials({ kind: "oauth" }), null);
  assert.deepEqual(normalizeCredentials({ kind: "oauth", accessToken: "t" }), { kind: "oauth", accessToken: "t" });
  assert.equal(normalizeCredentials({ kind: "other" }), null);
});

// ---------------------------------------------------------------------------
// registry level
// ---------------------------------------------------------------------------

test("registry-level: every supermemory id dispatch-resolves to an envelope", async () => {
  const provider = await startProvider();
  try {
    const { handlers, dispatch } = build();
    for (const h of handlers) {
      const env = await dispatch(h.id, {
        apiKey: "sm_abcdefghijklmnop",
        endpoint: provider.url,
        canvasId: "c1",
        nodeId: "node-live",
        intentId: "i1",
        access: "recall",
        containerTag: "team",
      });
      assert.ok(env && typeof env.ok === "boolean", `${h.id} must resolve to an envelope`);
      assert.ok(!/^no handler for /.test(env.error?.message ?? ""), `${h.id}: ${env.error?.message}`);
    }
  } finally {
    await provider.close();
  }
});
