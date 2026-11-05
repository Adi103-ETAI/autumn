// autumn — Wave-1 shared dependency surface (doc 31).
//
// ONE interface every Wave-1 handler module consumes: `make*Handlers(deps: W1Deps)`.
// Built by index.ts `realW1Deps()` for the main process; tests build partial fakes
// (plain JS — only the members actually called must be present at runtime).
//
// W1Deps is a SUPERSET of BackendDeps (handlers.ts): busStore/spawner/personas/
// emit come through unchanged; pty and db are widened for Wave-1 needs.
//
// SHARED FILE — Wave-1 agents must NOT edit this file. If a dependency you need
// is missing, implement it inside your own module (node built-ins are fine) and
// report it in your final summary for integration.

import type { SimpleGit } from "simple-git";
import type { BackendDeps, DbDep } from "./handlers";

/** node:fs/promises — tests may pass the REAL module against a tmp dir. */
export type FsPromises = typeof import("node:fs/promises");

/** Full pty surface (superset of handlers.ts PtyDep). */
export interface W1PtyDep {
  createPty(opts: {
    nodeId: string;
    dir?: string;
    command?: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
    cols?: number;
    rows?: number;
  }): boolean;
  subscribePty(nodeId: string, cb: (chunk: string) => void): () => void;
  writePty(nodeId: string, data: string): boolean;
  resizePty(nodeId: string, cols: number, rows: number): void;
  killPty(nodeId: string): void;
  ptyExists(nodeId: string): boolean;
  ptyKind(nodeId: string): "shell" | "agent" | undefined;
  ptyCount(): number;
  /** Wave-1 exit subscription (src/lib/autumn/pty.ts onPtyExit). */
  onPtyExit(
    cb: (nodeId: string, info: { exitCode: number; signal?: number; kind: "shell" | "agent" }) => void,
  ): () => void;
}

/** Loose Prisma delegate — every method the Wave-1 models expose. */
export interface W1Model {
  findMany(args?: any): Promise<any[]>;
  findUnique(args?: any): Promise<any>;
  create(args: any): Promise<any>;
  createMany?(args: any): Promise<any>;
  update(args: any): Promise<any>;
  upsert(args: any): Promise<any>;
  delete(args: any): Promise<any>;
  deleteMany?(args?: any): Promise<any>;
  count(args?: any): Promise<number>;
}

/** Prisma client widened with the Wave-1 models (Artifact/Session/...). */
export interface W1DbDep extends DbDep {
  artifact: W1Model;
  artifactVersion: W1Model;
  session: W1Model;
  task: W1Model;
  message: W1Model;
  node: W1Model;
  edge: W1Model;
  busPeer: W1Model;
}

/** electron.shell — faked in headless tests. */
export interface ShellDep {
  openPath(p: string): Promise<string>;
  showItemInFolder(p: string): void;
  openExternal(url: string): Promise<void>;
}

/** electron.clipboard — faked in headless tests. */
export interface ClipboardDep {
  readText(): string;
  writeText(text: string): void;
  /** NativeImage-ish: only toPNG() is required by Wave-1 handlers. */
  readImage(): { toPNG(): Buffer } | null;
}

/** Screen capture for thumbnails.capture — faked in headless tests. */
export interface ScreenDep {
  /** data-URL of the primary display, or null when unavailable. */
  capture(): Promise<string | null>;
}

/** child_process.spawn wrapper for devServer.start/stop. */
export interface SpawnDep {
  spawn(
    command: string,
    args: string[],
    opts?: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean },
  ): ChildProcLike;
}

export interface ChildProcLike {
  on(event: "exit", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  stdout?: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  stderr?: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  kill(signal?: string): void;
}

export interface W1Deps extends Omit<BackendDeps, "pty" | "db"> {
  /** push a payload to renderer subscribers of a facade `on*` method (full dotted id) */
  emit(id: string, payload: unknown): void;
  now(): number;
  pty: W1PtyDep;
  db: W1DbDep;
  fs: FsPromises;
  shell: ShellDep;
  clipboard: ClipboardDep;
  screen: ScreenDep;
  /** simple-git bound to a working directory. */
  git(cwd: string): SimpleGit;
  spawn: SpawnDep;
}
