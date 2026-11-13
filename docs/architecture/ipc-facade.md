# The IPC facade

The facade is the only door between the renderer and the backend. It has four
parts:

| File | What it does |
|---|---|
| `electron/ipc/manifest.json` | **The contract.** 68 namespaces, 504 dispatchable methods, 68 event subscriptions. |
| `electron/ipc/registry.js` | The dispatcher: auth → schema → handler → envelope. |
| `electron/ipc/facade.js` | Builds `window.autumn` from the manifest. |
| `electron/preload.js` | Wires the facade to Electron's IPC. |

## The contract

```jsonc
{
  "bridge": {
    "namespaces": {
      "storage": ["ensure", "remotes", "connect", "cancelConnect", "disconnect", "list", "importToLibrary"],
      "supermemory": ["status", "signIn", "connectApiKey", "signOut", "selectSpace", "grant", "revoke", "onGrantChanged"],
      // …
    }
  },
  "rendererUsage": {
    "namespaces": { "storage": ["connect", "ensure", "importToLibrary", "list", "remotes"], "…": [] }
  },
  "core": { "groups": { "agent": ["agent.begin", "…"], "…": {} } }
}
```

Two lists per namespace:

- **`bridge.namespaces`** — everything that *can* be called.
- **`rendererUsage.namespaces`** — what the renderer *does* call. This is the
  contract the tests enforce: every renderer-used method must dispatch-resolve.

The manifest is generated (`scripts/gen-ipc-manifest.mjs`) and committed, so
the tests run self-contained and the shape can never drift from the code.

## The facade

The preload builds the whole surface from the manifest:

```js
const facade = buildFacade({ manifest, invoke, subscribe, … });
contextBridge.exposeInMainWorld("autumn", facade);
```

which gives the renderer:

```js
await window.autumn.storage.ensure();                       // → envelope
await window.autumn.fs.browse({ path: "/home/me" });         // → envelope
const off = window.autumn.supermemory.onGrantChanged((e) => …); // → unsubscribe
```

Every call travels on **one** channel, `autumn:invoke`, and every subscription
on its own channel, `autumn:event:<id>`.

A method whose name starts with `on` is a **subscription**, not a call: it
takes a callback and returns the unsubscribe function.

Calls take one params object, and the facade packs extra positional arguments
into `{args:[…]}` so both conventions work:

```js
window.autumn.terminal.input("node-1", "ls\n");   // → {args:["node-1","ls\n"]}
```

The backend handlers accept both shapes (`paramsOf` in
`electron/backend/params.ts`).

### One deliberate exception

`pathForFile` is **preload-local**, not a call. A dropped file's OS path can
only be read by `webUtils.getPathForFile`, which works in the preload process
only, so the preload overrides the facade member:

```js
facade.files.pathForFile = pathForFile;
facade.fs.pathForFile = pathForFile;
```

## The registry

`electron/ipc/registry.js` dispatches:

```
principal → schema → handler → envelope
```

- **principal** — `desktop` (the renderer), `cli`, `remote`, `local-client`,
  `capability`. The rules are fail-closed.
- **schema** — an optional per-method validator. It runs *before* the handler,
  so bad input never reaches the code.
- **envelope** — always the same shape:

```js
{ ok: true,  result: … }
{ ok: false, error: { code: "bad-params", message: "…" } }
```

The error codes are `bad-params`, `not-found`, `not-implemented`,
`handler-error` and `unauthorized`.

A handler that returns a plain payload is wrapped as `{ok:true,result:…}`; a
handler that returns `{ok:false,error:{…}}` passes straight through.

## The guard

The renderer has **no** HTTP client. `electron/backend/renderer-guard.test.js`
walks the renderer's source and fails the build if it finds one. The app talks
to the outside world only from the backend, and only where the user asked for
it (the storage sidecar, the memory provider, the model downloads).

## The Bridge Inspector

At runtime the renderer can inspect the live surface:

```js
await window.autumn.__bridge();   // every registered handler + its description
```

The descriptions are the same one-liners the docs use, so the inspector is a
readable index of the backend.
