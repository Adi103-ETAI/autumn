// autumn — Wave-2 handlers: slides (4 dispatchable: create/start/stop/status;
// doc 32 §2h). `create`/`stop` are dormant in the current renderer but part of
// the target surface, so they dispatch with the same RE semantics.
//
// RE-derived (October out/main/index.js):
//   slidesCreate(name, parent) → slug (default name, RE default "october" →
//     autumn "autumn") + randomUUID().slice(0,8) + "-slides" folder directly in
//     defaultProjectsDir(); when `parent` is an OWNED folder it nests instead
//     via freeChildName(parent, "slides") (taken = exists AND non-empty →
//     "slides-2", "slides-3", …). Returns the folder path; mkdir -p.
//   slidesStart(folder) → ownership gate returns an ERROR STATE (not an error
//     envelope — RE setState(folder, {status:"error", message})): "points
//     outside <root>'s projects folder…". Busy states (running/starting/
//     installing/scaffolding) return the current state untouched. RE then runs
//     a dev server for the deck.
//   slidesStatus(folder) → decks.get(folder)?.state ?? {folder, status:"idle"}.
//   slidesStop(folder) → drop the running server, setState idle, and remove an
//     OWNED folder that has become empty (RE rmSync cleanup).
//
// autumn design (doc 32 §2h): no server —
//   start in DECK mode ({title, slides}) renders a real self-contained deck
//   HTML (cover + numbered slides, keyboard ←/→/Space nav) to
//   <userData>/slides/<deckId>.html and opens it fullscreen in a
//   BrowserWindow; without the Electron runtime the HTML is still really
//   rendered and the result reports {opened:false, reason} — the persisted
//   record never claims active:true for a window that was never shown.
//   start in FOLDER mode (positional folder string — the RE renderer shape)
//   behaves like RE (ownership error-state; opens <folder>/index.html
//   fullscreen when the folder is owned and has an entry file).
//
// status returns the persisted deck record {active, deckId, openedAt, slides}
// (deck mode, doc §2h) or the folder state (RE shape). Closing the window
// (real "closed" trigger) marks the record inactive. No manifest event exists
// for this namespace, so state updates are file/in-memory only.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson, userDataDir } from "./store";
import { paramsOf, str, lazyElectron, isOwnedFolder, projectsRoot } from "./params";

/** RE freeChildName: "taken" means exists AND non-empty. */
function freeChildName(parent: string, name: string): string {
  const taken = (leaf: string): boolean => {
    try {
      const p = join(parent, leaf);
      return existsSync(p) && readdirSync(p).length > 0;
    } catch {
      return false;
    }
  };
  if (!taken(name)) return name;
  for (let n = 2; ; n++) if (!taken(`${name}-${n}`)) return `${name}-${n}`;
}

function slugify(name: string | undefined, fallback: string): string {
  return (
    (name || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback
  );
}

// ---------------------------------------------------------------------------
// Deck state
// ---------------------------------------------------------------------------

type FolderState = {
  folder: string;
  status: "idle" | "running" | "starting" | "installing" | "scaffolding" | "error";
  port?: number;
  url?: string;
  message?: string;
};

type DeckRecord = {
  deckId: string;
  title: string;
  slides: number;
  path: string;
  url: string;
  active: boolean;
  opened: boolean;
  openedAt?: number;
  reason?: string;
};

const slidesDir = () => join(userDataDir(), "slides");
const deckFile = () => dbPath("slides.json");

function readDecks(): { deck: DeckRecord | null } {
  const d = loadJson<{ deck: DeckRecord | null }>(deckFile(), { deck: null });
  return { deck: d.deck ?? null };
}
function writeDeck(deck: DeckRecord | null): void {
  saveJson(deckFile(), { deck });
}

/**
 * Real deck render — self-contained HTML: cover + numbered slides, keyboard
 * ←/→/Space navigation, slide counter. No network, no deps; this file IS the
 * deck (doc 32 §2h "simple engine").
 */
export function renderDeckHtml(title: string, slides: unknown[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const normalized = slides.map((s, i) => {
    if (typeof s === "string") return { heading: `${i + 1}`, body: s };
    if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const heading = typeof o.heading === "string" ? o.heading : typeof o.title === "string" ? o.title : `${i + 1}`;
      const body =
        typeof o.body === "string" ? o.body : Array.isArray(o.bullets) ? (o.bullets as unknown[]).map(String).join("\n") : "";
      return { heading, body };
    }
    return { heading: `${i + 1}`, body: String(s) };
  });
  const sections = [
    `<section class="slide cover"><h1>${esc(title)}</h1><p class="hint">← → or Space to navigate</p></section>`,
    ...normalized.map(
      (s, i) =>
        `<section class="slide"><span class="num">${i + 1}/${normalized.length}</span><h2>${esc(s.heading)}</h2><pre>${esc(s.body)}</pre></section>`,
    ),
  ].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} — Autumn Slides</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: #101014; color: #ececf1; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .slide { display: none; height: 100vh; padding: 8vh 10vw; flex-direction: column; justify-content: center; }
  .slide.on { display: flex; }
  .cover h1 { font-size: clamp(2.2rem, 6vw, 4.5rem); letter-spacing: -0.02em; }
  h2 { font-size: clamp(1.6rem, 4vw, 3rem); margin-bottom: 1.2rem; }
  pre { white-space: pre-wrap; font: inherit; color: #b8b8c4; max-width: 60ch; }
  .num { color: #7a7a8c; font-size: 0.9rem; margin-bottom: 1rem; }
  .hint { color: #6a6a7c; margin-top: 1.4rem; }
  #bar { position: fixed; left: 0; right: 0; bottom: 0; height: 3px; background: #23232d; }
  #bar i { display: block; height: 100%; background: #ff5c39; width: 0; transition: width .15s; }
</style>
</head>
<body>
${sections}
<div id="bar"><i></i></div>
<script>
  var i = 0, all = document.querySelectorAll(".slide"), bar = document.querySelector("#bar i");
  function show(n) {
    i = Math.max(0, Math.min(all.length - 1, n));
    for (var k = 0; k < all.length; k++) all[k].classList.toggle("on", k === i);
    bar.style.width = (100 * i / Math.max(1, all.length - 1)) + "%";
  }
  addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); show(i + 1); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
    if (e.key === "Home") show(0);
    if (e.key === "End") show(all.length - 1);
  });
  show(0);
</script>
</body>
</html>
`;
}

export function makeSlidesHandlers(deps: W1Deps): RegisteredHandler[] {
  const { now } = deps;

  // RE keeps folder states in an in-memory map — ported verbatim.
  const decks = new Map<string, FolderState>();
  // Live windows (module scope; cleared on stop / close).
  const windows = new Map<string, { win: any }>();

  function setState(folder: string, patch: Partial<FolderState>): FolderState {
    const cur: FolderState = { folder, status: "idle", ...(decks.get(folder) ?? {}) };
    const next: FolderState = { ...cur, ...patch, folder };
    decks.set(folder, next);
    return next;
  }

  /** Open an HTML file fullscreen; returns null without the Electron runtime. */
  function openFullscreen(url: string, title: string, key: string): any | null {
    const BrowserWindow = lazyElectron()?.BrowserWindow;
    if (!BrowserWindow) return null;
    try {
      const win = new BrowserWindow({
        fullscreen: true,
        autoHideMenuBar: true,
        backgroundColor: "#101014",
        title,
        webPreferences: { contextIsolation: true },
      });
      win.loadURL(url);
      const id = key;
      win.on?.("closed", () => {
        windows.delete(id);
        // Real trigger: the window really went away → mark the record honest.
        const { deck } = readDecks();
        if (deck && deck.deckId === key) {
          writeDeck({ ...deck, active: false });
        }
        const st = decks.get(key);
        if (st && st.status === "running") setState(key, { status: "idle", port: undefined, url: undefined });
      });
      windows.set(key, { win });
      return win;
    } catch {
      return null;
    }
  }

  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "slides.create",
      description:
        "create a slide-deck folder (RE slidesCreate: slug + uuid8 + '-slides'); params: {name?, parent?} or positional (name, parent) — nested under an OWNED parent via freeChildName (exists AND non-empty → slides-2, …); returns the folder path",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const name = obj.name !== undefined ? (obj.name as string) : typeof pos[0] === "string" ? pos[0] : undefined;
        const parent = obj.parent !== undefined ? (obj.parent as string) : typeof pos[1] === "string" ? pos[1] : undefined;
        const slug = slugify(name, "autumn");
        const nest = parent && isOwnedFolder(parent);
        const folder = nest
          ? join(parent as string, freeChildName(parent as string, "slides"))
          : join(projectsRoot(), `${slug}-${randomUUID().slice(0, 8)}-slides`);
        mkdirSync(folder, { recursive: true });
        return folder;
      },
    },

    {
      kind: "bridge",
      id: "slides.start",
      description:
        "start a slide deck — DECK mode {title, slides} (doc 32 §2h): renders real deck HTML to <userData>/slides/<id>.html and opens it fullscreen (opened:false + reason without the Electron runtime); FOLDER mode (positional folder, RE slidesStart): ownership gate → RE error-state shape, then opens <folder>/index.html fullscreen",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const deckMode = obj.title !== undefined || obj.slides !== undefined;

        // ----- deck mode (doc §2h) -------------------------------------------
        if (deckMode) {
          const title = str(obj, [], "title") ?? "Untitled deck";
          const rawSlides = obj.slides;
          const slides = Array.isArray(rawSlides) ? rawSlides : typeof rawSlides === "string" ? [rawSlides] : [];
          const deckId = `deck-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
          const dir = slidesDir();
          mkdirSync(dir, { recursive: true });
          const file = join(dir, `${deckId}.html`);
          writeFileSync(file, renderDeckHtml(title, slides), "utf8");
          const url = pathToFileURL(file).toString();
          const win = openFullscreen(url, `${title} — Autumn Slides`, deckId);
          const record: DeckRecord = {
            deckId,
            title,
            slides: slides.length,
            path: file,
            url,
            active: !!win,
            opened: !!win,
            ...(win ? { openedAt: now() } : { reason: "the Autumn window (Electron runtime) is required to show a deck" }),
          };
          writeDeck(record);
          return record;
        }

        // ----- folder mode (RE slidesStart) ----------------------------------
        const folder = obj.folder !== undefined ? (obj.folder as string) : typeof pos[0] === "string" ? pos[0] : undefined;
        if (!isOwnedFolder(folder)) {
          return setState(folder as unknown as string, {
            status: "error",
            message: `This slide deck points outside ${projectsRoot()}'s projects folder, so it wasn't started. Add a new Slides block to create one.`,
          });
        }
        const busy = decks.get(folder as string)?.status;
        if (busy === "running" || busy === "starting" || busy === "installing" || busy === "scaffolding") {
          return decks.get(folder as string) as FolderState;
        }
        if (!existsSync(folder as string)) {
          return setState(folder as string, { status: "error", message: `This slide deck folder does not exist: ${folder}` });
        }
        const entry = ["index.html", "deck.html", "index.htm"].map((f) => join(folder as string, f)).find((f) => existsSync(f));
        if (!entry) {
          return setState(folder as string, {
            status: "error",
            message: "This slide deck has no index.html yet — add a Slides block or create one with slides.create.",
          });
        }
        const url = pathToFileURL(entry).toString();
        const win = openFullscreen(url, "Autumn Slides", folder as string);
        if (!win) {
          return setState(folder as string, {
            status: "error",
            message: "Starting a slide deck needs the Autumn window (Electron runtime).",
          });
        }
        return setState(folder as string, { status: "running", url, message: undefined });
      },
    },

    {
      kind: "bridge",
      id: "slides.status",
      description:
        "deck/folder status — with a folder argument: RE slidesStatus → {folder, status, …} state (default {status:'idle'}); without: the persisted deck record {active, deckId, openedAt?, slides, reason?} (doc 32 §2h)",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = obj.folder !== undefined ? (obj.folder as string) : typeof pos[0] === "string" ? pos[0] : undefined;
        if (folder !== undefined) {
          return decks.get(folder) ?? { folder, status: "idle" };
        }
        const { deck } = readDecks();
        return deck ?? { active: false, status: "idle" };
      },
    },

    {
      kind: "bridge",
      id: "slides.stop",
      description:
        "stop a deck — folder argument: RE slidesStop (close view, state → idle, remove an OWNED folder that became empty); otherwise close the active deck window and clear the persisted record → {active:false, deckId?}",
      handler: (params) => {
        const { obj, pos } = paramsOf(params);
        const folder = obj.folder !== undefined ? (obj.folder as string) : typeof pos[0] === "string" ? pos[0] : undefined;

        if (folder !== undefined) {
          const entry = windows.get(folder);
          if (entry) {
            try {
              entry.win?.close?.();
            } catch {
              /* already gone */
            }
            windows.delete(folder);
          }
          const state = setState(folder, { status: "idle", port: undefined, url: undefined, message: undefined });
          if (isOwnedFolder(folder) && existsSync(folder)) {
            try {
              if (readdirSync(folder).length === 0) rmSync(folder, { recursive: true, force: true });
            } catch {
              /* leave it — cleanup is best effort, like RE */
            }
          }
          return state;
        }

        const { deck } = readDecks();
        if (!deck) return { active: false };
        const entry = windows.get(deck.deckId);
        if (entry) {
          try {
            entry.win?.close?.();
          } catch {
            /* already gone */
          }
          windows.delete(deck.deckId);
        }
        const stopped = { ...deck, active: false };
        writeDeck(stopped);
        return { active: false, deckId: deck.deckId };
      },
    },
  ];

  return handlers;
}
