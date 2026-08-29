// Ambient module declaration for node-pty.
// node-pty ships its own types, but it is a native module that may not be
// present at typecheck time in some environments. This declaration lets the
// app typecheck; when the real package is installed it overrides this with the
// full typed API. We only use spawn/onData/onExit/write/resize/kill, so this
// minimal surface is sufficient and safe.

declare module "node-pty" {
  export interface IPty {
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
    pid: number;
  }
  export function spawn(
    file: string,
    args?: string[],
    opts?: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      uid?: number;
      gid?: number;
    },
  ): IPty;
}
