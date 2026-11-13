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

| Namespace | Methods | Implemented | What it does |
|---|---:|---:|---|
| `activity` | 6 | 2 | The activity timeline behind the bus. |
| `agent` | 2 | 2 | Questions the user asked an agent, and their answers. |
| `agentAccounts` | 11 | 11 | The signed-in accounts of the agent CLIs, with probing. |
| `artifacts` | 13 | 12 | Generated artifacts and their versions. |
| `auth` | 12 | 12 | The local user, sign-in, sign-up, sessions. |
| `autopilot` | 6 | 6 | **The team of agents.** → [autopilot.md](./autopilot.md) |
| `backends` | 23 | 23 | The backend registry: web backends, local backends, provisioning. |
| `browser` | 11 | 11 | The embedded browser: profiles, history, downloads. |
| `bus` | 35 | 30 | **The message bus.** Peers, inboxes, consent, tasks. |
| `canvas` | 8 | 8 | The canvas: state, export, import, staged commands. |
| `clipboard` | 4 | 3 | Read and write the system clipboard. |
| `cues` | 8 | 8 | Saved commands you can invoke by name. |
| `devServer` | 5 | 4 | The local dev server for the renderer. |
| `diagnostics` | 2 | 2 | Crash reports, with the secrets scrubbed. |
| `element` | 1 | 1 | Resolve a DOM element reference. |
| `files` | 39 | 37 | The project file tree: read, write, rename, move, trash. |
| `find` | 4 | 3 | The in-app search over the canvas. |
| `fs` | 12 | 12 | **The whole-machine finder.** → [finder.md](./finder.md) |
| `git` | 12 | 10 | Status, changes, stage, commit, push, worktrees. |
| `nav` | 1 | 1 | Detect the app in front of the user. |
| `phone` | 12 | 12 | The phone relay: pairing, devices, connected apps. |
| `projectChatHistory` | 3 | 3 | The project chat's history. |
| `remotion` | 7 | 7 | The video editor: projects, compositions, render. |
| `resources` | 1 | 1 | Memory and process pressure. |
| `runtime` | 4 | 3 | The bundled Node runtime. |
| `sessions` | 18 | 18 | **The session library.** → [sessions.md](./sessions.md) |
| `settings` | 4 | 4 | The settings document and the FTUE state. |
| `skills` | 2 | 2 | The installed skills. |
| `slides` | 4 | 4 | The deck editor: scaffold, present, stop. |
| `storage` | 7 | 7 | **Cloud drives.** → [storage.md](./storage.md) |
| `supermemory` | 7 | 7 | **Team memory.** → [memory.md](./memory.md) |
| `tasks` | 16 | 13 | The task board, the chat queue, steering. |
| `terminal` | 28 | 27 | PTYs, agents in terminals, session history. |
| `thumbnails` | 2 | 1 | Thumbnail capture and cache. |
| `update` | 4 | 2 | The updater: state, check, start, install. |
| `video` | 4 | 4 | The video pipeline: subtitles, background music, narration. |
| `voice` | 15 | 15 | **The voice pack.** → [voice.md](./voice.md) |
| `wallpapers` | 3 | 3 | The wallpapers. |
| `worktrees` | 10 | 9 | The git worktrees. |

**340 of 504 methods are implemented.** The rest belong to the hosted tier
(`cloud`, `cloudAgents`, `compute`, `hostedMessaging`, `agentConnections`,
`codeSync`, `share`, `plan`, `projects`, `workspace`, `servers`, `facts`,
`activity`…) — the part of the product that lives on someone else's machine.
Those namespaces are honest about it: they answer `not-implemented` with the
reason.

## The boundary ids

Three methods answer `not-implemented` on purpose, because they need a hosted
service Autumn does not have:

| Id | Why |
|---|---|
| `backends.convexAuthStatus` | The Convex cloud backend's auth state. |
| `backends.convexCreate` | Creating a Convex project. |
| `backends.convexLogin` | Signing in to Convex. |

And two more need the hosted runtime:

| Id | Why |
|---|---|
| `runtime.installOctober` | Installing the hosted runtime. |
| `runtime.removeOctober` | Removing it. |

Everything else that the app can do locally, it does.

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
