"use strict";
// autumn IPC auth — per-principal method authorization (docs/architecture/ipc-facade.md layer 3).
//
// autumn's core protocol authorizes each call by *principal*
// (desktop | cli | remote | local-client | capability) via coreMethodAllowed().
// The principal model: the desktop principal is the full one today.
//
// Wave-0 skeleton: FAIL-CLOSED. The real per-method principal matrix is filled in Wave 4
// from the core-methods + allow-lists. Until then only the `desktop`
// principal — the app's own renderer — is broadly allowed; every other principal is denied
// unless an explicit rule grants it. This keeps the *mechanism* real and testable without
// inventing the target's auth table.

const PRINCIPALS = ["desktop", "cli", "remote", "local-client", "capability"];

/**
 * @param {string} principal
 * @param {string} method   dotted method id ("ns.method" bridge | "group.method" core)
 * @param {object} [rules]  method -> true | string[] | Set<string> of allowed principals
 *                          (non-desktop). Omit until Wave 4.
 * @returns {{allowed: boolean, reason: string}}
 */
function coreMethodAllowed(principal, method, rules) {
  if (!PRINCIPALS.includes(principal)) {
    return { allowed: false, reason: `unknown principal "${principal}"` };
  }
  if (principal === "desktop") {
    return { allowed: true, reason: "desktop principal (default allow)" };
  }
  const rule = rules ? rules[method] : undefined;
  if (rule === true) return { allowed: true, reason: "explicit allow" };
  const grant =
    rule instanceof Set ? rule.has(principal) :
    Array.isArray(rule) ? rule.includes(principal) :
    null;
  if (grant) return { allowed: true, reason: `granted "${method}" to ${principal}` };
  return {
    allowed: false,
    reason: `principal "${principal}" not granted "${method}" (the real matrix is filled in later)`,
  };
}

module.exports = { coreMethodAllowed, PRINCIPALS };
