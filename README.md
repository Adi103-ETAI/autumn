<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/header/logo-dark.svg">
    <img src="assets/header/logo-light.svg" alt="Autumn" width="520">
  </picture>
  <br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/header/tagline-dark.svg">
    <img src="assets/header/tagline-light.svg" alt="Your AI agents can finally work on one canvas." width="520">
  </picture>
</div>

---

<p>
  <a href="#quickstart"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/header/button-start-dark.svg"><img src="assets/header/button-start-light.svg" alt="Quickstart" height="40" align="top"></picture></a>
  <a href="#what-autumn-does"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/header/button-does-dark.svg"><img src="assets/header/button-does-light.svg" alt="What it does" height="40" align="top"></picture></a>
  <a href="#run-it-wherever-you-want"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/header/button-local-dark.svg"><img src="assets/header/button-local-light.svg" alt="Run it locally" height="40" align="top"></picture></a>
  <a href="#want-to-build-with-autumn"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/header/button-build-dark.svg"><img src="assets/header/button-build-light.svg" alt="Build with it" height="40" align="top"></picture></a>
</p>

---

**Your AI agents can finally work on one canvas.**

Ever built something with one agent, then copied the entire conversation into another just to get it reviewed?

Or needed a teammate's agent to explain why it changed something?

Autumn gives your AI agents **one canvas** to work on — together.

- **Stop switching tools.** Ask one agent to review another's work, right from your current session.
- **Give every agent a job.** Have Claude Code work on the API while Codex writes the tests.
- **See everything happen.** Who is working on what, what is finished, what is blocked.

No copying. No explaining the same problem twice.

**Open source. Free to run locally. Nothing leaves your machine.**

[Get started](#quickstart) · [Documentation](docs/README.md) · [Architecture](docs/architecture/README.md)

---

## Get a second opinion without switching tabs

Ever asked an agent to build something, then wanted another one to check its work?

Just ask:

> "Ask my Claude Code session to review this fix, check for edge cases, and send its feedback here."

That's it.

Your agents send each other code, questions, files and feedback. The answer comes back to the session you are already in.

**No copying code. No explaining the same problem twice.**

## Give your agents different jobs

Why make one agent do everything?

Have Claude Code work on the API while Codex writes the tests. Or ask one agent to review what another just built.

They share tasks, pick up jobs, and post progress so everyone knows what is happening.

You can see who is working on what, what is finished, and whether a message was delivered or answered.

**Less babysitting. More work getting done.**

## Put them all on one canvas

Agents are not chat windows in a sidebar. In Autumn they are **nodes on a board**.

Every agent, terminal, document, screenshot and cloud drive lives on the same canvas, wired together with edges. An agent can see what the others are doing, and you can see it too.

- Ask another agent why it made a change.
- Send code for review and get feedback.
- Share files, questions and updates.
- Look up earlier conversations and decisions in one place.

Everything is local: the canvas, the state, the history.

## What Autumn does

| | | |
|---|---|---|
| **Canvas** | A spatial board where agents, terminals, documents and screens live as nodes. | [`src/components/autumn/CanvasView.tsx`](src/components/autumn/CanvasView.tsx) |
| **Bus** | A local message bus: agents talk to each other, to tasks and to you. | [`src/lib/autumn/bus-store.ts`](src/lib/autumn/bus-store.ts) |
| **Storage** | Cloud drives through an **rclone sidecar** that is downloaded on demand and checksum-verified — never bundled in the installer. | [`electron/backend/storage.ts`](electron/backend/storage.ts) |
| **Memory** | Team memory over **MCP**, with least-privilege grants: *recall* cannot write, *contribute* can, and every write is confirmed by a human. | [`electron/backend/supermemory.ts`](electron/backend/supermemory.ts) |
| **Autopilot** | A **team of agents** under one node: one real agent process per member, each in its own terminal, each with its own task. | [`electron/backend/autopilot.ts`](electron/backend/autopilot.ts) |
| **Finder** | Search and browse **the whole machine** — names and file contents — then open, rename, move, copy or trash what you find. | [`electron/backend/fs.ts`](electron/backend/fs.ts) |

Plus two that make it feel finished:

- **Session library** — the sessions your *other* agents (Claude Code, Codex, Pi, Amp, Grok) already wrote on this machine are discovered, indexed, searched and importable.
  [`electron/backend/portable-sessions.ts`](electron/backend/portable-sessions.ts)
- **Voice** — on-device speech recognition with **Parakeet TDT 0.6B**. The ~600 MB model is downloaded **after** installation into your user-data dir, so the installer stays small and everything runs fully offline afterwards.
  [`electron/backend/voice-pack.ts`](electron/backend/voice-pack.ts)

**Nothing is faked.** A drive that is not connected says so. A missing speech model says so. An agent CLI that is not installed says exactly which one is missing.

## Quickstart

Get your agents on a canvas in a few steps.

**You'll need:** Node.js 20 or later, and at least one agent CLI — Claude Code, Codex, OpenCode, Gemini, Cursor, Grok, Hermes, Pi or Cline.

### 1. Install Autumn

```bash
npm install
```

### 2. Run it

```bash
npm run dev
```

The renderer and the desktop shell come up together. The agents are the CLIs you already have — Autumn drives the real binaries.

### 3. Start a team

Open the canvas, add an agent, and give it something to do. Or let the **Commander** plan the work and run the team for you:

> "Plan this feature, then have the team implement it."

**Want the whole picture?** Read the [development guide](docs/development.md) — it covers the tests, the build and the installers.

---

## The tools you already use

You do not need to switch coding agents or change your setup.

Autumn drives the agent CLIs that are already installed on your machine — Claude Code, Codex, OpenCode, Gemini, Cursor, Grok, Hermes, Pi and Cline — and it talks to them over one bus.

Your existing conversations are not shared automatically. Agents exchange messages, files and tasks through the canvas you connect them to.

## Run it wherever you want

**On your laptop — free.**

One app for Windows, macOS and Linux. Everything lives in `~/.autumn`, and deleting that folder resets the app.

**Bring your own tools — free.**

Your agents, your accounts, your models. Autumn is the canvas and the bus, not the intelligence.

**Self-hosted — free.**

Autumn is local-first by design: the state is a local database, the sidecars are downloaded and checksum-verified on demand, and the on-device speech model runs entirely offline.

Nothing is uploaded anywhere. See [data and privacy](docs/architecture/data-and-privacy.md).

---

## Want to build with Autumn?

Everything you need is open source.

| What you want to do | Where to start |
|---|---|
| Understand the architecture | [Architecture](docs/architecture/README.md) |
| Add a backend namespace | [The backend](docs/architecture/backend.md) |
| Work with the renderer | [The IPC facade](docs/architecture/ipc-facade.md) |
| Build a Remotion video | [Remotion and the video pipeline](docs/architecture/backend.md) |
| Build the installers | [Packaging](docs/architecture/packaging.md) |
| Run, test and release | [Development](docs/development.md) |
| Check the brand rules | [Branding](docs/branding.md) |
| Contribute | [The repository map](docs/README.md) |
| Report an issue | [Open an issue](https://github.com/adiisinghh/autumn/issues) |

## License

Autumn's code and documentation are licensed under [MIT](LICENSE).

Brand names and artwork aren't licensed for reuse in modified distributions.

---

**Your agents are already smart. Now let them work together.**

Built by [Autumn](https://github.com/adiisinghh) · [Autumn](https://github.com/adiisinghh/autumn)
