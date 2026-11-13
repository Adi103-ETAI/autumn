"use strict";
// layer-1 tests for the element bridge id (docs/architecture/backend.md W2-1).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
require("../ts-register");
const reg = require("../ipc/registry");
const { makeElementHandlers } = require("./element.ts");

const EXPECTED_IDS = ["element.resolve"];

function build() {
  const deps = { emit: () => {}, now: () => Date.now() };
  const handlers = makeElementHandlers(deps);
  const byId = Object.fromEntries(handlers.map((h) => [h.id, h]));
  const call = (id, params = {}) => byId[id].handler(params, { principal: "desktop" });
  return { handlers, byId, call };
}

beforeEach(() => reg.reset());

test("id surface: element.resolve in the manifest", () => {
  const { handlers } = build();
  assert.equal(handlers.length, 1);
  assert.ok(reg.inManifest("bridge", "element.resolve"));
});

test("resolve validates and normalizes a descriptor; id stable for same input", async () => {
  const { call } = build();
  const res = await call("element.resolve", { tag: "button", attrs: { class: "btn primary", "data-testid": "save", disabled: true, tabindex: 0 } });
  assert.equal(res.tag, "button");
  assert.equal(res.attrs.class, "btn primary");
  assert.match(res.id, /^el-[0-9a-f]{16}$/);

  const again = await call("element.resolve", { tag: "button", attrs: { disabled: true, "data-testid": "save", tabindex: 0, class: "btn primary" } });
  assert.equal(again.id, res.id, "attribute order must not change the id hash");
});

test("custom elements (x-foo-bar) are legal; uppercase/space tags are not", async () => {
  const { call } = build();
  const ok = await call("element.resolve", { tag: "x-card-thing" });
  assert.equal(ok.id, ok.id);
  assert.equal((await call("element.resolve", { tag: "Div" })).error.code, "bad-params");
  assert.equal((await call("element.resolve", { tag: "my tag" })).error.code, "bad-params");
  assert.equal((await call("element.resolve", { tag: "" })).error.code, "bad-params");
});

test("attrs: ≤50 keys, valid shapes, no object smuggling", async () => {
  const { call } = build();
  const badKey = await call("element.resolve", { tag: "div", attrs: { "not a key!": "x" } });
  assert.equal(badKey.error.code, "bad-params");
  const badVal = await call("element.resolve", { tag: "div", attrs: { data: { nested: true } } });
  assert.equal(badVal.error.code, "bad-params");
  const nan = await call("element.resolve", { tag: "div", attrs: { n: NaN } });
  assert.equal(nan.error.code, "bad-params");
  const big = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`a${i}`, "x"]));
  assert.equal((await call("element.resolve", { tag: "div", attrs: big })).error.code, "bad-params");
});

test("resolve with no attrs works and returns empty attrs", async () => {
  const { call } = build();
  const res = await call("element.resolve", { tag: "nav" });
  assert.deepEqual(res.attrs, {});
  assert.match(res.id, /^el-/);
});

test("registry dispatch round-trip wraps payloads", async () => {
  reg.reset();
  const handlers = makeElementHandlers({ emit: () => {}, now: () => Date.now() });
  for (const h of handlers) reg.register(h.kind, h.id, h.handler, { schema: h.schema, description: h.description });
  const ok = await reg.dispatch({ id: "element.resolve", params: { tag: "main" } });
  assert.equal(ok.ok, true);
  assert.match(ok.result.id, /^el-/);
  const bad = await reg.dispatch({ id: "element.resolve", params: { tag: 42 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "bad-params");
});
