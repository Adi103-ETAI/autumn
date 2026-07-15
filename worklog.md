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

---
Task ID: 2-polish-and-features
Agent: cron-webDevReview (round 2)
Task: QA testing via agent-browser, fix bugs, add new features (canvas persistence, agent settings, canvas toolbar, command history), and improve styling.

Work Log:
- **QA testing**: Opened the app in agent-browser (1440x900 viewport), tested all dock buttons (add agent/terminal/screen/note/analytics/browser/remotion), tested all 3 right-panel tabs (Commander/Tasks/Bus), tested chat node dropdown, tested the full E2E Commander flow. Console is clean, all API routes return 200. No runtime errors.
- **Bug found**: New chat nodes created via the dock or `add_chat` action showed "default" as the model name instead of a real model. Root cause: `defaultDataForKind` and `executeStep` for `add_chat`/`add_agents` didn't set the `model` field.
- **Bug fix**: Created `src/lib/autumn/harness-meta.ts` with `HARNESS_META` mapping each harness to its label, default model, available models, and color. Updated `store.ts` `defaultDataForKind`, `add_chat`, and `add_agents` to use `defaultModelFor(harness)`. New agents now show e.g. "claude-sonnet-4" or "gpt-5-codex". Also added `effort: "medium"` and `permission: "ask"` defaults.
- **New feature: Canvas persistence** (Prisma DB):
  - Created `src/app/api/canvas/route.ts` — GET (list single by id, or list all), POST (upsert save), DELETE. Uses `db.canvas` from Prisma.
  - Added `saveCanvas()`, `loadCanvas(id)` async store actions that call the API. Added `isSaving`, `lastSavedAt`, `saveError` state. Added `clearCanvas()` and `arrangeNodes()` actions.
  - TopBar "Save" button now actually saves (with toast feedback via sonner). Shows a spinner while saving and a "saved" indicator when done.
  - Created `CanvasSwitcher.tsx` dialog — lists all saved canvases from DB with "updated X ago" timestamps, load/delete buttons, "current" badge, and "New canvas" button. Triggered from TopBar "Canvases" button + dropdown menu.
  - Added `showCanvasSwitcher` + `setShowCanvasSwitcher` to store. Rendered at page level.
- **New feature: Agent Settings dialog** (`AgentSettingsDialog.tsx`):
  - Edit a chat node's display name, harness, model, effort (low/medium/high), and permission (ask/auto/yolo).
  - Harness dropdown shows all 9 harnesses with color dots. Model dropdown updates dynamically based on selected harness (uses `HARNESS_META[harness].models`).
  - Permission descriptions shown inline ("Confirms each tool use" / "Auto-approves safe file edits" / "No confirmation").
  - Persona preview card at top with glyph + specialty.
  - Triggered from chat node dropdown "Settings…" menu item. Added `settingsNodeId` + `setSettingsNode` to store. Rendered at page level.
  - Wired the `set_chat_option` DO_ACTION in the store's `executeStep` — it patches model/effort/permission/harness on the node.
- **New feature: Floating canvas toolbar** (`CanvasToolbar.tsx`):
  - Bottom-center overlay inside the react-flow canvas (rendered inside `<ReactFlow>` so it has access to `useReactFlow` context).
  - Quick-add buttons: agent (fuchsia), screen (sky), note (amber).
  - Canvas actions: arrange nodes (emerald, calls `arrangeNodes()`), fit view (violet, calls `fitView()`).
  - Danger zone: clear canvas (rose, with confirm dialog).
  - Live stats: node count + edge count with colored dots.
  - All buttons have tooltips.
- **New feature: Command history quick-chips** (in CommanderPanel):
  - Added `commandHistory` + `pushCommandHistory` to store (keeps last 8 unique commands).
  - When the input is empty, shows up to 4 recent commands as clickable chips above the textarea. Clicking a chip prefills the input.
  - Commands are pushed to history when sent.
- **Styling polish** (globals.css):
  - Added `.glass-panel` helper class for glassmorphism (backdrop-blur + semi-transparent bg + subtle border).
  - Added `.shimmer` loading animation.
  - Added `.fade-in-up` animation (for new messages/nodes).
  - Added `.slide-in-right` animation (for panels).
  - Added `.pulse-ring` animation (for live indicators).
  - Added `.gradient-text-amber` helper (gradient clip text).
  - Refined react-flow controls button styling (border + svg fill).
  - Refined minimap with rounded corners + overflow hidden.
  - Chat nodes now have a gradient top accent bar using the persona color.
- **TopBar enhancements**: Added "Canvases" button, working "Save" button with spinner + status, arrange/clear in dropdown menu, toast notifications for save/share.
- **Bug fix**: Initial CanvasToolbar was rendered outside `ReactFlowProvider` causing a client-side crash. Moved it inside the `<ReactFlow>` component in CanvasView.

Stage Summary:
- **All QA passes.** Console is clean (no errors/warnings), all API routes return 200, lint passes.
- **Bug fixed**: New chat nodes now show real model names (claude-sonnet-4, gpt-5-codex, etc.) instead of "default".
- **4 new features added**:
  1. Canvas persistence — Save/Load/Delete canvases to Prisma SQLite DB via `/api/canvas` REST API + Canvas Switcher dialog.
  2. Agent Settings dialog — edit name/harness/model/effort/permission per chat node, with dynamic model lists per harness.
  3. Floating canvas toolbar — quick-add, arrange, fit view, clear canvas, live stats.
  4. Command history quick-chips — recent commands as clickable chips in the Commander panel.
- **E2E verified**: "spawn Juno and connect her to Atlas, then tell Juno to write tests" → Juno spawned (with model "claude-sonnet-4"), connected to Atlas, tasked, ran to completion, sent `message_peer → Atlas` handoff ("Test suite implemented with Jest, React Testing Library"). Atlas's status updated with the handoff. Command history chip appeared.
- **Styling improved**: glassmorphism helpers, fade-in/slide-in animations, gradient text, refined react-flow controls/minimap, persona-colored top accent on chat nodes.

Unresolved issues / risks:
- Canvas state is stored as a JSON string in the `Canvas.state` column — works for SQLite but large canvases could hit row size limits in production. Consider separate nodes/edges tables for a production deployment.
- The bus state (`/api/bus`) is in-memory per process — a server restart clears inboxes. For production, persist bus state to DB or use Yjs.
- Voice input (Web Speech API) only works in Chrome/Edge; other browsers show an alert. Could add a fallback.
- The `arrangeNodes()` layout is a simple grid; could be upgraded to a dagre-based auto-layout for complex graphs.

Priority recommendations for next round:
- Add dagre-based auto-layout for the "Arrange nodes" action.
- Add a "duplicate canvas" feature in the Canvas Switcher.
- Add keyboard shortcuts (⌘K for command palette, ⌘S for save, Delete for selected node).
- Add a minimap toggle + canvas zoom level indicator.
- Add export/import canvas as JSON file.

---
Task ID: 3-qa-and-features
Agent: main (cron-webDevReview round 3)
Task: QA test via agent-browser, fix bugs, add new features (command palette, keyboard shortcuts, export/import, activity timeline, connect mode, sticky editing, dagre-style auto-layout), and polish styling.

Work Log:
- **QA testing (agent-browser, 1440x900)**: Opened the app, verified all 3 right-panel tabs (Commander/Tasks/Bus), tested all 7 dock buttons (Agent/Terminal/Screen/Note/Analytics/Browser/Remotion), tested chat node dropdown menus, tested the full E2E Commander flow ("spawn Juno and connect her to Atlas, then tell Juno to write tests..."), tested the Save button + Canvas Switcher. Console is clean throughout, all API routes return 200.
- **E2E verified**: Commander LLM produces correct DO_ACTIONS plan (add_chat + connect_nodes + send_to_node), plan executes (Juno spawned, connected to Atlas, tasked), agent-runner streams the response, routeBusHandoffs parses the `[autumn-bus] message_peer → Atlas:` line and POSTs to /api/bus?op=message_peer, pulse animates on the edge, peer message is appended to Atlas's chat. The Atlas card preview correctly shows the peer message text.
- **Bug found & fixed**: When a chat node was selected (showAgentChat=true), the AgentChatPanel replaced the CommanderPanel entirely, hiding the tab switcher. The user couldn't switch to Tasks/Bus without first deselecting the node. **Fix**: Extracted the tab switcher into a shared `RightPanelTabs` component, removed the internal tab switcher from CommanderPanel/TaskBoard/BusTrafficPanel, and rendered `RightPanelTabs` at the top of the aside in page.tsx so it's always visible.
- **New feature: ⌘K Command Palette** (`CommandPalette.tsx` + cmdk):
  - Triggered by ⌘K / Ctrl+K, or via the dropdown menu / status bar.
  - Groups: "Add node" (7 quick-adds), "Canvas" (save, switcher, export, arrange, fit, reset, clear), "Navigate" (3 panel tabs + help), "Selected agent" (run, connect-to, settings — context-sensitive), "Agents" (per-agent run), "Commander examples" (4 natural-language commands that auto-execute via pendingCommand).
  - Each item shows a keyboard shortcut hint kbd badge when applicable.
  - Tips footer with 3 usage hints.
- **New feature: Global keyboard shortcuts** (`use-keyboard-shortcuts.ts`):
  - ⌘K → command palette
  - ⌘S → save canvas (with sonner toast)
  - ⌘/ → toggle help dialog
  - ⌘1 / ⌘2 / ⌘3 → switch right panel tab (commander / tasks / bus)
  - Delete / Backspace → remove selected node (only when not in an input)
  - Escape → layered close (palette → dialogs → connect mode → deselect)
  - C → enter connect mode (when a chat node is selected)
  - R → run selected agent
  - A → arrange nodes
- **New feature: Export/Import canvas as JSON** (`ExportImportDialog.tsx`):
  - Two-tab dialog (Export / Import) triggered from TopBar "Export" button or dropdown menu.
  - Export: Generate JSON preview (with version, exportedAt, app, canvas fields), download as `<name>.autumn.json`, or copy to clipboard.
  - Import: Choose file (via hidden input) or paste JSON, then "Import into workshop" loads it.
  - Stats badges (nodes/edges/format) shown on export tab.
- **New feature: Activity timeline** (`ActivityTimeline.tsx`):
  - Slide-out right Sheet panel triggered from TopBar "Activity" button, status bar version click, or dropdown menu.
  - Shows a reverse-chronological list of all events: commander_plan, agent_status, agent_message, bus_message_peer, task_claim, task_complete, task_add, node_added, node_removed, edge_added, edge_removed, canvas_saved, canvas_loaded, canvas_cleared.
  - Each entry has an icon, color, label, timestamp (HH:MM:SS), relative time ("1 minute ago"), and optional persona avatar.
  - Date separators between days.
  - Click an entry with a nodeId to jump to that node.
  - "Clear timeline" button + event count badge.
  - Activity entries are pushed from store actions (addNode, connectNodes, addTask, applyCommanderPlan, saveCanvas, loadCanvas, clearCanvas, arrangeNodes, removeNode) and from agent-runner (agent_status when starting, agent_message when finishing, bus_message_peer on handoff).
- **New feature: Connection mode** (press C or "Connect to…" in chat node dropdown):
  - Sets `connectMode: { from: nodeId }` in the store.
  - Banner at top of canvas: "Click another agent to wire {name} → them" with a cancel link.
  - Source node gets an amber pulsing ring; other chat nodes get an emerald ring + crosshair cursor.
  - Clicking another chat node while in connect mode calls `connectNodes` and exits connect mode.
  - Implemented via onNodesChange intercept in CanvasView.
- **New feature: Duplicate canvas** in Canvas Switcher:
  - New Copy button (sky-blue) on each saved canvas row.
  - Calls `duplicateCanvas(id)` which fetches the canvas, POSTs a copy with a new ID and "(copy)" suffix name, then refreshes the list.
- **New feature: Sticky note inline editing**:
  - Double-click a sticky note's text to enter edit mode (textarea with white-on-color background).
  - Enter to commit, Escape to cancel, blur to commit.
  - Each sticky has a stable rotation per node id (deterministic based on char codes) instead of a fixed -1deg.
  - Hover now slightly scales up (1.02) and rotates to 0deg.
- **Improved: Tiered auto-layout** (`arrangeNodes`):
  - Replaced the simple grid layout with a BFS-based tiered layout.
  - Chat nodes are placed in tiers based on bus-edge adjacency (roots with no incoming at tier 0, their peers at tier 1, etc.).
  - Non-chat nodes are grouped by kind in columns below all chat tiers.
  - Activity log entry added on arrange.
- **Improved: ChatNode visual polish**:
  - Peer count badge (Cable icon + count) shown when the agent has bus edges.
  - "Connect to…" item in the dropdown menu.
  - Connect-mode source highlights with amber pulsing ring; target candidates highlight with emerald ring + crosshair cursor.
- **Improved: StatusBar**:
  - Version button now opens activity timeline on click.
  - Running agent names shown as colored pills (up to 3, then "+N").
  - Persona roster dots animate (pulse + glow) when that agent is running.
  - Canvas ID shown (truncated) with a Wifi icon when saved.
  - ⌘K hint button at the right.
  - Hidden on small screens for readability.
- **Improved: Help dialog examples actually execute**:
  - Clicking an example now sets `pendingCommand` in the store, which CommanderPanel watches via useEffect and auto-sends. The full E2E flow runs (Commander LLM → plan → execution → agent run).
  - Example button hover now turns the border amber.
- **New: Command Palette example commands**:
  - 4 natural-language example commands shown in a "Commander examples" group.
  - Clicking one closes the palette, switches to Commander tab, and sets pendingCommand to auto-execute.
- **Styling polish (globals.css)**:
  - Selected node glow (drop-shadow).
  - Handle hover scale (1.4x).
  - Connection line styling (amber dashed).
  - Subtle ambient glow at canvas corners (::before pseudo-element).
  - Custom focus-visible ring (amber).
  - Sonner toast theme override (matches dark workshop palette).
  - Command palette scrollbar styling.
  - Node entrance animation (scale + translateY).
  - Tab indicator dot pulse animation.
  - Connect-mode cursor (crosshair on nodes).
  - Refined MiniMap and Controls.
- **Store additions**:
  - `showCommandPalette`, `showExportDialog`, `showActivityLog`, `pendingCommand`, `connectMode`, `activityLog` state.
  - `setShowCommandPalette`, `setShowExportDialog`, `setShowActivityLog`, `setPendingCommand`, `setConnectMode`, `pushActivity`, `clearActivity`, `duplicateCanvas`, `exportCanvas`, `importCanvas` actions.
  - `ActivityEntry` interface with 13 kind variants.
  - Activity log capped at 200 entries (newest kept).

Stage Summary:
- **All QA passes.** Console is clean (no errors), lint passes, all API routes return 200, dev server compiles cleanly.
- **1 bug fixed**: Tab switcher is now always visible (extracted to `RightPanelTabs`).
- **7 new features added**:
  1. ⌘K Command Palette with 25+ actions, example commands, and context-sensitive items.
  2. Global keyboard shortcuts (⌘K, ⌘S, ⌘/, ⌘1/2/3, Delete, Escape, C, R, A).
  3. Export/Import canvas as portable JSON.
  4. Activity timeline slide-out with 13 event types, date separators, persona avatars.
  5. Connection mode (press C) with banner + visual highlights.
  6. Duplicate canvas in Canvas Switcher.
  7. Sticky note inline editing (double-click).
- **3 improvements**:
  1. Tiered BFS auto-layout (roots → peers → non-chat).
  2. ChatNode peer count badge + connect-mode highlights.
  3. StatusBar polish (running agent names, animated persona roster, canvas id).
- **Styling polish**: 12 new CSS rules (node glow, handle hover, ambient canvas glow, focus ring, sonner theme, node entrance animation, tab pulse, etc.).
- **E2E verified twice**: (a) "spawn Juno and connect her to Atlas, then tell Juno to write tests..." → Juno spawned, connected, ran, sent `message_peer → Atlas`. (b) Help dialog "Drop a sticky note saying ship it Friday" example → pendingCommand set → Commander LLM parsed → add_note plan → sticky note created.
- **Keyboard shortcuts verified**: ⌘K opens palette, ⌘S saves with toast, ⌘1/2/3 switches tabs, Escape closes dialogs, C enters connect mode.
- **Tech stack unchanged**: Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + @xyflow/react + Zustand + z-ai-web-dev-sdk + Prisma/SQLite + cmdk + react-markdown + Web Speech API + sonner.

Unresolved issues / risks:
- The bus state (`/api/bus`) is in-memory per process — a server restart clears inboxes. For production, persist bus state to DB or use Yjs.
- Voice input (Web Speech API) only works in Chrome/Edge; other browsers show an alert. Could add a fallback.
- The LLM doesn't always emit the `[autumn-bus] message_peer → <peer>:` handoff line — it's LLM variance. Could strengthen the prompt to make it more reliable, or auto-generate a handoff when an agent finishes if it has connected peers.
- Canvas state is stored as a JSON string in the `Canvas.state` column — works for SQLite but large canvases could hit row size limits in production.
- The activity log is in-memory (capped at 200 entries, cleared on page reload). Could persist to DB for a true audit trail.

Priority recommendations for next round:
- Persist activity log to Prisma (AgentLog model already exists in schema).
- Auto-emit a synthetic message_peer handoff when an agent finishes if it has connected peers but didn't include one in its response.
- Add a "duplicate node" action (Shift+D on selected).
- Add multi-select (Shift+click) for bulk node operations.
- Add a canvas zoom level indicator in the CanvasToolbar.
- Add a "recently used personas" sort in the persona roster.
- Add a voice fallback for non-Chrome browsers (whisper.cpp via WebAudio).
- Add a "share canvas" feature that exports to a URL-encoded string.
