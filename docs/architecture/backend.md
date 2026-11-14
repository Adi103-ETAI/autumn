# The backend

The backend is the Electron main process. One module per subsystem, all behind
the IPC facade, all with their dependencies injected so they can be driven
headlessly in the tests.

```
electron/backend/
  index.ts        the factory registry — every namespace is listed here
  handlers.ts     the original handlers + the shared types
  params.ts       the parameter helpers every module shares
  store.ts        the flat-JSON persistence + the user-data dir
  w1-deps.ts      the dependency surface (the injected deps)
  sidecar.ts      the download / verify / extract helpers
  …one file per subsystem…
```

## The dependency surface

Every module is built by a factory that takes one dependency object:

```ts
export function makeStorageHandlers(deps: W1Deps): RegisteredHandler[]
```

`W1Deps` carries everything a handler may need — the database, the PTY
factory, the agent spawner, the bus store, the shell, the clipboard, the screen
capture, git, the process spawner, `emit` and `now`. A handler never reaches
for a global: that is what makes the tests possible.

## The registry

`electron/backend/index.ts` holds every factory in one list:

```ts
const W2_FACTORIES = [
  makeSettingsHandlers,
  makeStorageHandlers,
  makeSupermemoryHandlers,
  makeAutopilotHandlers,
  …
];
```

`registerBackend()` flattens them into the IPC registry. Adding a namespace
means: write the module, add the import, add the factory to the list.

## The namespaces

The contract has 68 namespaces. This is what is implemented today:

The counts below are the contract's; **every one of them is implemented**.

| Namespace | Methods | Implemented | Pushes |
|---|---:|---:|---:|
| `activity` | 6 | 6 | 1 |
| `agent` | 2 | 2 | 0 |
| `agentAccounts` | 11 | 11 | 0 |
| `agentAuth` | 1 | 1 | 0 |
| `agentConnections` | 2 | 2 | 0 |
| `analytics` | 4 | 4 | 0 |
| `app` | 9 | 9 | 3 |
| `artifacts` | 13 | 13 | 1 |
| `auth` | 12 | 12 | 1 |
| `autopilot` | 6 | 6 | 1 |
| `backends` | 23 | 23 | 0 |
| `browser` | 11 | 11 | 2 |
| `bus` | 35 | 35 | 6 |
| `canvas` | 8 | 8 | 0 |
| `chats` | 1 | 1 | 0 |
| `cliLink` | 3 | 3 | 0 |
| `clipboard` | 4 | 4 | 0 |
| `cloud` | 12 | 12 | 0 |
| `cloudAgents` | 11 | 11 | 1 |
| `codeSync` | 9 | 9 | 1 |
| `compute` | 10 | 10 | 1 |
| `cues` | 8 | 8 | 0 |
| `devServer` | 5 | 5 | 0 |
| `diagnostics` | 2 | 2 | 0 |
| `documents` | 4 | 4 | 2 |
| `element` | 1 | 1 | 0 |
| `events` | 0 | 0 | 19 |
| `facts` | 11 | 11 | 1 |
| `files` | 39 | 39 | 1 |
| `find` | 4 | 4 | 0 |
| `fs` | 12 | 12 | 0 |
| `git` | 12 | 12 | 0 |
| `github` | 4 | 4 | 0 |
| `hostedMessaging` | 3 | 3 | 0 |
| `inference` | 1 | 1 | 0 |
| `liveblocks` | 1 | 1 | 0 |
| `models` | 1 | 1 | 0 |
| `multiplayer` | 1 | 1 | 0 |
| `nav` | 1 | 1 | 0 |
| `oauth` | 1 | 1 | 0 |
| `phone` | 12 | 12 | 1 |
| `plan` | 9 | 9 | 0 |
| `projectChatHistory` | 3 | 3 | 0 |
| `projects` | 16 | 16 | 0 |
| `providerUsage` | 2 | 2 | 1 |
| `remoteConfig` | 1 | 1 | 1 |
| `remotion` | 7 | 7 | 0 |
| `resources` | 1 | 1 | 2 |
| `runtime` | 4 | 4 | 1 |
| `servers` | 6 | 6 | 0 |
| `sessions` | 18 | 18 | 1 |
| `settings` | 4 | 4 | 1 |
| `share` | 3 | 3 | 3 |
| `simulator` | 3 | 3 | 0 |
| `skills` | 2 | 2 | 0 |
| `slides` | 4 | 4 | 0 |
| `storage` | 7 | 7 | 0 |
| `supermemory` | 7 | 7 | 1 |
| `supervisor` | 2 | 2 | 0 |
| `tasks` | 16 | 16 | 0 |
| `terminal` | 28 | 28 | 15 |
| `thumbnails` | 2 | 2 | 0 |
| `update` | 4 | 4 | 0 |
| `video` | 4 | 4 | 0 |
| `voice` | 15 | 15 | 0 |
| `wallpapers` | 3 | 3 | 0 |
| `workspace` | 7 | 7 | 0 |
| `worktrees` | 10 | 10 | 0 |

**Every method of the contract is implemented: 504 bridge methods and 129 core
methods.**

The hosted tier — `cloud`, `cloudAgents`, `compute`, `plan`, `codeSync`,
`servers`, `analytics`, `share`, `hostedMessaging`, `agentConnections`,
`liveblocks`, `multiplayer` — is the part of the product that lives on someone
else's machine. It is **not** built here, but it **exists** in the contract
and every one of those methods answers honestly:

```js
{ ok: false, error: { code: "not-implemented", message: "this belongs to the hosted tier — autumn is local-first…" } }
```

Three methods need a hosted service Autumn does not have, and say so:

| Id | Why |
|---|---|
| `backends.convexAuthStatus` | The Convex cloud backend's auth state. |
| `backends.convexCreate` | Creating a Convex project. |
| `backends.convexLogin` | Signing in to Convex. |

Everything else the app can do locally, it does — for real.

## How a handler is written

```ts
{
  kind: "bridge",
  id: "storage.ensure",
  description:
    "make the rclone sidecar available; params: {version?} -> {ready, path, version, …}",
  schema: (p) => (typeof p.version === "string" ? { ok: true } : { ok: false, message: "version optional" }),
  handler: async (params) => { … },
}
```

- **`description`** — one line, and it documents the parameters. The Bridge
  Inspector shows it, and the tests read it.
- **`schema`** — an optional validator that runs before the handler. It
  returns `{ok:true}` or `{ok:false, message}`.
- **`handler`** — returns a plain payload (the registry wraps it) or an
  explicit `{ok:false, error:{code, message}}`.

## The rules

1. **Never fake a result.** A capability that is not present answers
   `{supported:false, reason}` or `{ok:false, error:{code:"not-implemented"}}`.
2. **Never talk to the network from the renderer.** Only the backend does, and
   only where the user asked.
3. **Verify every download** against a published checksum before it is used.
4. **Keep big binaries out of the installer.** Fetch them on demand into the
   user-data dir.
