"use strict";
// autumn IPC auth — per-principal method authorization
// (docs/architecture/core-protocol.md layer 3).
//
// autumn's core protocol authorizes every call by *principal*:
//
//   desktop       the app's own renderer — everything
//   cli           the command line — drive a terminal, look around
//   remote        the phone relay
//   local-client  the in-app surfaces (the dock, the panels)
//   capability    a capability token — an explicit, expiring method list
//
// The table is the product's: `core-protocol.js` holds exactly which method
// each principal may call. A capability principal carries its own list and
// an expiry, so a token can be given exactly the access it needs.

const {
  CORE_METHOD_SET,
  CORE_CLI_METHOD_SET,
  CORE_LOCAL_CLIENT_METHOD_SET,
  CORE_REMOTE_METHOD_SET,
} = require("./core-protocol");

const PRINCIPALS = ["desktop", "cli", "remote", "local-client", "capability"];

/**
 * May this principal call this method?
 *
 * @param {string} principal   desktop | cli | remote | local-client | capability
 * @param {string} method      dotted method id ("ns.method" bridge | "group.method" core)
 * @param {object} [options]
 * @param {string[]} [options.methods]  the capability principal's own method list
 * @param {number}   [options.expiresAt] the capability principal's expiry (ms)
 * @returns {{allowed: boolean, reason: string}}
 */
function coreMethodAllowed(principal, method, options = {}) {
  if (!PRINCIPALS.includes(principal)) {
    return { allowed: false, reason: `unknown principal "${principal}"` };
  }
  if (principal === "desktop") {
    return { allowed: true, reason: "the desktop principal may call everything" };
  }
  if (principal === "local-client") {
    return allow(CORE_LOCAL_CLIENT_METHOD_SET, method, principal);
  }
  if (principal === "cli") {
    return allow(CORE_CLI_METHOD_SET, method, principal);
  }
  if (principal === "remote") {
    return allow(CORE_REMOTE_METHOD_SET, method, principal);
  }
  // A capability principal carries its own list and an expiry.
  const list = Array.isArray(options.methods) ? options.methods : null;
  const expiresAt = typeof options.expiresAt === "number" ? options.expiresAt : null;
  if (!list || !list.includes(method)) {
    return { allowed: false, reason: `the capability token is not granted "${method}"` };
  }
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return { allowed: false, reason: "the capability token has expired" };
  }
  return { allowed: true, reason: `granted "${method}" to the capability token` };
}

function allow(set, method, principal) {
  if (set.has(method)) {
    return { allowed: true, reason: `the ${principal} principal may call "${method}"` };
  }
  return {
    allowed: false,
    reason: `the ${principal} principal is not granted "${method}"`,
  };
}

/** Is this a method the protocol knows at all? */
function isKnownCoreMethod(method) {
  return CORE_METHOD_SET.has(method);
}

module.exports = { coreMethodAllowed, isKnownCoreMethod, PRINCIPALS };
