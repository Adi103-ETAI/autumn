"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ok, err, isEnvelope, ERR } = require("./envelope");

test("ok() builds a success envelope", () => {
  const e = ok({ a: 1 });
  assert.deepEqual(e, { ok: true, result: { a: 1 } });
  assert.ok(isEnvelope(e));
});

test("err() builds a failure envelope with code/message", () => {
  const e = err(ERR.FORBIDDEN, "nope", { extra: true });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, "forbidden");
  assert.equal(e.error.message, "nope");
  assert.deepEqual(e.error.detail, { extra: true });
  assert.ok(isEnvelope(e));
});

test("isEnvelope rejects non-envelopes", () => {
  assert.equal(isEnvelope(null), false);
  assert.equal(isEnvelope({ ok: true }), false); // ok:true without result
  assert.equal(isEnvelope({ ok: false }), false); // ok:false without error
  assert.equal(isEnvelope("x"), false);
});
