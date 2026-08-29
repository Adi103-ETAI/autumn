// Autumn — type declarations for the window.autumn preload bridge.
// Mirrors the API exposed in electron/preload.js so the Next.js renderer
// (TypeScript) can call it with types.

export interface AutumnBridge {
  openFileDialog: (
    opts?: { title?: string; directory?: boolean },
  ) => Promise<string[] | null>;
  onTerminalData: (cb: (data: unknown) => void) => void;
}

declare global {
  interface Window {
    autumn: AutumnBridge;
  }
}

export {};
