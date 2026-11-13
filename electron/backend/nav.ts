// autumn — Wave-2 handlers: nav (1 dispatchable; docs/architecture/backend.md-1).
//
// params (10-preload-api-surface.md): nav.detect(projectPath, screens).
// Detects how the project wires navigation so the renderer can render route-aware
// UI: framework guess (expo / react-navigation / next / flutter-unknown-dirs / none)
// plus which of the caller-supplied screen dirs hold route-like files. Everything
// reported is what the filesystem actually contains — empty results, never guesses.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

/** Extensions that plausibly mark a screen/route file. */
const SCREEN_EXT = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte"]);
/** Depth-bounded existence check for common framework markers. */
const markers = (root: string) => {
  const has = (rel: string) => existsSync(join(root, rel));
  return {
    expo: has("app.json") && safeRead(join(root, "app.json"))?.includes('"expo"'),
    expoRouter: has("app") && statSync(join(root, "app"), { throwIfNoEntry: false })?.isDirectory?.() === true,
    reactNavigation: safeRead(join(root, "package.json"))?.includes("@react-navigation"),
    nextApp: has("next.config.js") || safeRead(join(root, "package.json"))?.includes('"next"'),
    flutter: has("pubspec.yaml"),
  };
};

function safeRead(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function safeReadJson(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const walkDirs = (root: string, maxDepth: number): string[] => {
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === ".next") continue;
      const full = join(dir, e.name);
      out.push(full);
      if (depth + 1 < maxDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return out;
};

const ROUTE_DIRS = ["app", "pages", "screens", "src/screens", "src/app", "src/pages"];

export function makeNavHandlers(deps: W1Deps): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "nav.detect",
      description:
        "detect the navigation/route setup of a project; params: { projectPath: absolute dir, screens?: string[] (dirs to probe) } -> { framework, routeDirs[], screens: [{dir, files[]}], expoRouter?, confidence }",
      schema: (p) =>
        typeof p?.projectPath === "string" && isAbsolute(p.projectPath) && !p.projectPath.includes("\0") &&
        (p?.screens === undefined || (Array.isArray(p.screens) && p.screens.every((s: unknown) => typeof s === "string")))
          ? { ok: true }
          : { ok: false, message: "projectPath (absolute dir) required; screens, if given, must be an array of strings" },
      handler: (p) => {
        const root = p.projectPath as string;
        if (!isAbsolute(root)) return badParams("projectPath must be an absolute directory");
        if (!existsSync(root) || !statSync(root, { throwIfNoEntry: false })?.isDirectory?.()) {
          return badParams("projectPath is not a directory");
        }
        if (
          p.screens !== undefined &&
          (!Array.isArray(p.screens) || p.screens.some((s: unknown) => typeof s !== "string" || s.length === 0))
        ) {
          return badParams("screens must be an array of non-empty strings when given");
        }
        const m = { ...markers(root) };
        let framework = "unknown";
        if (m.expo) framework = "expo";
        else if (m.reactNavigation) framework = "react-navigation";
        else if (m.nextApp) framework = "next";
        else if (m.flutter) framework = "flutter";
        const candidates = Array.isArray(p.screens) && p.screens.length > 0 ? p.screens : ROUTE_DIRS;
        const screenDirs = candidates
          .map((d) => ({ dir: d as string, full: isAbsolute(d as string) ? (d as string) : join(root, d as string) }))
          .filter(({ full }) => {
            try {
              return statSync(full, { throwIfNoEntry: false })?.isDirectory?.() === true;
            } catch {
              return false;
            }
          });
        const screens = screenDirs.map(({ dir, full }) => ({
          dir,
          files: walkFiles(full, 1).slice(0, 200),
        }));
        const routeDirs = walkDirs(root, 2).filter((d) => ROUTE_DIRS.includes(basename(d)) || ROUTE_DIRS.includes(relative(root, d)));
        return {
          framework,
          ...(framework === "unknown" ? {} : { confidence: "high" as const }),
          routeDirs: [...new Set(routeDirs)].slice(0, 12),
          screens,
          projectPath: root,
        };
      },
    },
  ];

  return handlers;
}

function walkFiles(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth + 1 < maxDepth && e.name !== "node_modules") stack.push({ dir: join(dir, e.name), depth: depth + 1 });
        continue;
      }
      const dot = e.name.lastIndexOf(".");
      if (dot > 0 && SCREEN_EXT.has(e.name.slice(dot).toLowerCase())) out.push(join(dir, e.name));
    }
  }
  return out;
}

const relative = (root: string, target: string) => target.slice(root.length).replace(/^[/\\]+/, "");
