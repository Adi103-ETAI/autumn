# Task 5-b — Agent: main

## Task: Add new features and functionality to the Autumn project

### Summary of Changes

All 5 new features were implemented successfully. Lint passes with no errors. The dev server is running and the app is accessible at localhost:3000.

---

### 1. Welcome Splash Screen (`src/components/autumn/WelcomeSplash.tsx`)
- **New file**: Full-screen modal overlay using Framer Motion AnimatePresence
- Shows on first visit (checks `localStorage "autumn-welcome-seen"`)
- Beautiful gradient background with Autumn leaf logo centered
- "Welcome to Autumn" title with gradient text (amber→orange)
- 3 feature cards: "Spatial Canvas" (emerald), "AI Commander" (amber), "Agent Bus" (violet)
- Each card has Lucide icon, title, one-line description
- "Get Started" button dismisses the splash and sets localStorage key
- Staggered fade-in-up animations (0.1s, 0.2s, 0.3s, then 0.4/0.52/0.64s for cards, 0.8s for button)
- Wired into `page.tsx`

### 2. Canvas Workspace Presets
- **Updated `src/lib/autumn/types.ts`**: Added `CanvasPreset` interface
- **Updated `src/lib/autumn/store.ts`**: Added `createCanvasFromPreset(presetName)` action
  - "Empty Canvas": clears canvas, creates blank workspace
  - "Pair Programming": creates 2 chat agents (Atlas + Orion) + connects them via bus
  - "Full Team": creates 4 chat agents (Atlas, Apollo, Orion, Juno) + screen + sticky + bus connections + auto-arrange
- **Updated `src/components/autumn/CanvasSwitcher.tsx`**: 
  - Horizontal card row at the top showing 3 presets
  - Each preset card shows: icon, name, description, node count badge
  - Clicking a preset calls `createCanvasFromPreset()` and closes the dialog

### 3. Agent Run Duration Tracking
- **Updated `src/lib/autumn/types.ts`**: Added `AgentRunDuration` interface (`{ start: number; end?: number }`)
- **Updated `src/lib/autumn/store.ts`**: 
  - Added `agentRunDurations: Record<string, AgentRunDuration[]>` state
  - Added `recordRunStart(nodeId)` action
  - Added `recordRunEnd(nodeId)` action  
  - Added `getAgentRunDurations(nodeId)` selector
  - Added `getAvgRunDuration(nodeId)` selector (returns avg ms, null if no completed runs)
- **Updated `src/lib/autumn/agent-runner.ts`**:
  - Calls `store.recordRunStart(nodeId)` when agent starts running
  - Calls `store.recordRunEnd(nodeId)` when agent finishes
- **Updated `src/components/autumn/AgentChatPanel.tsx`**:
  - Reads `agentRunDurations` from store
  - Computes `avgRunMs` from completed durations
  - Added new "Avg run" stat chip in the 5-column stats grid (was 4-column)
  - Added `formatAvgDuration()` helper
- **Updated `src/components/autumn/AgentHistoryPanel.tsx`**:
  - Reads `agentRunDurations` from store
  - Shows "Avg Xs" badge next to the runs count badge (amber-colored, with Timer icon)

### 4. Toast Notifications
- **Updated `src/lib/autumn/store.ts`** (imported `toast` from sonner):
  - `addNode`: toast.success "Agent {name} deployed to the canvas" (when kind is "chat")
  - `connectNodes`: toast "Bus edge: {from} → {to}" (when kind is "bus")
  - `saveCanvas`: toast "Canvas auto-saved" (duration 2000ms, subtle)
- **Updated `src/lib/autumn/agent-runner.ts`** (imported `toast` from sonner):
  - `runAgentForNode`: toast.loading "{name} is working…" (with id for dedup)
  - `runAgentForNode`: toast.success "{name} finished in {duration}s" (replaces loading toast)
  - `deliverPeerMessage`: toast.info "Message from {from} → {to}"
  - `autoEmitSyntheticHandoff`: toast.info "Message from {from} → {to}"

### 5. Empty Workspace State
- **Updated `src/components/autumn/CanvasView.tsx`**:
  - Replaced the old simple empty state with an enhanced version
  - Uses Framer Motion AnimatePresence for smooth fade in/out
  - Animated gradient border using existing `breathing-border` CSS animation
  - Large Autumn leaf icon (size-16) centered
  - "Your canvas is empty" heading
  - "Start by adding an agent or typing a command to the Commander" subheading
  - Two buttons: "Add Agent" (calls addNode with chat kind) and "Open Commander" (switches to commander tab)
  - Overlay disappears as soon as any node is added (via AnimatePresence exit animation)

---

### Files Modified
1. `src/lib/autumn/types.ts` — Added CanvasPreset and AgentRunDuration types
2. `src/lib/autumn/store.ts` — Added agentRunDurations state, duration tracking actions, createCanvasFromPreset, toast notifications
3. `src/lib/autumn/agent-runner.ts` — Added duration tracking calls, toast notifications for agent runs and bus messages
4. `src/components/autumn/WelcomeSplash.tsx` — New file (welcome splash screen)
5. `src/components/autumn/CanvasSwitcher.tsx` — Added preset cards UI
6. `src/components/autumn/AgentChatPanel.tsx` — Added avg run stat, Timer icon, formatAvgDuration helper
7. `src/components/autumn/AgentHistoryPanel.tsx` — Added avg duration badge, Timer icon
8. `src/components/autumn/CanvasView.tsx` — Enhanced empty state with gradient border, Framer Motion, Leaf/Terminal icons
9. `src/app/page.tsx` — Wired WelcomeSplash component

### Lint Status
✅ `bun run lint` passes with zero errors/warnings.
