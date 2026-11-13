# Packaging

Autumn ships as a desktop app for **Windows, macOS and Linux**.

```
electron-builder.cjs                 the packaging configuration
scripts/prepare-standalone.mjs       the Next.js standalone server
scripts/build-backend.mjs            the backend bundle
scripts/compute-packaging-files.mjs  the runtime closure
scripts/check-packaging.mjs          the packaging contract
```

## The artifacts

| Platform | Artifacts | Name |
|---|---|---|
| Windows | NSIS installer + a zip | `Autumn-<version>-x64.exe` |
| macOS | DMG + a zip | `Autumn-<version>-x64.dmg` |
| Linux | AppImage + a deb | `Autumn-<version>-x64.AppImage` |

## The configuration

`electron-builder.cjs` is the single source of truth. Two things about it are
deliberate:

**The file name matters.** `electron-builder` only auto-discovers a
configuration named `electron-builder.config.js`/`.cjs`/`.yml`. A file called
`electron-builder.config.cjs` is silently ignored and the build falls back to
electron-builder's defaults — the wrong artifact names, the wrong output
directory, and a native rebuild that fails on a machine without a C++ toolchain.
The build passes `--config electron-builder.cjs` as well, so it cannot go
wrong.

**Native modules are not rebuilt.** The shipped binaries are N-API (`node-pty`)
or prebuilt (the Prisma query engine, sharp), so they load exactly as they
were shipped. Rebuilding them needs Visual Studio on Windows and distutils on
macOS, and it breaks the CI. Hence `npmRebuild: false`.

## What is in the installer

```
electron/           the app tree: main, preload, the IPC layer, the backend bundle
prisma/             the schema + the generated client (the CLI needs it at runtime)
resources/          the runtime config
package.json
.next/standalone/   as an extraResource — the server is EXECUTED, so it cannot
                    live inside the asar
```

The Next.js standalone server ships **outside** the asar: it is executed by
node, and a file inside an asar cannot be executed.

## What is unpacked

Native modules and spawnable tools must be on the real disk:

```
prisma/generated/**/*.node     the query engine
**/node_modules/node-pty/**    the PTY
**/node_modules/@prisma/engines/**
**/node_modules/@remotion/**   the compositor
**/*.node
```

## The runtime closure

`npm run pack:files` computes which of the installed packages the main
process actually loads, and writes the list to `assets/packaging-files.json`.
`electron-builder.cjs` reads it and excludes everything else.

The point: the renderer-only tree (radix, lucide, effect, rspack, …) is bundled
into the Next build and never needs to be in the app tree. Duplicating it in
the asar once added ~310 MB to the installer for nothing.

## The backend bundle

The backend is TypeScript, and the app is bundled with esbuild into
`electron/dist/backend.cjs`. Without it, a packaged app would crash on startup
with "Cannot find module 'typescript'" — the transpiler is a development
dependency and is not shipped.

The bundle keeps the IPC layer **external**: `electron/ipc/registry.js` must
stay a single module shared with `electron/main.js`, or the facade would
dispatch into a different registry than the window talks to.

The optional speech runtime is external too — it is not a dependency, and the
runtime answers "not available" when the module is absent.

## The size

| | |
|---|---|
| The installer | ~200 MB |
| The storage sidecar | ~25 MB (downloaded on demand) |
| The speech model | ~600 MB (downloaded on demand) |

## The CI

`.github/workflows/ci.yml`:

| Job | What it does |
|---|---|
| `check` | types → tests → the backend bundle → the packaging contract |
| `build` | the real installer, one per OS |
| `release` | on a `v*` tag: publish the installers and the update metadata |

**Each OS builds its own installer.** The Prisma query engine, `node-pty`'s
prebuilt binary and the Remotion compositor are platform-specific; a Linux
build cannot produce a working Windows installer.

The runs are keyed on the commit sha, so a push that also opens a pull request
produces one run, not two.

## The update

The installers are published with the `latest.yml` that `electron-updater`
reads, so an installed Autumn can update itself. The updater points at this
repository's GitHub releases.

## Before you build

```bash
npm run pack:check
```

It verifies the packaging contract: the app's own dependencies are declared
(not installed with `--no-save`), the native modules that must be unpacked are
unpacked, the runtime closure matches the installed tree, and the build scripts
are cross-platform.
