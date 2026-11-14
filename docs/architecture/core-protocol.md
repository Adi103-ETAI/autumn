# The core protocol

Autumn has **two** method sets.

| | The bridge facade | The core protocol |
|---|---|---|
| Who uses it | The renderer (`window.autumn`) | The `cli`, the `remote` relay, the `local-client` and the capability principals |
| How | Electron IPC (`autumn:invoke`) | The bus |
| Shape | `namespace.method` | `group.method` |
| Size | 68 namespaces · 504 methods | 21 groups · **129 methods** |
| Auth | the `desktop` principal | **a per-principal table** |

The two are the **same backend**. A core method is an adapter: it takes the
protocol's shape and hands it to the bridge handler that already does the
work. Nothing is implemented twice.

```
core.terminal.create  →  terminal.start
core.git.query        →  git.status / git.changes / …
core.facts.query      →  the facts operations
```

## The principals

| Principal | What it is | What it may call |
|---|---|---|
| `desktop` | The app's own renderer | everything |
| `cli` | The command line | 13 methods: drive a terminal, look around |
| `remote` | The phone relay | 31 methods: the relay's surface |
| `local-client` | The in-app surfaces (the dock, the panels) | 12 methods: read the surfaces |
| `capability` | A capability token | **exactly** the methods its grant lists, until it expires |

The table is data, not code: `electron/ipc/core-protocol.js` holds it, and
`electron/ipc/auth.js` enforces it before a handler ever runs.

```js
coreMethodAllowed("cli", "terminal.create");   // { allowed: true,  reason: … }
coreMethodAllowed("cli", "git.mutate");        // { allowed: false, reason: "not granted" }
coreMethodAllowed("capability", "facts.query", { methods: ["facts.query"] });
```

A capability token carries its own method list **and** its own expiry, so a
token can be given exactly the access it needs — and it stops working when it
expires.

## The handshake

```js
await core.handshake({});
// { apiVersion: 2, minApiVersion: 2, maxApiVersion: 2, schemaVersion: 8,
//   principal: "cli", granted: "cli", server: "autumn" }
```

The limits are in the same place:

| | |
|---|---|
| `CORE_MAX_COMMAND_BYTES` | 1 MB |
| `CORE_MAX_RESPONSE_BYTES` | 4 MB |
| `CORE_MAX_EVENT_BYTES` | 1 MB |
| `CORE_EVENT_QUEUE_BYTES` | 4 MB |
| `TERMINAL_IMAGE_MAX_BYTES` | 700 KB |

## The groups

| Group | Methods | What it drives |
|---|---:|---|
| `artifacts` | 2 | the artifacts |
| `agent` | 6 | the agent sessions |
| `bus` | 3 | the message bus |
| `capability` | 9 | the capability grants |
| `chat` | 8 | the chat turns |
| `cloudAgent` | 6 | the hosted tier — **not implemented here** |
| `core` | 9 | the app's own lifecycle |
| `delivery` | 9 | the delivery policy |
| `devServer` | 8 | the dev server |
| `document` | 4 | the documents |
| `facts` | 2 | the facts |
| `fs` | 2 | the files |
| `git` | 3 | the repository |
| `hosted` | 9 | the hosted tier — **not implemented here** |
| `intent` | 3 | the intent queue |
| `launch` | 1 | the launch grants |
| `localClient` | 4 | the local clients |
| `remote` | 11 | the phone relay |
| `terminal` | 9 | the terminals |
| `ui` | 14 | the questions and the canvas commands |
| `worktree` | 6 | the worktrees |

## The hosted tier

`hosted.*` and `cloudAgent.*` are the part of the product that lives on someone
else's machine. They are **not** built here — but they **exist** in the
protocol, and they answer honestly:

```js
await core.hostedStatus({});
// { ok: false, error: { code: "not-implemented",
//   message: "the hosted tier is not part of this build — autumn is local-first…" } }
```

A client gets a real answer, not "no handler for core.hosted.status".

## The local state

The protocol's own state — the intents, the capability grants, the launch
grants, the delivery policy, the staged terminal images — is local, small and
short-lived, so it lives in flat JSON files under the user-data dir:

```
<userData>/db/core-intents.json
<userData>/db/core-capabilities.json
<userData>/db/core-launch-grants.json
<userData>/db/core-delivery-policy.json
<userData>/db/core-staged-images.json
```

A granted capability is really granted. An expired grant is really refused. A
staged image really lands on disk (`<userData>/terminal-images/`), and it
expires after 30 days.

## The tests

`electron/backend/core.test.js` registers the **real** backend and checks:

- the whole surface is there: **129/129**;
- every method dispatches and answers an envelope;
- the cli may drive a terminal and is refused a desktop-only method;
- a capability token carries its own grant;
- the hosted tier exists and answers honestly.

`electron/ipc/core-protocol.test.js` checks the surface itself: the 129
methods, the 21 groups, the per-principal tables and the version constants.
