// autumn — Wave-2 handlers: skills (2 dispatchable; doc 32 §W2-2).
//
// RE-derived model (index-C29xCgPS.js ~line 694320): the target treats on-disk
// skills directories (`.claude/skills` for Claude Code, CLAUDE.md/AGENTS.md blocks
// for codex/opencode/cursor) as THE SOURCE OF TRUTH. The renderer calls:
//   loadSkills() -> skills.installed(roots)  // roots = canvasHomePath + workspaceProjects[].info.path + terminal cwds
//   syncSkills() -> skills.sync(roots, addedSkills)
// Each root is scanned for a skills directory; every subdirectory is one skill
// (name = dir name, description from the first non-heading line of SKILL.md when
// present, or the README, or one-line fallback).
// Also mirror the autumn renderer's STARTER_SKILLS — already defined in
// src/lib/autumn/store.ts — into the same persisted store.
//
// params: { roots: string[] } (absolute) — bad-params on anything else.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, basename, relative } from "node:path";

import type { RegisteredHandler } from "./handlers";
import type { W1Deps } from "./w1-deps";
import { dbPath, loadJson, saveJson } from "./store";

const badParams = (message: string) => ({
  ok: false as const,
  error: { code: "bad-params" as const, message },
});

export interface Skill {
  id: string;
  name: string;
  description: string;
  root: string;
  path: string;
  installed: boolean;
}

/** Subdirs whose mere presence marks a root as carrying skills. */
const SKILL_DIRS = [".claude/skills", ".agents/skills", "skills", ".skills", ".agent/skills"];

const skillsFile = () => dbPath("skills.json");

function validateRoots(roots: unknown): string | null {
  if (!Array.isArray(roots) || roots.length === 0) return "roots (non-empty array of absolute paths) required";
  for (const r of roots) {
    if (typeof r !== "string" || !isAbsolute(r) || r.includes("\0")) return "every root must be an absolute path string";
  }
  return null;
}

/** Read the first non-heading content line from a file (description source). */
function firstDescription(dir: string): string | null {
  for (const candidate of ["SKILL.md", "README.md", "readme.md", "skill.md"]) {
    const f = join(dir, candidate);
    if (!existsSync(f)) continue;
    try {
      const text = readFileSync(f, "utf8");
      // First non-empty line (strip markdown headings/markup).
      for (const line of text.split("\n")) {
        const clean = line.trim().replace(/^#+\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1");
        if (clean.length > 0) return clean.slice(0, 160);
      }
    } catch {
      /* best effort */
    }
  }
  return null;
}

/** Scan roots for skill dirs; returns discovered skills (never includes non-dirs). */
export function scanSkills(roots: string[]): Skill[] {
  const found: Skill[] = [];
  for (const root of roots) {
    // Cheap existence probe first: candidate skill subdirs.
    for (const rel of SKILL_DIRS) {
      const skillsDir = join(root, rel);
      let entries: string[] = [];
      try {
        entries = readdirSync(skillsDir);
      } catch {
        continue; // dir missing → not a skills-bearing root
      }
      for (const entry of entries.sort()) {
        const full = join(skillsDir, entry);
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch {
          continue;
        }
        const id = `${relative(root, skillsDir)}/${entry}`;
        found.push({
          id,
          name: entry,
          description: firstDescription(full) ?? `${entry} skill (from ${rel})`,
          root,
          path: full,
          installed: true,
        });
      }
    }
    // Flat SKILL.md directly in the root (Claude's "one skill per root" layout).
    const flat = join(root, "SKILL.md");
    if (existsSync(flat)) {
      const desc = firstDescription(root) ?? basename(root);
      found.push({ id: "SKILL.md", name: basename(root), description: desc, root, path: flat, installed: true });
    }
  }
  return found;
}

/** Mirror of store.STARTER_SKILLS (read defensively; never throws). */
function starterSkills(): Array<{ id: string; name: string; description: string }> {
  try {
    const { STARTER_SKILLS } = require("../../lib/autumn/store");
    return (STARTER_SKILLS as Array<{ id: string; name: string; description: string }>) ?? [];
  } catch {
    return [];
  }
}

export function makeSkillsHandlers(deps: W1Deps): RegisteredHandler[] {
  const handlers: RegisteredHandler[] = [
    {
      kind: "bridge",
      id: "skills.installed",
      description:
        "discover installed skills under roots (on-disk scan) + starters; params: { roots: string[] } -> { skills: Skill[] }",
      schema: (p) => {
        const e = validateRoots(p?.roots);
        return e ? { ok: false, message: e } : { ok: true };
      },
      handler: (p) => {
        const err = validateRoots(p?.roots);
        if (err) return badParams(err);
        const discovered = scanSkills(p.roots);
        const starters = starterSkills().map((s) => ({
          id: `starter/${s.id}`,
          name: s.name,
          description: s.description,
          root: "__starter__",
          path: "__starter__",
          installed: true,
        }));
        return { skills: [...discovered, ...starters] };
      },
    },
    {
      kind: "bridge",
      id: "skills.sync",
      description:
        "sync/snapshot installed skill ids into the store (RE keeps them in registry); params: { roots: string[] } -> { skills: Skill[], updated, total }",
      schema: (p) => {
        const e = validateRoots(p?.roots);
        return e ? { ok: false, message: e } : { ok: true };
      },
      handler: (p) => {
        const err = validateRoots(p?.roots);
        if (err) return badParams(err);
        const discovered = scanSkills(p.roots);
        const previous = loadJson<Array<string>>(skillsFile(), []);
        const updated = discovered.map((s) => s.id).filter((id) => !previous.includes(id)).length;
        saveJson(skillsFile(), discovered.map((s) => s.id));
        return { skills: discovered, updated, total: discovered.length };
      },
    },
  ];

  return handlers;
}
