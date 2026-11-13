# The session library

The sessions your **other** agents already wrote on this machine.

Claude Code, Codex, Pi, Amp and Grok all keep their transcripts in their own
folders. Autumn reads them, indexes them, searches them and imports them — so
you can pick up a conversation in one tool that started in another.

```
electron/backend/portable-sessions.ts   the discovery, the search, the index
electron/backend/sessions.ts             the methods
```

## The eighteen methods

| Method | What it does |
|---|---|
| `sessions.list` | The portable sessions found on this machine. |
| `sessions.search` | Search them by title, folder, id **and** transcript content. |
| `sessions.library` | The index — what has been imported. |
| `sessions.importLibrary` | Scan the local stores and index them. |
| `sessions.cancelLibraryImport` | Cancel a running scan. |
| `sessions.importSession` | Import one session. |
| `sessions.importedList` | The imported sessions of a canvas. |
| `sessions.read` | One session, with its messages. |
| `sessions.engineStatus` | Whether an engine has sessions here. |
| `sessions.peekChat` | The messages of a chat node. |
| `sessions.historyPage` / `sessions.historyDetail` | The paginated history. |
| `sessions.importBatchStart` / `Status` / `Retry` / `Cancel` | A batch import. |
| `sessions.importBindDocument` | Bind an imported session to a document. |
| `sessions.folderFacts` | What kind of folder each path is. |

Plus the push: `sessions.onImportBatch`, fired as the import moves.

## Where the sessions live

| Harness | Root | Layout |
|---|---|---|
| Claude Code | `~/.claude` (or `$CLAUDE_CONFIG_DIR`) | `projects/<project>/<uuid>.jsonl` |
| Codex | `~/.codex` (or `$CODEX_HOME`) | `sessions/<y>/<m>/<d>/<uuid>.jsonl` |
| Pi | `$PI_CODING_AGENT_SESSION_DIR`, `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions` | `<dir>/<name>_<id>.jsonl` |
| Amp | `$AMP_THREADS_DIR`, `$XDG_DATA_HOME/amp/threads` or `~/.local/share/amp/threads` | `T-<id>.json` |
| Grok | `$GROK_HOME/sessions` or `~/.grok/sessions` | `<cwd>/<sessionId>/{summary.json, chat_history.jsonl}` |

## What a session looks like

```js
{
  harness: "claude_code",
  sessionId: "11111111-2222-…",
  title: "Fix the finder",           // the agent's own summary, else the first user message
  cwd: "/home/me/projects/autumn",   // the agent's own working folder
  cwdExists: true,
  lastActive: 1762932000000,
  sizeBytes: 48213,
  tracked: false                     // already imported into Autumn?
}
```

The title comes from the agent's own summary line when it has one, else the
first thing the user said, else `Session in <folder>`. The working folder comes
from the agent's own session metadata.

## The bounds

| | |
|---|---|
| Minimum transcript | 512 bytes (smaller files are skipped) |
| Files per harness | 300 |
| Sessions returned | 120 |
| Files opened per search | 60 |
| Largest transcript searched | 1.5 MB |
| Hits per session | 3 |
| Hit line length | 300 characters |

## The search

```js
await window.autumn.sessions.search({ pattern: "the finder" });
// [{ harness, sessionId, title, cwd, lastActive, hits: ["…the line that matched…"] }]
```

An empty pattern lists everything with no hits. Otherwise a session comes back
if its title, its folder or its id matches, **or** if its transcript contains
the pattern — and then the matching lines come with it.

## The index

`<userData>/session-library.json`:

```json
{ "sessions": [ { "sessionId": "…", "sourceId": "claude_code", "title": "…", "lastActive": 1762932000000 } ] }
```

If the file is damaged, Autumn does **not** ignore it: the damaged file is
preserved as `session-library.json.corrupt-<timestamp>` and the reason is
reported, so the index can be rebuilt from the original sessions.

## The folder facts

```js
await window.autumn.sessions.folderFacts({ paths: ["/tmp/x", "/home/me/repo"] });
// [{ path, root, name, kind: "folder" | "repository" | "missing",
//    home, temporary, driveRoot, system }]
```

`kind: "repository"` means the folder is inside a Git repository (the walk
stops at the `.git`), `temporary` means it lives under a temporary root. The
UI uses this to warn before you import something that is about to be cleaned up.

## The tests

`electron/backend/portable-sessions.test.js` lays out the real directory
structures of all five harnesses in a temp directory and asserts that the
discovery reads the actual files — the titles, the working folders, the sizes
and the content hits all come out of the real transcripts.
