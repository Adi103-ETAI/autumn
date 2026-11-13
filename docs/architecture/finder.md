# The finder

Browse and search **the whole machine** — not just the project you have open.

```
electron/backend/fs.ts
electron/preload.js   (the pathForFile exception)
```

## The twelve methods

| Method | What it does |
|---|---|
| `fs.places` | The Home / Desktop / Documents / Downloads folders that really exist, plus the project folder. |
| `fs.browse` | The listing of **one** directory. |
| `fs.preview` | A preview of one file: text, an image or "this is binary". |
| `fs.search` | Search from a root folder: the names **and** the contents. |
| `fs.reveal` | Show the item in the OS file manager. |
| `fs.open` | Open the item with the OS — the OS's own error is reported back. |
| `fs.rename` | Rename in place. |
| `fs.move` | Move into another folder. |
| `fs.copyInto` | Copy into another folder; the source is never touched. |
| `fs.trash` | Move to the OS trash. |
| `fs.mkdir` | Create a folder inside an existing one. |
| `fs.pathForFile` | The OS path of a dropped file (preload-local). |

## The listing

```js
{
  path: "/home/me/projects",
  entries: [
    { name: "src", path: "/home/me/projects/src", isDirectory: true, updatedAt: "2026-11-12T09:41:00.000Z" },
    { name: "notes.md", path: "/home/me/projects/notes.md", isDirectory: false, size: 812, updatedAt: "…" }
  ]
}
```

- The directories come **first**, then the files, each group sorted by name
  (case-insensitively).
- Hidden files are skipped unless `showHidden` is set.
- A directory has no `size`; a file always has one.
- The listing is bounded at 10 000 entries.

## The preview

```js
{ kind: "text", content: "…", truncated: false, ext: "md" }
{ kind: "image", dataUrl: "data:image/png;base64,…" }
{ kind: "binary", size: 4096, ext: "bin" }
```

- Text is the first **1 MB** of the file; `truncated` says when there is more.
- A **NUL byte in the first 8 KB** means the file is binary — it is never
  dumped into the renderer as text.
- Images come back as a data URL, up to **6 MB**.
- SVG and ICO get their own MIME type.

## The search

Two halves, merged:

- the **name** matches — a bounded walk of the tree (20 000 entries);
- the **content** matches — `ripgrep`, with `-F -i -n`, at most 5 hits per file.

```js
{ path: "/home/me/src/app.ts", name: "app.ts", isDirectory: false, line: 42, snippet: "const canvas = …" }
```

- At most **200** hits.
- The folders the search never descends into: `node_modules`, `.git`,
  `Library`, `.Trash`, `Pods`.
- A new search for the same root **supersedes** the running one.
- If `ripgrep` is not installed, the name matches still come back.

## The writes

The rules are strict, because these are the operations that can lose work:

| Operation | The rule |
|---|---|
| `fs.rename` | The new name may not contain a separator, and the destination must not exist. |
| `fs.move` | The destination must be an existing folder. A name collision is **reported**, never silently overwritten. A folder is never moved into itself. |
| `fs.copyInto` | The same, and the source is never touched. Folders recurse. |
| `fs.trash` | The OS trash is used; the platform's trash folder is the fallback. |
| `fs.mkdir` | The parent must exist, the name may not contain a separator, and the folder must not exist. |

A move or a copy always answers with what happened:

```js
{ moved: 2, collisions: ["notes.md"], failed: [] }
```

Nothing is swallowed.

## The dropped file

Electron removed the non-standard `File.path`, and `webUtils.getPathForFile`
only works in the preload process. So `pathForFile` is **preload-local**:

```js
facade.files.pathForFile = pathForFile;
facade.fs.pathForFile = pathForFile;
```

It returns `""` for a drag that is not a real file (an image dragged out of a
web page), which the callers filter out.

## The tests

`electron/backend/fs.test.js` works on a real temp tree: the listings, the
previews, the rename, the move, the copy, the trash and the mkdir all really
touch the disk, and the search really drives a `ripgrep` process.
