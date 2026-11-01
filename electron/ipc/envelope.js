"use strict";
// autumn IPC envelope — the uniform result shape every dispatch returns (doc 29 §T layer 2/4).
// { ok: true, result } | { ok: false, error: { code, message, detail? } }

const ERR = {
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
  NOT_IMPLEMENTED: "not-implemented",
  BAD_PARAMS: "bad-params",
  HANDLER_ERROR: "handler-error",
};

function ok(result) {
  return { ok: true, result };
}

function err(code, message, detail) {
  const error = { code, message: String(message) };
  if (detail !== undefined) error.detail = detail;
  return { ok: false, error };
}

function isEnvelope(x) {
  return !!x && typeof x === "object" && typeof x.ok === "boolean" &&
    (x.ok ? "result" in x : !!x.error && typeof x.error.code === "string");
}

module.exports = { ok, err, isEnvelope, ERR };
