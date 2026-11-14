#!/usr/bin/env node
// autumn — the CLI.
//
// The `cli` principal's entry point: it talks the core protocol to the
// running app over the loopback interface, and the app decides what the CLI
// may do (the principal table in electron/ipc/core-protocol.js).
//
//   autumn status              the app's status
//   autumn terminal list       the terminals
//   autumn agent list          the agent sessions
//   autumn dev-server list     the dev servers
//   autumn worktree list       the worktrees
//   autumn call <method> [json] call any core method the cli principal may
//   autumn raw <method> [json]  the same, with the raw answer
//
// The token lives in <userData>/core-token.json, so the CLI and the app agree
// without a handshake. The address comes from AUTUMN_CORE_URL (the app writes
// the port there when it starts).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USER_DATA = process.env.AUTUMN_USER_DATA_DIR || join(homedir(), ".autumn");
const TOKEN_FILE = join(USER_DATA, "core-token.json");
const ADDRESS_FILE = join(USER_DATA, "core-address.json");

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The token the app and the CLI share. */
function token() {
  const parsed = readJson(TOKEN_FILE);
  return typeof parsed?.token === "string" ? parsed.token : null;
}

/** Where the app is listening. */
function address() {
  if (process.env.AUTUMN_CORE_URL) return process.env.AUTUMN_CORE_URL.replace(/\/$/, "");
  const parsed = readJson(ADDRESS_FILE);
  if (parsed?.url) return String(parsed.url).replace(/\/$/, "");
  const port = Number(process.env.AUTUMN_CORE_PORT);
  if (port) return `http://127.0.0.1:${port}`;
  return null;
}

async function call(method, params = {}) {
  const url = address();
  const bearer = token();
  if (!url) {
    return {
      ok: false,
      error: {
        code: "not-found",
        message: "the app is not running (no core address) — start Autumn and try again",
      },
    };
  }
  if (!bearer) {
    return {
      ok: false,
      error: { code: "unauthorized", message: "no core token — start Autumn and try again" },
    };
  }
  const res = await fetch(`${url}/core`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ method, params, principal: "cli" }),
  });
  return res.json();
}

/** The commands the CLI knows. */
const COMMANDS = {
  status: { method: "core.status", description: "the app's status" },
  "terminal list": { method: "terminal.list", description: "the terminals" },
  "agent list": { method: "agent.list", description: "the agent sessions" },
  "dev-server list": { method: "devServer.list", description: "the dev servers" },
  "worktree list": { method: "worktree.list", description: "the worktrees" },
};

function usage() {
  const lines = ["autumn — the CLI for the running app", "", "Usage:", "  autumn status", "  autumn terminal list", "  autumn agent list", "  autumn dev-server list", "  autumn worktree list", "  autumn call <method> [json-params]", "  autumn raw <method> [json-params]", ""];
  for (const [name, entry] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(18)} ${entry.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const [first, ...rest] = process.argv.slice(2);
  if (!first || first === "help" || first === "--help" || first === "-h") {
    console.log(usage());
    return;
  }

  if (first === "call" || first === "raw") {
    const method = rest[0];
    if (!method) {
      console.error("which method? e.g. `autumn call core.status`");
      process.exitCode = 1;
      return;
    }
    let params = {};
    if (rest[1]) {
      try {
        params = JSON.parse(rest[1]);
      } catch (e) {
        console.error(`the parameters are not JSON: ${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    const env = await call(method, params);
    if (first === "raw") {
      console.log(JSON.stringify(env, null, 2));
    } else if (env.ok) {
      console.log(JSON.stringify(env.result, null, 2));
    } else {
      console.error(`${env.error?.code ?? "error"}: ${env.error?.message ?? "the call failed"}`);
      process.exitCode = 1;
    }
    return;
  }

  const key = [first, ...rest].join(" ");
  const entry = COMMANDS[key];
  if (!entry) {
    console.error(`unknown command "${key}"`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  const env = await call(entry.method);
  if (env.ok) {
    console.log(JSON.stringify(env.result, null, 2));
  } else {
    console.error(`${env.error?.code ?? "error"}: ${env.error?.message ?? "the call failed"}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(String(e?.message ?? e));
    process.exitCode = 1;
  })
  .finally(() => {
    // The fetch agent keeps the socket pool alive for a while — the CLI is a
    // one-shot command, so it leaves as soon as it has answered.
    process.exit(process.exitCode ?? 0);
  });
