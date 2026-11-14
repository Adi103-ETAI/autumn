// autumn — the core server (Wave 4, doc 35 §7).
//
// The core protocol needs a transport. The app serves it: a small HTTP
// server on 127.0.0.1 that speaks the core protocol, so the `cli` — and
// anything else holding a capability token — can drive the same backend the
// renderer drives.
//
//   POST /core            {method, params} -> the envelope
//   GET  /core/handshake  the protocol's versions and the principal's grants
//
// It is bound to the loopback interface only, and every call is authorised by
// the principal table before the handler runs. The token lives in the
// user-data dir, so the CLI and the app agree on it without a handshake.

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { coreMethodAllowed } from "../ipc/auth";
import { CORE_MAX_COMMAND_BYTES, CORE_MAX_RESPONSE_BYTES } from "../ipc/core-protocol";
import { userDataDir } from "./store";

export interface CoreServerOptions {
  /** The dispatcher — the registry's dispatch. */
  dispatch: (req: {
    kind: "core" | "bridge";
    id: string;
    principal: string;
    params: Record<string, unknown>;
    capability?: { methods?: string[]; expiresAt?: number };
  }) => Promise<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }>;
  /** The port to listen on (0 = any free port). */
  port?: number;
  /** The token file (defaults to <userData>/core-token.json). */
  tokenFile?: string;
}

export interface CoreServer {
  /** The port it listens on. */
  readonly port: number;
  /** The URL a client should call. */
  readonly url: string;
  /** The token the clients use. */
  readonly token: string;
  /** Stop the server. */
  close(): Promise<void>;
}

const tokenPath = (): string => join(userDataDir(), "core-token.json");

/** The shared token — it is created once and reused. */
export function coreToken(file = tokenPath()): string {
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { token?: string };
      if (typeof parsed.token === "string" && parsed.token.length >= 16) return parsed.token;
    }
  } catch {
    /* a damaged token file is replaced */
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ token }, null, 2), { encoding: "utf8", mode: 0o600 });
  return token;
}

/**
 * Start the core server.
 *
 * It only listens on the loopback interface, and it answers only the core
 * protocol — the bridge facade stays inside the app.
 */
export async function startCoreServer(options: CoreServerOptions): Promise<CoreServer> {
  const token = coreToken(options.tokenFile);
  let port = 0;

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body ?? null);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/core/handshake") {
      send(200, {
        ok: true,
        result: {
          apiVersion: 2,
          schemaVersion: 8,
          server: "autumn",
          principal: "cli",
          granted: "cli",
        },
      });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/core") {
      send(404, { ok: false, error: { code: "not-found", message: "the core protocol is served at POST /core" } });
      return;
    }

    // The token: the bearer header, or ?token= for the simplest clients.
    const header = req.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const presented = bearer || url.searchParams.get("token") || "";
    if (presented !== token) {
      send(401, { ok: false, error: { code: "unauthorized", message: "the core token is missing or wrong" } });
      return;
    }

    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > CORE_MAX_COMMAND_BYTES) {
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      void (async () => {
        let parsed: any;
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          send(400, { ok: false, error: { code: "bad-params", message: "the body is not JSON" } });
          return;
        }
        const method = typeof parsed?.method === "string" ? parsed.method : "";
        const params = parsed?.params && typeof parsed.params === "object" ? parsed.params : {};
        if (!method) {
          send(400, { ok: false, error: { code: "bad-params", message: "a method is required" } });
          return;
        }
        // The principal table decides — before the handler runs.
        const principal = typeof parsed?.principal === "string" ? parsed.principal : "cli";
        const capability =
          principal === "capability" && Array.isArray(parsed?.capability?.methods)
            ? { methods: parsed.capability.methods, expiresAt: parsed.capability.expiresAt }
            : undefined;
        const allowed = coreMethodAllowed(principal, method, capability ?? {});
        if (!allowed.allowed) {
          send(403, { ok: false, error: { code: "forbidden", message: allowed.reason } });
          return;
        }
        const env = await options.dispatch({ kind: "core", id: method, principal, params, capability });
        const text = JSON.stringify(env);
        if (Buffer.byteLength(text) > CORE_MAX_RESPONSE_BYTES) {
          send(413, {
            ok: false,
            error: { code: "handler-error", message: "the answer is larger than the protocol allows" },
          });
          return;
        }
        send(200, env);
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;

  return {
    get port() {
      return port;
    },
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
