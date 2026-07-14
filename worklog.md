# Autumn Project — Worklog / Handover

This worklog tracks work on the **Autumn** project (open-source clone of "October Desktop" by Wega Labs).
The reverse-engineering notes and build specification live in `/home/z/my-project/autumn-repo/`.

---
Task ID: 0-context
Agent: main
Task: Clone `https://github.com/Adi103-ETAI/autumn.git`, read all files, prepare for the build.

Work Log:
- Cloned the repo to `/home/z/my-project/autumn-repo/`.
- Read every markdown file in the repo (19 files, ~5,670 lines total):
  - `README.md` — master index
  - `prompt.md` — Autumn build spec (267 lines) — THE single build prompt
  - `01-main-auth-and-ipc.md` — main process: 226 IPC handlers, auth, settings, cloud sync
  - `02-agent-runtime.md` — agents + terminal (node-pty) + git/worktrees + bus
  - `03-voice.md` — voice pipeline (FluidAudio + sherpa-onnx + Deepgram + OpenAI Realtime)
  - `04-backends.md` — Supabase/Postgres/Convex adapters, schema, vault
  - `05-renderer.md` — React/Zustand renderer overview
  - `06-native-and-packaging.md` — native modules, electron-updater, NSIS installer
  - `07-external-services.md` — 44 endpoints + telemetry (PostHog to drop)
  - `08-agent-prompts-and-harness.md` — Commander prompt + harness/permission behavior
  - `09-renderer-deep-dive.md` — Zustand store (~260 keys), canvas ops, node components
  - `10-preload-api-surface.md` — full 253-method `window.october` bridge table
  - `11-installer-and-runtime-config.md` — NSIS 3.04 disassembly + runtime config
  - `12-node-modules-scan.md` — SDK wiring, no leaked secrets, patched-package scan
  - `13-macos-build.md` — macOS delta (FluidAudio sidecar)
  - `14-renderer-canvas.md` — canvas data model + Commander prompt + Liveblocks/Monaco wiring
  - `15-agent-interop.md` — bus MCP server, message_peer, task board, per-CLI hooks
  - `16-voice-pipeline.md` — voice pipeline summary
  - `17-server-contracts.md` — server-side contracts (auth, intent, liveblocks-auth, deepgram, themes)
  - `macOS-October-RE-plan.md` — macOS RE plan (mostly out-of-scope)
- Inventoried the `decompiled/` folder (7 pretty-printed JS chunks, 178k lines total) — these are reference only; the markdown docs already extract their key information.

Stage Summary:
- Repository fully understood. Ready to start the Autumn build.
- **Target product:** Autumn — an open-source spatial canvas app-builder (Electron + React 19 + Vite + Zustand + react-flow + Monaco + xterm + node-pty + Yjs + sherpa-onnx + Claude/Codex/ACP agents + own Supabase + AutumnBus HTTP+MCP).
- **Important architecture facts:**
  - Main process is the brain (~19.8k-line bundle in original).
  - Renderer is a thin-ish React shell over a 253-method `window.autumn` preload bridge (34 namespaces).
  - Agents = external CLI tools (Claude Code, Codex, OpenCode, Gemini, Cursor, Grok, Hermes, Pi, Campfire, Cline, Qwen, Goose, Copilot) launched as child processes with injected env; ACP-first dispatch with bespoke fallback.
  - Context bus (`AutumnBus`) = localhost HTTP server with `/mcp` (StreamableHTTP JSON-RPC) + `/hook/*` (session/stop/notify/pre-prompt/message-peer/task). Agents ride the bus via a zero-dep hook script.
  - Canvas: 7 node types (screen, chat, sticky, analytics, youtube, terminal, remotion), 2 edge types (bus, navigation).
  - "Commander" LLM prompt turns a user command into `DO_ACTIONS` plan (30 actions, verbatim recovered in `14-renderer-canvas.md`).
  - Substitution table: October Supabase → own Supabase; Liveblocks → Yjs; FluidAudio → sherpa-onnx; Deepgram → drop; PostHog → drop; `october://` → `autumn://`.
- **Sandbox constraint:** The actual development environment is the existing Next.js 16 project at `/home/z/my-project/`. Since Electron cannot run in this sandbox the way the original spec describes, the realistic deliverable here is a **Next.js web app** that demonstrates the Autumn concept — a spatial canvas + Commander + agent orchestration UI — using the open web stack we have (Next.js + Prisma + z-ai-web-dev-sdk for the LLM/intent layer). The deep RE notes remain the source of truth for behaviour and data model.
- Awaiting the user's instructions on what specifically to build first.
