// autumn — the core protocol's local groups (Wave 4, doc 35 §7).
//
// Every method here is a REAL adapter: the core surface takes the protocol's
// shape and hands it to the bridge handler that already implements the
// behaviour. The bus, the CLI and the phone relay therefore drive exactly
// the same code the renderer does.
//
// The groups that need behaviour of their own (the app's lifecycle, the
// intents, the capabilities, the delivery policy, the questions, the
// documents, the chat turns) live in ./behaviour.ts; the hosted tier lives in
// ./hosted.ts.

import type { RegisteredHandler } from "../handlers";
import { delegate, dispatcher, type BridgeLookup } from "./support";

/** The terminal id: the core calls it `id`, the bridge calls it `node`. */
const node = (params: Record<string, any>) => params.id ?? params.nodeId ?? params.node;

/** The working folder: the core calls it `cwd`, the bridge `dir`. */
const cwd = (params: Record<string, any>) => params.cwd ?? params.dir;

export function makeCoreBridgeGroups(bridge: BridgeLookup): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [];

  // ---------------- artifacts ----------------
  handlers.push(
    dispatcher(bridge, {
      id: "artifacts.query",
      description:
        "read the artifacts; params: {op:'list'|'get'|'versions'|'catalog'|'previewHtml'|'usage'|'read', …}",
      ops: {
        list: { bridge: "artifacts.list" },
        get: { bridge: "artifacts.get" },
        versions: { bridge: "artifacts.versions" },
        catalog: { bridge: "artifacts.catalog" },
        previewHtml: { bridge: "artifacts.previewHtml" },
        usage: { bridge: "artifacts.usage" },
        read: { bridge: "artifacts.read" },
      },
    }),
    dispatcher(bridge, {
      id: "artifacts.mutate",
      description:
        "change the artifacts; params: {op:'save'|'restore'|'deleteVersions'|'retire'|'export'|'reveal', …}",
      ops: {
        save: { bridge: "artifacts.save" },
        restore: { bridge: "artifacts.restore" },
        deleteVersions: { bridge: "artifacts.deleteVersions" },
        retire: { bridge: "artifacts.retire" },
        export: { bridge: "artifacts.export" },
        reveal: { bridge: "artifacts.reveal" },
      },
    }),
  );

  // ---------------- terminal ----------------
  handlers.push(
    delegate(bridge, {
      id: "terminal.create",
      bridge: "terminal.start",
      description: "open a terminal; params: {id, canvasId?, cwd?, shell?, args?} -> the terminal descriptor",
      map: (p) => ({ node: node(p), canvasId: p.canvasId, dir: cwd(p) }),
    }),
    delegate(bridge, {
      id: "terminal.input",
      bridge: "terminal.input",
      description: "type into a terminal; params: {id, data}",
      map: (p) => ({ node: node(p), data: p.data ?? p.text ?? "" }),
    }),
    delegate(bridge, {
      id: "terminal.resize",
      bridge: "terminal.resize",
      description: "resize a terminal; params: {id, cols, rows}",
      map: (p) => ({ node: node(p), cols: p.cols, rows: p.rows }),
    }),
    delegate(bridge, {
      id: "terminal.kill",
      bridge: "terminal.kill",
      description: "kill a terminal; params: {id}",
      map: (p) => ({ node: node(p) }),
    }),
    delegate(bridge, {
      id: "terminal.reclaimHost",
      bridge: "terminal.reclaimHost",
      description: "give a terminal's host back; params: {id}",
      map: (p) => ({ node: node(p) }),
    }),
    delegate(bridge, {
      id: "terminal.snapshot",
      bridge: "terminal.snapshot",
      description: "the state of one terminal; params: {id}",
      map: (p) => ({ node: node(p) }),
    }),
  );

  // ---------------- devServer ----------------
  handlers.push(
    delegate(bridge, {
      id: "devServer.start",
      bridge: "devServer.start",
      description: "start the dev server of a project; params: {cwd, …}",
    }),
    delegate(bridge, {
      id: "devServer.stop",
      bridge: "devServer.stop",
      description: "stop the dev server of a project; params: {cwd}",
    }),
  );

  // ---------------- worktree ----------------
  handlers.push(
    delegate(bridge, {
      id: "worktree.create",
      bridge: "worktrees.prepare",
      description: "prepare a worktree; params: {cwd, branch?, …}",
    }),
    delegate(bridge, {
      id: "worktree.setup",
      bridge: "worktrees.derive",
      description: "derive the worktree's location; params: {cwd, branch?}",
    }),
    delegate(bridge, {
      id: "worktree.claim",
      bridge: "worktrees.resolve",
      description: "claim a worktree; params: {cwd, …}",
    }),
    delegate(bridge, {
      id: "worktree.remove",
      bridge: "worktrees.drop",
      description: "remove a worktree; params: {cwd, …}",
    }),
    delegate(bridge, {
      id: "worktree.list",
      bridge: "worktrees.list",
      description: "the worktrees of a repository; params: {cwd}",
    }),
  );

  // ---------------- git ----------------
  handlers.push(
    dispatcher(bridge, {
      id: "git.query",
      description: "read the repository; params: {op:'status'|'changes'|'taskChanges'|'prFacts', cwd, …}",
      ops: {
        status: { bridge: "git.status" },
        changes: { bridge: "git.changes" },
        taskChanges: { bridge: "git.taskChanges" },
        prFacts: { bridge: "git.prFacts" },
      },
    }),
    dispatcher(bridge, {
      id: "git.mutate",
      description: "change the repository; params: {op:'stage'|'discard'|'commit'|'push'|'initialize', cwd, …}",
      ops: {
        stage: { bridge: "git.stage" },
        discard: { bridge: "git.discard" },
        commit: { bridge: "git.commitAll" },
        push: { bridge: "git.push" },
        initialize: { bridge: "git.initializeEmpty" },
      },
    }),
    delegate(bridge, {
      id: "git.image",
      bridge: "files.readGitImage",
      description: "read an image out of the repository; params: {cwd, path}",
    }),
  );

  // ---------------- fs ----------------
  handlers.push(
    delegate(bridge, {
      id: "fs.list",
      bridge: "fs.browse",
      description: "list a folder; params: {path, showHidden?} -> {path, entries}",
    }),
    delegate(bridge, {
      id: "fs.read",
      bridge: "files.read",
      description: "read a file; params: {path} -> the file's contents",
    }),
  );

  // ---------------- remote (the phone relay) ----------------
  handlers.push(
    delegate(bridge, {
      id: "remote.status",
      bridge: "phone.status",
      description: "the relay's status; params: {} -> {enabled, paired, …}",
    }),
    delegate(bridge, {
      id: "remote.enable",
      bridge: "phone.enable",
      description: "turn the relay on; params: {}",
    }),
    delegate(bridge, {
      id: "remote.disable",
      bridge: "phone.disable",
      description: "turn the relay off; params: {}",
    }),
    delegate(bridge, {
      id: "remote.devices",
      bridge: "phone.devices",
      description: "the paired devices; params: {}",
    }),
    delegate(bridge, {
      id: "remote.revoke",
      bridge: "phone.revoke",
      description: "revoke a pairing; params: {…}",
    }),
    delegate(bridge, {
      id: "remote.keepAwake.status",
      bridge: "phone.keepAwake",
      description: "whether the machine stays awake; params: {}",
    }),
    delegate(bridge, {
      id: "remote.keepAwake.setEnabled",
      bridge: "phone.keepAwake",
      description: "keep the machine awake (or not); params: {enabled}",
      map: (p) => ({ enabled: p.enabled !== false }),
    }),
  );

  return handlers;
}
