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

---
Task ID: 1-build
Agent: main
Task: Build the Autumn web app — a Next.js 16 spatial canvas workshop for orchestrating AI coding agents. Open-source clone of October Desktop.

Work Log:
- Installed `@xyflow/react` (react-flow v12) and `nanoid` for ID generation.
- Rewrote `prisma/schema.prisma` with Autumn domain models: Canvas, Node, Edge, Task, Message, AgentLog. Ran `bun run db:push` — schema synced to SQLite.
- Rewrote `src/app/globals.css` with the Autumn dark workshop theme: warm charcoal base (oklch(0.135 0.006 55)), amber/orange primary, custom scrollbar, bus-pulse animation, agent-glow animation, typing dots, voice waveform. Added `.autumn-canvas` class for react-flow theme overrides.
- Rewrote `src/app/layout.tsx`: dark theme by default (`className="dark"`), Autumn branding, Sonner toaster added.
- Built the core library in `src/lib/autumn/`:
  - `types.ts` — full domain types: NodeKind (7 types), EdgeKind (2 types), AgentHarness, AgentStatus, ChatNodeData, TerminalNodeData, ScreenNodeData, StickyNodeData, AnalyticsNodeData, YoutubeNodeData, RemotionNodeData, AutumnNode, AutumnEdge, AutumnTask, CommanderResult, CanvasSnapshot.
  - `personas.ts` — 7 named personas (Atlas=emerald/claude-code, Apollo=rose/claude-code, Orion=violet/codex, Juno=amber/claude-code, Vega=cyan/gemini, Lyra=pink/cursor, Nero=indigo/grok). Includes STT-robustness aliases ("appollo"→Apollo, "cloud code"→claude-code) and `nextPersona()` rotation.
  - `commander-prompt.ts` — the recovered Commander system prompt (verbatim from 14-renderer-canvas.md §2), with all 30 DO_ACTIONS, the delegation model, @N continuity refs, STT robustness rules, and compact JSON output format. Includes `buildCompilerUserPrompt()` that serializes the canvas snapshot.
  - `do-actions.ts` — the 30-action catalog with descriptions.
  - `seed.ts` — seed canvas with Atlas, Apollo, Orion chat nodes + a screen + a sticky note + bus/nav edges + 3 sample tasks.
  - `store.ts` — Zustand store (~400 lines) with all canvas ops: addNode, updateNode, removeNode, connectNodes, disconnectNodes, addTask, claimTask, completeTask, pushPulse, appendAgentMessage, updateAgentMessage, setAgentStatus, applyCommanderPlan (executes DO_ACTIONS steps with @N ref resolution), resolveNodeRef (handles nodeId, personaName, @N).
  - `agent-runner.ts` — client-side driver that: fetches peer context from /api/bus?op=pre-prompt, builds connected peer list, calls /api/agent/run with persona+harness+task+peerContext+connectedPeers+history, streams the response into the agent's messages, parses `[autumn-bus] message_peer → <peer>:` lines and routes them via /api/bus + pushes visual pulses on edges + appends peer messages to the target agent's chat.
- Built API routes:
  - `POST /api/commander` — calls z-ai-web-dev-sdk LLM with the Commander system prompt + canvas snapshot, parses JSON → CommanderResult ({kind:"steps",...} | {kind:"ask",...}). Has a fallback pattern-matching planner if the LLM fails or returns non-JSON.
  - `POST /api/agent/run` — calls z-ai LLM with a persona-flavored system prompt (each harness has its own tool-use idiom: Claude Code→TodoWrite/Read/Edit, Codex→apply_patch, Gemini→read_file/write_file, etc.). Includes the connected peer names so the LLM uses actual peer names in message_peer handoffs. Has a fallback synthesizer if the LLM fails.
  - `GET/POST /api/bus` — AutumnBus HTTP adapter: POST ops (session, stop, notify, message_peer, task) + GET ops (pre-prompt drains inbox, list_peers, get_node_status). In-memory per-process bus state.
- Built UI components:
  - `TopBar.tsx` — Autumn logo, editable canvas name, live stats badges (bus live, nodes, edges, tasks), Help/Share/Save buttons, dropdown menu with reset.
  - `Dock.tsx` — left tool rail with 7 quick-add buttons (Agent, Terminal, Screen, Note, Analytics, Browser, Remotion) with colored icons + tooltips.
  - `CanvasView.tsx` — react-flow canvas with 7 custom node types + 2 custom edge types, dot background, controls, minimap with per-kind colors, onConnect/onPaneClick handlers.
  - `nodes/ChatNode.tsx` — the complex agent node: persona avatar with color, harness+model, status dot (idle/thinking/working/waiting/done/error), doing preview, message count, typing indicator, Open chat + Run buttons, dropdown menu.
  - `nodes/OtherNodes.tsx` — TerminalNode (with terminal lines + port), ScreenNode (desktop/phone preview), StickyNode (colored sticky note with rotation), AnalyticsNode (metrics grid), BrowserNode (URL bar + content area), RemotionNode (video editor with crew badges).
  - `edges/Edges.tsx` — BusEdge (animated dashed line with flowing pulse circles carrying message_peer text) + NavigationEdge (solid thin dashed line for screen nav).
  - `CommanderPanel.tsx` — the universal chat: sends commands to /api/commander, displays the plan with step-by-step action breakdown, voice input via Web Speech API (Chrome/Edge), TTS via SpeechSynthesis, option buttons for "ask" results.
  - `AgentChatPanel.tsx` — shows the selected agent's message history with markdown rendering, persona tagline, status indicator, task input. Opens when a chat node is selected.
  - `TaskBoard.tsx` — shared Octoplan-style task board with stats (done/active/blocked), dependency edges (after tN), claim & run button, complete button, add task form.
  - `BusTrafficPanel.tsx` — live AutumnBus traffic viewer: bus edges list, live message_peer pulses with from→to persona avatars + text, clear button.
  - `StatusBar.tsx` — sticky footer: version, agent count, running count, bus edges, tasks, live bus msg count, persona roster with online/offline state, recent action.
  - `HelpDialog.tsx` — onboarding dialog shown on first visit: explains the spatial workshop metaphor, 4 example commands, feature cards.

Stage Summary:
- **Autumn is fully functional and verified end-to-end via agent-browser.**
- The full golden path works: user types a natural-language command → Commander LLM parses it into a DO_ACTIONS plan → plan execution spawns named agents, connects them with bus edges, sends verbatim tasks → agent runner calls /api/agent/run with persona+harness+task+peer list → LLM generates a persona-flavored response with tool-use transcript → response streams into the agent's chat → `[autumn-bus] message_peer → <peer>:` handoff lines are parsed and routed to the connected peer via the bus → visual pulses animate along the edge → peer receives the message.
- Verified scenario: "spawn Juno and connect her to Atlas, then tell Juno to write tests for the medical app" → Juno spawned, connected to Atlas, tasked, ran, produced a full Claude-Code-style response with TodoWrite/Read/Write tool calls, and sent `message_peer → Atlas: Medical app tests created covering unit, integration, and e2e scenarios` — Atlas's "doing" field updated with the handoff.
- Console is clean (no errors). Lint passes. Dev server runs on port 3000.
- **Tech stack used:** Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + @xyflow/react (react-flow v12) + Zustand + z-ai-web-dev-sdk (LLM) + Prisma/SQLite + react-markdown + Web Speech API (voice).
- **Architecture mirrors October Desktop:** 7 node types (chat/terminal/screen/sticky/analytics/youtube/remotion), 2 edge types (bus/navigation), Commander with 30 DO_ACTIONS, AutumnBus with /mcp + /hook/* contract (adapted to /api/bus), message_peer coordination, shared task board with dependency edges, named agent personas with STT-robustness aliases.
