#!/bin/bash
set -e
cd /home/z/my-project

# Ensure we're on autumn-o5 (create from origin/autumn-o4 if needed)
git checkout autumn-o5 2>/dev/null || git checkout -b autumn-o5 origin/autumn-o4

# ── 1. Copy new CanvasToolbar.tsx ─────────────────────────────────────────
cp /home/z/my-project/new-CanvasToolbar.tsx src/components/autumn/CanvasToolbar.tsx
echo "CanvasToolbar.tsx copied"

# ── 2. Patch store.ts: add agentPickerOpen state ──────────────────────────
python3 << 'PYEOF'
with open("src/lib/autumn/store.ts", "r") as f:
    content = f.read()

if "agentPickerOpen" in content:
    print("store.ts already patched")
else:
    content = content.replace(
        "  appsModalOpen: boolean;\n  connectedApps: string[];",
        "  appsModalOpen: boolean;\n  connectedApps: string[];\n  // Agent picker panel (popover above the bottom dock — agent + app grid)\n  agentPickerOpen: boolean;",
    )
    content = content.replace(
        "  setAppsModalOpen: (v: boolean) => void;",
        "  setAppsModalOpen: (v: boolean) => void;\n  setAgentPickerOpen: (v: boolean) => void;\n  toggleAgentPicker: () => void;",
    )
    content = content.replace(
        "  appsModalOpen: false,\n  connectedApps: [],",
        "  appsModalOpen: false,\n  connectedApps: [],\n  agentPickerOpen: false,",
    )
    content = content.replace(
        "  setAppsModalOpen: (v) => set({ appsModalOpen: v }),",
        "  setAppsModalOpen: (v) => set({ appsModalOpen: v }),\n  setAgentPickerOpen: (v) => set({ agentPickerOpen: v }),\n  toggleAgentPicker: () => set((s) => ({ agentPickerOpen: !s.agentPickerOpen })),",
    )
    with open("src/lib/autumn/store.ts", "w") as f:
        f.write(content)
    print("store.ts patched successfully")
PYEOF

# ── 3. Patch globals.css: add dock-app-tile CSS ───────────────────────────
python3 << 'PYEOF'
with open("src/app/globals.css", "r") as f:
    css = f.read()

if "dock-app-tile" in css:
    print("globals.css already has dock-app-tile")
else:
    tile_css = """
/* dock-app-tile — colorful app-icon tiles (macOS/October dock style). */
.dock-app-tile {
  position: relative;
  isolation: isolate;
}
.dock-app-tile::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 0.9rem;
  background: var(--tile-glow, transparent);
  filter: blur(8px);
  opacity: 0;
  z-index: -1;
  transition: opacity 0.2s ease;
}
.dock-app-tile:hover::after {
  opacity: 0.7;
}
@keyframes dock-tile-flash {
  0% { transform: scale(1); filter: brightness(1.6); }
  50% { transform: scale(0.92); filter: brightness(1.3); }
  100% { transform: scale(1); filter: brightness(1); }
}
.dock-tile-active {
  animation: dock-tile-flash 0.6s ease-out;
}
"""
    css += tile_css
    with open("src/app/globals.css", "w") as f:
        f.write(css)
    print("globals.css patched successfully")
PYEOF

# ── 4. Verify ─────────────────────────────────────────────────────────────
echo "=== Verification ==="
echo "agentPickerOpen in store: $(grep -c agentPickerOpen src/lib/autumn/store.ts)"
echo "dock-app-tile in css: $(grep -c dock-app-tile src/app/globals.css)"
echo "AppTile in toolbar: $(grep -c AppTile src/components/autumn/CanvasToolbar.tsx)"
echo "AgentPickerPanel exists: $(test -f src/components/autumn/AgentPickerPanel.tsx && echo YES || echo NO)"

# ── 5. Lint ───────────────────────────────────────────────────────────────
echo "=== LINT ==="
bun run lint 2>&1 | tail -5

# ── 6. Commit + Push ──────────────────────────────────────────────────────
echo "=== COMMIT ==="
git add -A
git commit -m "feat(agent-picker): popover panel with agent + app grid above bottom dock

- New AgentPickerPanel component: opens above the dock when Agent tile clicked
  - CODING AGENTS section: 4-col grid of 9 agents with brand logos (Claude Code,
    Codex, Cursor, Grok, opencode, Hermes, Cline, Pi, Gemini)
  - APPS section: 4-col grid of 6 integration platforms (Shopify, Lovable, Figma,
    Shortcut, Post Bridge, Canvas) with colored gradient tiles + EARLY ACCESS badges
  - Bottom bar: Agents (manage) | Set up voice
  - Clicking an agent spawns a chat node with that agent's harness
  - Clicking an app opens the Apps Integration modal
- Add agentPickerOpen/setAgentPickerOpen/toggleAgentPicker to Zustand store
- Re-apply colorful AppTile design on bottom dock (agent/terminal/browser/screen/note/video)
- Agent AppTile toggles AgentPickerPanel instead of QuickSpawnMenu
- Add dock-app-tile CSS (colored glow on hover, active flash animation)
- Branch: autumn-o5 (based on autumn-o4)" 2>&1 | tail -5

echo "=== PUSH ==="
git push origin autumn-o5 2>&1 | tail -5

echo "=== DONE ==="
git log --oneline -3
