# Development

Everything you need to run, test, build and release Autumn.

## Requirements

| | |
|---|---|
| Node | 20 or newer (the CI uses 22) |
| npm | 10 or newer |
| An agent CLI | at least one of Claude Code, Codex, OpenCode, Gemini, Cursor, Grok, Hermes, Pi or Cline — Autumn drives the real binary |
| Platform tools | `git`, and `ffmpeg` for the video features (the app degrades honestly without it) |

## Install

```bash
npm install
```

That also generates the Prisma client (`postinstall` → `prisma generate`).

## Run it

```bash
npm run dev
```

This starts the Next.js renderer and the Electron shell together
(`scripts/dev-server.mjs`). The renderer is a normal Next.js app, so you can
also work on the UI alone:

```bash
npm run build && npm start     # the production renderer
```

### The data directory

Everything Autumn writes lives in one place:

```
~/.autumn/                       # or $AUTUMN_USER_DATA_DIR
  db/                            # the local database + settings
  rclone/                        # the storage sidecar (downloaded on demand)
  voice-models/                  # the speech models (downloaded on demand)
  session-library.json           # the session index
```

Set `AUTUMN_USER_DATA_DIR` to point the app somewhere else — the test suite
uses it to get a clean directory per test.

## Test

```bash
npm test
```

591 tests, no network, no Electron, no display. They run in plain Node:
`electron/ts-register.js` transpiles the TypeScript on the fly and the deps are
injected, so every handler can be driven headlessly.

```bash
node --test electron/backend/storage.test.js      # one file
node --test "electron/backend/*.test.js"          # one directory
```

### The rules the tests enforce

- **The contract.** Every renderer-used method must dispatch-resolve, and every
  `on*` method must exist in the preload facade as a subscription.
- **The facade.** The renderer must not talk HTTP — a guard test fails the
  build if it does.
- **Honesty.** A capability that is not present answers `supported:false` or
  `not-implemented`; it never fabricates a result.
- **No fake tests.** Where a test can drive the real thing, it does: a real git
  repository, a real HTTP server, a real tar archive, a real agent process.

## Type-check and lint

```bash
node scripts/check-types.mjs   # the whole project (electron/ and src/) must be clean
npm run lint
```

The renderer had type errors for a long time; they are gone, and the CI now
fails on any of them — a type error is a bug the compiler found for free.

## Build the installers

```bash
npm run pack:files        # compute the runtime closure -> assets/packaging-files.json
npm run build             # the Next.js standalone server
npm run build:backend     # bundle the Electron backend -> electron/dist/backend.cjs
npm run electron:build    # the installer for the OS you are on
```

Or for a specific target:

```bash
npm run electron:build:win
npm run electron:build:mac
npm run electron:build:linux
```

The installers land in `release/`.

**Build on the target OS.** The Prisma query engine and `node-pty` ship
platform-specific native binaries, and the Remotion CLI ships the host's
compositor. A Linux build cannot produce a working Windows installer — which
is exactly why the CI builds each one on its own runner.

### Before you push

```bash
npm run pack:check
```

It verifies the packaging contract: the app's own dependencies are declared
(not installed with `--no-save`), the native modules that must be unpacked are
unpacked, the runtime closure matches the installed tree, and the build scripts
are cross-platform (no `cp -r`, no `tee`, no `rm -rf`).

## The CI

`.github/workflows/ci.yml` runs on every push and every pull request:

| Job | What it does |
|---|---|
| `check` | types → tests → bundle the backend → the packaging contract |
| `build` | the real installer, one per OS (Windows, macOS, Linux) |
| `release` | on a `v*` tag: publish the installers and the update metadata |

The build matrix is what makes the artifacts trustworthy: each OS builds its
own installer on its own runner with its own native binaries.

## Release

```bash
git tag v1.2.3
git push origin v1.2.3
```

The tag triggers the release job, which publishes the three installers plus the
`latest.yml` that `electron-updater` reads — so an installed Autumn can update
itself.

The version lives in `package.json` and flows into the installers as
`Autumn-<version>-<arch>.<ext>`.

## Adding a backend method

1. Add the id to the contract (`electron/ipc/manifest.json`) — it must be in
   the namespace, and the renderer-usage list if the renderer calls it.
2. Write the handler in the right module under `electron/backend/`.
3. Register the factory in `electron/backend/index.ts`.
4. Write the test in the same folder.

The contract test will tell you if you missed a step.

## Adding a doc

Docs live in `docs/`. Keep them pure Autumn: describe what the app does, not
where the behaviour came from.
