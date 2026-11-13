# Storage

Cloud drives, delegated to **rclone**.

Autumn does not implement a Drive SDK, a Dropbox SDK and a OneDrive SDK. It
uses the one tool that already does all of them, and it does it the way a good
desktop app does: **the tool is downloaded on demand, verified, and kept out
of the installer.**

```
electron/backend/storage.ts   the seven methods
electron/backend/sidecar.ts   the download / verify / extract helpers
```

## The seven methods

| Method | What it does |
|---|---|
| `storage.ensure` | Make the sidecar available: download the platform's archive, verify it against the published checksum, unpack it, record the checksum. |
| `storage.remotes` | The configured remotes: `[{name, type}]`, read from the real config. |
| `storage.connect` | Start an OAuth connection for a remote. The provider prints a URL; the browser opens it; the token is written to the config. |
| `storage.cancelConnect` | Cancel a connection that is in progress. |
| `storage.disconnect` | Remove a remote from the config. |
| `storage.list` | The files on a remote: `[{name, path, isDirectory, size, updatedAt}]`. |
| `storage.importToLibrary` | Copy a file from a remote into the local library. |

## The sidecar

| | |
|---|---|
| Version | `v1.74.3` |
| Archive | `rclone-<version>-{osx\|windows\|linux}-{arm64\|amd64}.zip` |
| Where | `<userData>/rclone/bin/rclone[.exe]` |
| Checksum | from the published `SHA256SUMS`, written to `<userData>/rclone/bin/.rclone-archive-sha256` |
| Config | `<userData>/rclone/rclone.conf` |

**The installer does not grow.** The sidecar is ~25 MB and it is downloaded the
first time you use a cloud drive — after `storage.ensure` has verified it
against the checksum the project publishes.

## The OAuth remotes

`drive`, `dropbox` and `onedrive` are the types that can connect with a
browser. Anything else is refused with the reason.

The flow is real: `rclone authorize <type>` prints the URL, Autumn opens it in
the user's browser, and the token blob that comes back (the JSON between the
`---> {…} <---` markers) is written into the config.

## Before the sidecar is installed

Every method answers honestly:

```js
await window.autumn.storage.remotes();
// { supported: false, reason: "the rclone sidecar is not downloaded yet" }
```

No empty list pretending to be "you have no remotes". No invented remote.

## The parsing

The shapes come from the real output of the tool:

- `rclone listremotes` → `name: type` → `[{name, type}]`
- `rclone lsjson` → `{Name, Path, IsDir, Size, ModTime}` → the entries above,
  sorted with the directories first
- the authorize blob → the JSON between the `---> {…} <---` markers, which must
  carry an `access_token`

## The tests

`electron/backend/storage.test.js` runs the real thing: it downloads the
actual sidecar for the machine it runs on, verifies the checksum, unpacks it,
and asserts that the installed binary answers `rclone version`. On a machine
without a network it asserts the honest answer instead.
