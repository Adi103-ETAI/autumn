# Memory

Team memory, spoken to over **MCP**.

Autumn's memory provider is any MCP server the user points at. The point is
not the vendor — it is the two properties around it, which are the ones that
matter:

> **Least privilege.** A connection is *recall* (read) or *contribute* (read
> and write). A recall connection **cannot** write.
>
> **Human confirmation.** Every write is confirmed by the human first, and
> recalled content is treated as *reference to weigh*, never as instructions to
> obey.

```
electron/backend/supermemory.ts   the seven methods + the grant store
```

## The seven methods

| Method | What it does |
|---|---|
| `supermemory.status` | `{state, credentialKind, vaultMode, spaces[], selectedSpace, scope}`. `state` is `signed-out` when there is no credential. |
| `supermemory.signIn` | Connect with the provider's own OAuth: discovery → dynamic client registration → PKCE → a loopback redirect on `127.0.0.1`. |
| `supermemory.connectApiKey` | Connect with an API key. The key's shape is checked, the provider is really probed, and the key is stored encrypted. |
| `supermemory.signOut` | Remove the stored credential and clear every grant. |
| `supermemory.selectSpace` | Choose the space writes go to. The space must be one the provider really offers. |
| `supermemory.grant` | Grant an agent access: `{canvasId, nodeId, intentId, access}`. |
| `supermemory.revoke` | Revoke it. |

Plus the push: `supermemory.onGrantChanged`, fired when a grant really changes.

## The status shape

```js
{
  state: "signed-out" | "connected",
  credentialKind: "api-key" | "oauth" | null,
  vaultMode: "keychain" | "memory",
  spaces: [{ name, containerTag, visibility?, emoji?, description?, documentCount?, memoryCount? }],
  selectedSpace: { name, containerTag, visibility?, emoji? } | null,
  scope: "provider-space"
}
```

The spaces come from the provider's own list tool (`listSpaces`,
`listContainerTags` or `listProjects` — whichever it offers), normalized:
at most 100 spaces, a container tag of at most 128 characters, no control
bytes, de-duplicated. A single space is selected automatically.

## The credential

The credential is a secret, so it is treated like one:

| | |
|---|---|
| Where | `<userData>/supermemory-vault.json`, mode `0600` |
| How | encrypted with the OS keychain (Keychain / DPAPI / libsecret) |
| Without a keychain | kept in memory only, and **never written to disk** — `vaultMode` says `memory` |

Signing out deletes the file.

## The grants

A grant is keyed by `(canvasId, nodeId)` and carries:

```ts
{ id, canvasId, nodeId, intentId, access: "recall" | "recall-and-contribute", binding, mintedAt }
```

- The **intent** binds the grant to one request. A different intent is
  refused: `intent-changed`.
- The **binding** is the live agent the grant was minted for. When that agent
  is gone, the grant dies: `execution-changed`.
- The **access** decides what the agent may do. A `recall` grant that tries to
  write is refused: `access-insufficient`.
- Only the harnesses that can actually collaborate are eligible: Claude Code,
  Codex, OpenCode, Hermes, Cursor, Grok, Gemini, Qwen, OMP, Pi, Cline.

The four refusals are the whole point:

| Denial | When |
|---|---|
| `no-grant` | There is no grant for this agent. |
| `intent-changed` | The grant was minted for a different intent. |
| `access-insufficient` | A recall-only grant tried to write. |
| `execution-changed` | The agent the grant was minted for is gone. |

## The MCP client

Autumn speaks the streamable-HTTP transport directly:

```
initialize → tools/list → tools/call
```

The provider's tools are resolved by name, because providers name them
differently:

| Purpose | The names Autumn looks for |
|---|---|
| Search | `search_memory`, `recall`, `search`, `searchSupermemory` |
| Spaces | `listSpaces`, `listContainerTags`, `listProjects` |
| Identity | `whoAmI` |
| Write | `add_memory`, `memory`, `save-memory`, `addToSupermemory`, `addMemory`, `add` |

## The tests

`electron/backend/supermemory.test.js` runs a **real local MCP server** — an
HTTP server that speaks the JSON-RPC the client speaks. The handshake, the tool
discovery, the space listing and the key verification all really happen. The
grant store is tested against its four denials.
