# Autumn — documentation

Autumn is a local-first spatial desktop for AI coding agents. This directory
is the documentation of the app: what it does, how it is put together, how to
run it, and how it is packaged.

Nothing here is aspirational. Every document describes the code that is in this
repository today.

## Start here

| Document | What it answers |
|---|---|
| [Development](./development.md) | How do I run, test, build and release it? |
| [Architecture](./architecture/README.md) | How is it put together? |
| [Brand](./branding.md) | What does Autumn look like, and what are the rules? |
| [Data and privacy](./architecture/data-and-privacy.md) | Where does my data live, and what leaves the machine? |

## The subsystems

| Document | The subsystem |
|---|---|
| [The IPC facade](./architecture/ipc-facade.md) | The contract between the renderer and the backend, the registry, the envelope and the guard that keeps the renderer off the network. |
| [The core protocol](./architecture/core-protocol.md) | The second method set: 129 methods over 21 groups, and the per-principal table. |
| [The backend](./architecture/backend.md) | Every backend namespace, what it does and how to add a new one. |
| [Storage](./architecture/storage.md) | Cloud drives through the rclone sidecar. |
| [Memory](./architecture/memory.md) | Team memory over MCP, with least-privilege grants. |
| [Autopilot](./architecture/autopilot.md) | The team of agents under one node. |
| [The finder](./architecture/finder.md) | Browsing and searching the whole machine. |
| [The session library](./architecture/sessions.md) | The sessions your other agents already wrote. |
| [Voice](./architecture/voice.md) | On-device speech recognition with Parakeet. |
| [Packaging](./architecture/packaging.md) | The installers, the CI and the release. |

## The map of the repository

```
src/            the renderer — a Next.js app (React, Tailwind, shadcn)
electron/       the desktop shell — main process, preload, IPC, backend
  ipc/          the contract: manifest.json, registry, facade, envelope
  backend/      one module per subsystem, all behind the IPC facade
  backend/core/ the core protocol — the other principals' method set
prisma/         the local database (SQLite)
remotion/       the video template the video editor scaffolds
scripts/        build, packaging and verification scripts
brand/          the brand assets (the logo, the ASCII wordmark)
docs/           this documentation
```

## The two rules

Autumn has a single rule that shapes every subsystem:

> **If a capability is not present, say so. Never fake it.**

A storage remote that is not connected answers `{supported:false, reason}`. A
missing speech model answers `absent`. An agent CLI that is not installed
leaves the team member in `needs-setup`. A token is never fabricated. The
hosted tier answers `not-implemented` with the reason.

The second rule follows from the first:

> **Big binaries are never in the installer.** They are fetched on demand,
> verified against a published checksum, and can be deleted again.
