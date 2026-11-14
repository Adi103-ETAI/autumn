<p align="center">
  <img src="assets/autumn_banner.png" alt="Autumn — spatial" />
</p>

<p align="center">
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/development.md">Development</a> ·
  <a href="docs/architecture/README.md">Architecture</a> ·
  <a href="docs/branding.md">Brand</a>
</p>

---

## What Autumn is

Autumn is a **desktop canvas** for running several AI coding agents side by side.

You speak to the **Commander**; it spawns agents (**Atlas**, **Apollo**, **Orion**,
**Juno**), you wire them together with bus edges, and they coordinate through a
shared message bus. Everything runs **on your machine**: the agents are the CLIs
you already have installed, the state is a local database, and nothing is
uploaded anywhere.

Autumn ships as a single desktop app for **Windows, macOS and Linux**.

## The six things Autumn does

| | | |
|---|---|---|
| **Canvas** | A spatial board where agents, terminals, documents and screens live as nodes. | [`src/components/autumn/CanvasView.tsx`](src/components/autumn/CanvasView.tsx) |
| **Bus** | A local message bus: agents talk to each other, to tasks and to humans. | [`src/lib/autumn/bus-store.ts`](src/lib/autumn/bus-store.ts) |
| **Storage** | Cloud drives through a **rclone sidecar** that is downloaded on demand and checksum-verified — never bundled in the installer. | [`electron/backend/storage.ts`](electron/backend/storage.ts) |
| **Memory** | Team memory over **MCP**, with least-privilege grants: *recall* cannot write, *contribute* can, and every write is confirmed by a human. | [`electron/backend/supermemory.ts`](electron/backend/supermemory.ts) |
| **Autopilot** | A **team of agents** under one node: one real agent process per member, each in its own terminal, each with its own task. | [`electron/backend/autopilot.ts`](electron/backend/autopilot.ts) |
| **Finder** | Search and browse **the whole machine** — names and file contents — then open, rename, move, copy or trash what you find. | [`electron/backend/fs.ts`](electron/backend/fs.ts) |

Plus two that make it feel finished:

- **Session library** — the sessions your *other* agents (Claude Code, Codex, Pi,
  Amp, Grok) already wrote on this machine are discovered, indexed, searched and
  importable. [`electron/backend/portable-sessions.ts`](electron/backend/portable-sessions.ts)
- **Voice v2** — on-device speech recognition with **Parakeet TDT 0.6B**. The
  ~600 MB model is downloaded **after** installation into your user-data dir, so
  the installer stays small and everything runs fully offline afterwards.
  [`electron/backend/voice-pack.ts`](electron/backend/voice-pack.ts)

## Local-first, honestly

Autumn has one rule that shapes everything:

> **If a capability is not present, say so. Never fake it.**

- A storage remote that is not connected answers `{supported:false, reason}` —
  it never invents a file.
- A missing speech model answers `absent` — it never pretends to listen.
- An agent CLI that is not installed leaves the team member in `needs-setup`
  with a message that says exactly which CLI is missing.
- A token is never fabricated: without a key you get the real refusal shape.

Big binaries are **not** in the installer. They are fetched on demand, verified
against a published checksum, and can be deleted again from the app.

## Quick start

```bash
npm install          # install the dependencies
npm run dev          # the Next.js renderer + the Electron shell
npm test             # 591 tests
```

You need at least one agent CLI on your `PATH` (Claude Code, Codex, OpenCode,
Gemini, Cursor, Grok, Hermes, Pi or Cline) to actually run an agent.

## Building the installers

```bash
npm run pack:files            # compute the runtime closure
npm run build                 # the Next.js standalone server
npm run build:backend         # bundle the Electron backend
npm run electron:build        # the installer for this OS
```

`npm run electron:build:win` / `:mac` / `:linux` build for a specific target.
The CI builds all three on their own runners (the native modules are
platform-specific) and attaches the installers to the run.

See [`docs/architecture/packaging.md`](docs/architecture/packaging.md) for the
whole story.

## How it is put together

```
src/            the renderer — a Next.js app (React, Tailwind, shadcn)
electron/       the desktop shell — main process, preload, IPC, backend
  ipc/          the contract: manifest.json, registry, facade, envelope
  backend/      one module per subsystem, all behind the IPC facade
prisma/         the local database (SQLite)
remotion/       the video template the video editor scaffolds
scripts/        build, packaging and verification scripts
docs/           this documentation
```

**Every renderer → backend call goes through one IPC facade.** The renderer has
no network client of its own; a guard test enforces it. The contract is
`electron/ipc/manifest.json`: 68 namespaces, 504 methods and 68 event
subscriptions, generated so it can never drift from the code.

[`docs/architecture/README.md`](docs/architecture/README.md) has the map.

## Documentation

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | The index |
| [`docs/development.md`](docs/development.md) | Run, test, build, release |
| [`docs/architecture/ipc-facade.md`](docs/architecture/ipc-facade.md) | The contract and the registry |
| [`docs/architecture/backend.md`](docs/architecture/backend.md) | The backend namespaces |
| [`docs/architecture/storage.md`](docs/architecture/storage.md) | The rclone sidecar |
| [`docs/architecture/memory.md`](docs/architecture/memory.md) | Team memory over MCP |
| [`docs/architecture/autopilot.md`](docs/architecture/autopilot.md) | The team of agents |
| [`docs/architecture/finder.md`](docs/architecture/finder.md) | The whole-machine finder |
| [`docs/architecture/sessions.md`](docs/architecture/sessions.md) | The session library |
| [`docs/architecture/voice.md`](docs/architecture/voice.md) | On-device voice (Parakeet) |
| [`docs/architecture/packaging.md`](docs/architecture/packaging.md) | The installers |
| [`docs/architecture/data-and-privacy.md`](docs/architecture/data-and-privacy.md) | Where your data lives |
| [`docs/branding.md`](docs/branding.md) | The logo, the wordmark, the palette |

## Author

**Aditya** — <adi.singh1426@gmail.com> · [@adii.singh_](https://instagram.com/adii.singh_)

## License

[MIT](LICENSE) — see the file.
