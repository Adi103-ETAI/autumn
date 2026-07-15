// Autumn — Agent runner (client-side driver).
// Mirrors October's runAgent() dispatch: takes a chat node + task, calls the
// /api/agent/run endpoint, streams the response into the agent's messages,
// and routes any [autumn-bus] message_peer handoffs to /api/bus + emits pulses.

"use client";

import { useAutumnStore } from "@/lib/autumn/store";
import type { AutumnNode, ChatNodeData } from "@/lib/autumn/types";
import { PERSONA_BY_ID } from "@/lib/autumn/personas";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAgentForNode(nodeId: string, task?: string) {
  const store = useAutumnStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== "chat") return;

  const data = node.data as ChatNodeData;
  const persona = PERSONA_BY_ID[data.personaId];
  if (!persona) return;

  // Determine task: explicit arg, else last user message.
  const lastUser = [...data.messages]
    .reverse()
    .find((m) => m.role === "user");
  const finalTask = task ?? lastUser?.text;
  if (!finalTask) return;

  // Already running? skip.
  if (store.isAgentRunning[nodeId]) return;

  const startTs = Date.now();
  const taskSummary =
    finalTask.length > 60 ? `${finalTask.slice(0, 57)}…` : finalTask;

  store.setAgentRunning(nodeId, true);
  store.setAgentStatus(nodeId, "thinking", "Reading the task…");
  store.pushActivity({
    kind: "agent_status",
    text: `${persona.name} started thinking about: ${taskSummary}`,
    nodeId,
  });

  // Log a session-start event so the per-agent execution history panel
  // can show this run. Fire-and-forget POST to /api/logs.
  store.pushActivity({
    kind: "agent_session_start",
    text: `${persona.name} started: ${taskSummary}`,
    nodeId,
    meta: { startTs, task: finalTask },
  });

  // 1) Fetch peer context from the bus (drains the inbox).
  let peerContext = "";
  try {
    const r = await fetch(
      `/api/bus?op=pre-prompt&canvas=${encodeURIComponent(store.canvasId)}&node=${encodeURIComponent(nodeId)}`,
      { method: "GET" },
    );
    if (r.ok) {
      const j = await r.json();
      peerContext = j.injection ?? "";
    }
  } catch {
    /* ignore */
  }

  // 1b) Build the list of connected peers (by name) for the LLM prompt.
  const connectedPeers = store.edges
    .filter((e) => e.kind === "bus" && (e.source === nodeId || e.target === nodeId))
    .map((e) => {
      const peerId = e.source === nodeId ? e.target : e.source;
      const peerNode = store.nodes.find((n) => n.id === peerId);
      return peerNode?.name;
    })
    .filter(Boolean) as string[];

  // 2) Append a placeholder assistant message we'll stream into.
  const msgId = store.appendAgentMessage(nodeId, {
    role: "assistant",
    text: "",
    authorName: persona.name,
    streaming: true,
  });

  store.setAgentStatus(nodeId, "working", "Working on it…");

  // 3) Call the agent runner.
  let text = "";
  let errored = false;
  try {
    const r = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId: persona.id,
        harness: data.harness,
        task: finalTask,
        peerContext,
        connectedPeers,
        history: data.messages.slice(-6),
      }),
    });
    if (!r.ok) throw new Error(`agent/run ${r.status}`);
    const j = await r.json();
    text = j.text ?? "";
  } catch (err) {
    console.error("[runAgent]", err);
    errored = true;
    text =
      `⚠️ I couldn't reach my reasoning backend.\n\nFalling back: I've acknowledged the task and queued it.\n\n\`queue: ${finalTask.slice(0, 80)}…\``;
  }

  // 4) Stream the text in chunks for UX.
  await streamText(nodeId, msgId, text);

  store.updateAgentMessage(nodeId, msgId, { streaming: false });
  store.setAgentStatus(nodeId, errored ? "error" : "done", errored ? "Backend unreachable — queued." : "Finished — awaiting next task.");
  store.pushActivity({
    kind: "agent_message",
    text: `${persona.name} finished and produced a ${text.length}-char response.`,
    nodeId,
  });

  // 5) Parse [autumn-bus] message_peer handoff lines and route them.
  //    Returns the set of peer node IDs that received an explicit handoff.
  const explicitPeerIds = routeBusHandoffs(nodeId, text);

  // 5b) Auto-emit synthetic handoffs to ANY connected peers the LLM didn't
  //     explicitly address. This handles two cases:
  //       (a) LLM emitted zero handoffs → auto-emit to ALL connected peers.
  //       (b) LLM emitted handoffs to SOME peers but missed others → auto-emit
  //           to the missing peers so no downstream agent is left in the dark.
  //     This smooths over LLM variance and keeps the multi-agent coordination
  //     loop visible to the user.
  if (connectedPeers.length > 0) {
    const store2 = useAutumnStore.getState();
    const lowerExplicit = new Set(
      explicitPeerIds.map((id) => {
        const n = store2.nodes.find((x) => x.id === id);
        return n?.name.toLowerCase() ?? "";
      }),
    );
    const missingPeerNames = connectedPeers.filter(
      (name) => !lowerExplicit.has(name.toLowerCase()),
    );
    if (missingPeerNames.length > 0) {
      autoEmitSyntheticHandoff(
        nodeId,
        persona.name,
        finalTask,
        text,
        missingPeerNames,
      );
    }
  }

  // 6) Log a session-stop event so the per-agent execution history panel
  //    can show the run's duration, response length, and final status.
  const endTs = Date.now();
  const durationMs = endTs - startTs;
  store.pushActivity({
    kind: "agent_session_stop",
    text: `${persona.name} finished in ${durationMs}ms — ${text.length} chars`,
    nodeId,
    meta: {
      startTs,
      endTs,
      durationMs,
      task: finalTask,
      responseLength: text.length,
      status: errored ? "error" : "done",
    },
  });

  store.setAgentRunning(nodeId, false);
}

async function streamText(
  nodeId: string,
  msgId: string,
  fullText: string,
) {
  const store = useAutumnStore.getState;
  const chunks = chunkText(fullText, 6); // ~6 chars per tick
  let acc = "";
  for (const c of chunks) {
    acc += c;
    store().updateAgentMessage(nodeId, msgId, { text: acc });
    // small delay; speed up if text is long
    await sleep(fullText.length > 600 ? 8 : 18);
  }
  // ensure final text is exact
  store().updateAgentMessage(nodeId, msgId, { text: fullText });
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function routeBusHandoffs(nodeId: string, text: string): string[] {
  const store = useAutumnStore.getState();
  const lines = text.split("\n");
  const routedPeerIds: string[] = [];
  for (const line of lines) {
    const m = line.match(
      /\[autumn-bus\]\s*message_peer\s*(?:→|->)\s*(\w+)\s*:\s*(.+)$/i,
    );
    if (!m) continue;
    const peerName = m[1];
    const message = m[2].trim();
    const peerNode = store.nodes.find(
      (n) =>
        n.kind === "chat" &&
        (n.name.toLowerCase() === peerName.toLowerCase() ||
          (n.data as { personaId?: string }).personaId?.toLowerCase() ===
            peerName.toLowerCase()),
    );
    if (!peerNode) continue;

    // Find the edge between this node and the peer.
    const edge = store.edges.find(
      (e) =>
        (e.source === nodeId && e.target === peerNode.id) ||
        (e.source === peerNode.id && e.target === nodeId),
    );
    if (!edge) continue;

    deliverPeerMessage(nodeId, peerNode.id, edge.id, message);
    routedPeerIds.push(peerNode.id);
  }
  return routedPeerIds;
}

// Auto-synthesize a handoff to EVERY connected peer when the LLM didn't
// emit any [autumn-bus] message_peer line. Keeps the coordination loop
// visible and surfaces progress to all downstream agents — not just the
// first peer. Returns the count of peers that received a synthetic handoff.
function autoEmitSyntheticHandoff(
  fromNodeId: string,
  fromName: string,
  task: string,
  responseText: string,
  peerNames: string[],
): number {
  const store = useAutumnStore.getState();

  // Pull a short, useful summary from the response (first non-empty line, capped).
  const firstLine = responseText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("```") && !l.startsWith("#"))
    .slice(0, 1)[0] ?? task;
  const summary = firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
  const message = `(auto) Task "${task.slice(0, 80)}" complete. Summary: ${summary}`;

  // Find ALL chat nodes whose name is in peerNames (case-insensitive).
  const lowerPeerNames = new Set(peerNames.map((n) => n.toLowerCase()));
  const peerNodes = store.nodes.filter(
    (n) =>
      n.kind === "chat" &&
      lowerPeerNames.has(n.name.toLowerCase()),
  );
  if (peerNodes.length === 0) return 0;

  let routed = 0;
  for (const peerNode of peerNodes) {
    // Find the edge between this node and the peer.
    const edge = store.edges.find(
      (e) =>
        (e.source === fromNodeId && e.target === peerNode.id) ||
        (e.source === peerNode.id && e.target === fromNodeId),
    );
    if (!edge) continue;

    deliverPeerMessage(fromNodeId, peerNode.id, edge.id, message);
    routed++;

    // Record a synthetic activity entry per peer (distinct toNodeId in meta).
    store.pushActivity({
      kind: "bus_message_peer",
      text: `${fromName} → ${peerNode.name}: (auto-handoff) ${summary.slice(0, 80)}`,
      nodeId: peerNode.id,
      meta: {
        fromNodeId,
        toNodeId: peerNode.id,
        edgeId: edge.id,
        synthetic: true,
      },
    });
  }
  return routed;
}

// Shared helper: deliver a peer message via the bus, push a visual pulse,
// and append the handoff into the peer's chat as a peer-role message.
function deliverPeerMessage(
  fromNodeId: string,
  toNodeId: string,
  edgeId: string,
  message: string,
) {
  const store = useAutumnStore.getState();

  // POST to the bus (records the inbox for the peer).
  fetch("/api/bus?op=message_peer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      canvasId: store.canvasId,
      fromNodeId,
      toNodeId,
      peer: toNodeId,
      message,
    }),
  }).catch(() => {});

  // Push a visual pulse on the edge.
  store.pushPulse({
    edgeId,
    fromNodeId,
    toNodeId,
    text: message,
    kind: "message_peer",
  });

  // Append the handoff into the peer's chat as a peer message.
  const fromName = useAutumnStore.getState().nodes.find((n) => n.id === fromNodeId)?.name;
  store.appendAgentMessage(toNodeId, {
    role: "peer",
    text: message,
    authorName: fromName,
  });

  // Record in the activity log (only for explicit handoffs; synthetic ones
  // record their own activity entry above to mark them as auto-generated).
  const fromNameForLog =
    useAutumnStore.getState().nodes.find((n) => n.id === fromNodeId)?.name ?? fromNodeId;
  const toName =
    useAutumnStore.getState().nodes.find((n) => n.id === toNodeId)?.name ?? toNodeId;
  store.pushActivity({
    kind: "bus_message_peer",
    text: `${fromNameForLog} → ${toName}: ${message.slice(0, 80)}${message.length > 80 ? "…" : ""}`,
    nodeId: toNodeId,
    meta: { fromNodeId, toNodeId, edgeId },
  });
}

// Convenience: run all idle agents that have a pending user task.
export async function runAllIdleAgents() {
  const store = useAutumnStore.getState();
  const nodes = store.nodes.filter(
    (n): n is AutumnNode & { kind: "chat" } => n.kind === "chat",
  );
  for (const n of nodes) {
    const data = n.data as ChatNodeData;
    if (data.status === "working" || data.status === "thinking") continue;
    const hasUserMsg = data.messages.some((m) => m.role === "user");
    const lastAssistant = [...data.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
    if (!hasUserMsg) continue;
    // Run if the last user msg comes after the last assistant msg (or no assistant yet).
    if (lastUser && (!lastAssistant || lastUser.ts > lastAssistant.ts)) {
      await runAgentForNode(n.id);
      await sleep(200);
    }
  }
}
