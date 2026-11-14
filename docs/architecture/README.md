# Architecture

Autumn is a spatial canvas for AI coding agents. This directory holds the
architecture docs: what the app is made of, and how each part fits.

## Index

| Document | What it covers |
|---|---|
| [The IPC facade](./ipc-facade.md) | The contract between the renderer and the backend, the registry, the envelope and the guard that keeps the renderer off the network. |
| [The core protocol](./core-protocol.md) | The second method set: 129 methods over 21 groups, and the per-principal table. |
| [The backend](./backend.md) | Every backend namespace, what it does and how to add a new one. |
| [Storage](./storage.md) | Cloud drives through the rclone sidecar. |
| [Memory](./memory.md) | Team memory over MCP, with least-privilege grants. |
| [Autopilot](./autopilot.md) | The team of agents under one node. |
| [The finder](./finder.md) | Browsing and searching the whole machine. |
| [The session library](./sessions.md) | The sessions your other agents already wrote. |
| [Voice](./voice.md) | On-device speech recognition with Parakeet. |
| [Packaging](./packaging.md) | The installers, the CI and the release. |
| [Data and privacy](./data-and-privacy.md) | Where your data lives, and what leaves the machine. |
| [Autumn Bus (full scale)](./autumn-bus-fullscale.md) | The daemon design for the bus. |

## The shape of it

```
┌──────────────────────────────────────────────────────────────┐
│  RENDERER  (Next.js / React / Tailwind)                       │
│                                                              │
│  window.autumn.<namespace>.<method>(params)                   │
│      │  one generic channel: autumn:invoke                   │
│      │  window.autumn.<namespace>.on<Event>(cb)               │
│      ▼  one channel per subscription: autumn:event:<id>      │
├──────────────────────────────────────────────────────────────┤
│  ELECTRON MAIN                                               │
│                                                              │
│  preload.js  →  builds the facade from the manifest          │
│  ipc/registry.js  →  dispatches, validates, wraps in an      │
│                      envelope                                 │
│  backend/*.ts  →  one module per subsystem                   │
│  backend/core/*  →  the core protocol (the other principals) │
├──────────────────────────────────────────────────────────────┤
│  LOCAL                                                        │
│  Prisma (SQLite) · the agent CLIs · the bus · the user-data  │
│  dir (sidecars, models, the session index)                    │
└──────────────────────────────────────────────────────────────┘
```

The renderer never opens a socket of its own. Every call it makes goes
through the facade, into the registry, and lands in a backend handler. A guard
test fails the build if a network client ever appears in the renderer's
source.

## Conventions

- Code references use `path` (e.g. `electron/backend/storage.ts`).
- Diagrams use Mermaid `graph TD`.
- The contract is `electron/ipc/manifest.json`: 68 namespaces, 504 dispatchable
  methods, 68 event subscriptions, plus 129 core methods over 21 groups.
- Honesty is a contract, not a style: see [the rules](../README.md).
