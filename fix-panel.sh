#!/bin/bash
set -e
cd /home/z/my-project

# Ensure we're on autumn-o5
git checkout autumn-o5 2>/dev/null || true
git reset --hard origin/autumn-o5 2>/dev/null || true

# Fix the AgentPickerPanel positioning: change absolute to fixed, add max-h + scroll
python3 << 'PYEOF'
with open("src/components/autumn/AgentPickerPanel.tsx", "r") as f:
    content = f.read()

# Fix positioning: absolute -> fixed, add max-h + overflow-y-auto
old = 'className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 w-[520px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#1c1f26]/95 backdrop-blur-2xl shadow-2xl shadow-black/50 overflow-hidden"'
new = 'className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[520px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-100px)] overflow-y-auto autumn-scroll rounded-2xl border border-white/10 bg-[#1c1f26]/95 backdrop-blur-2xl shadow-2xl shadow-black/50"'

if old in content:
    content = content.replace(old, new)
    with open("src/components/autumn/AgentPickerPanel.tsx", "w") as f:
        f.write(content)
    print("AgentPickerPanel positioning fixed (absolute -> fixed, +max-h +scroll)")
else:
    print("WARNING: old positioning string not found, trying alternate")
    # Try a more flexible replacement
    content = content.replace(
        "absolute bottom-16 left-1/2 -translate-x-1/2 z-30",
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-50",
    )
    content = content.replace(
        "overflow-hidden\"",
        "overflow-y-auto autumn-scroll\"",
    )
    with open("src/components/autumn/AgentPickerPanel.tsx", "w") as f:
        f.write(content)
    print("AgentPickerPanel positioning fixed (alternate method)")
PYEOF

# Also clean up temp files
rm -f build-agent-picker.sh new-CanvasToolbar.tsx

# Lint
echo "=== LINT ==="
bun run lint 2>&1 | tail -5

# Commit + Push
echo "=== COMMIT ==="
git add -A
git commit -m "fix(agent-picker): use fixed positioning + max-h to prevent panel clipping

- Change panel from absolute to fixed positioning (relative to viewport)
- Add max-h-[calc(100vh-100px)] + overflow-y-auto for scroll on small viewports
- Increase z-index to z-50 to ensure panel is above other elements
- Move panel up slightly (bottom-20 instead of bottom-16)
- Remove temp build files" 2>&1 | tail -4

echo "=== PUSH ==="
git push origin autumn-o5 2>&1 | tail -3

echo "=== DONE ==="
git log --oneline -3
