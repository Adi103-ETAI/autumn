# The road ahead

The contract is complete: **504/504 bridge methods and 129/129 core methods**
are implemented and dispatch, the renderer type-checks clean, and the CI
builds the three installers on every push.

What is left is the **product**: the app shows only a fraction of what the
backend can already do, there are no end-to-end tests, and the installers are
unsigned.

```
now ──▶ Wave 5: the surfaces      the UI for what is already built
     ──▶ Wave 6: the golden paths  the end-to-end tests that prove it
     ──▶ Wave 7: the release       signed installers, the update channel
```

**Out of scope (still held):** the hosted tier — the cloud workspace, the
cloud agents, the compute environments, the plan and the checkout. Those
methods exist in the contract and answer `not-implemented` with the reason.

---

## Wave 5 — the surfaces

The backend is finished; the app does not show most of it. Today the sidebar
has six tabs (resources, skills, backends, design, chat, notifications) and the
renderer calls about a dozen namespaces: `activity`, `artifacts`, `canvas`,
`devServer`, `git`, `terminal`.

Everything else — the finder, the projects, the storage, the memory, the
team, the session library, the voice pack, the agent accounts — is built and
**unreachable from the UI**.

### 5.1 The finder overlay

The AI Finder overlay searches the store (the project files, the nodes, the
skills, the tasks). The `fs` namespace can search **the whole machine**.

| | |
|---|---|
| `fs.places` | the places in the rail |
| `fs.browse` | the listing of one folder |
| `fs.search` | the names **and** the contents, over the machine |
| `fs.preview` | the text or the image of a file |
| `fs.open` / `fs.reveal` | open it, or show it in the file manager |
| `fs.rename` / `fs.move` / `fs.copyInto` / `fs.trash` / `fs.mkdir` | the writes |

**Acceptance:** the overlay lists a real folder tree, finds a file by its
content, previews it, and renames or trashes it — every call through the
facade, every write reporting its collisions and its failures.

### 5.2 The projects panel

`projects.recents`, `projects.create`, `projects.clone`, `projects.scanRoutes`,
`projects.discoverApps`, `projects.openIsolated`, `projects.relocateRecent`,
`projects.forgetRecent`, `projects.defaultDir`, `projects.newChildLocation`.

The canvas switcher grows the project's **routes** (read out of the sources),
and a project can be opened in an isolated worktree.

**Acceptance:** a project can be created, cloned, opened and relocated from
the UI; the canvas switcher shows its routes.

### 5.3 The storage panel

`storage.ensure`, `storage.remotes`, `storage.connect`,
`storage.cancelConnect`, `storage.disconnect`, `storage.list`,
`storage.importToLibrary`.

The sidecar is downloaded on demand (and the panel says so), the OAuth
connect opens the browser, the remote's files can be browsed and imported into
the library.

**Acceptance:** a drive can be connected, browsed and imported from the UI —
with the sidecar's download visible while it happens.

### 5.4 The memory panel

`supermemory.status`, `supermemory.connectApiKey`, `supermemory.selectSpace`,
`supermemory.grant`, `supermemory.revoke`, plus the `onGrantChanged` push.

The panel shows the spaces, the grant level per agent, and the revoke — the
*recall* / *contribute* split made visible.

**Acceptance:** a provider can be connected, a space chosen and a grant
revoked from the UI, and the panel reflects the push.

### 5.5 The team panel (autopilot)

`autopilot.start`, `autopilot.stop`, `autopilot.retryMember`,
`autopilot.stopMember`, `autopilot.snapshot`, `autopilot.releaseTerminal`,
and the `onChanged` push.

The view: the members, their roles, their status (`working`, `needs-input`,
`stuck`, `done`), the worker's report, and the retry/stop/release per member.

**Acceptance:** a team can be started from the UI, the members' progress
streams in, and a stuck member can be retried.

### 5.6 The session library panel

`sessions.list`, `sessions.search`, `sessions.library`,
`sessions.importLibrary`, `sessions.read`, `sessions.importSession`.

The panel searches the **other agents'** transcripts (Claude Code, Codex, Pi,
Amp, Grok), previews the hits and imports one into Autumn.

**Acceptance:** a session from another agent can be found, read and imported.

### 5.7 The voice panel

`voice.voicePack` (status / prepare / retry / delete) and `voice.parakeet`.

The setup wizard today uses the browser's Web Speech API. It should offer the
**real** Parakeet pack as well — with the download's progress, the free disk
check and the delete — and keep the browser path as the fallback.

**Acceptance:** the pack can be downloaded, its state shown, and it deleted
again, from the UI.

### 5.8 The accounts and the backends panels

`agentAccounts.*` (the sign-in for Claude and Codex, the probing, the
avatars) and `backends.*` (the provider registry: the local and the hosted
kinds, the linking).

**Acceptance:** an account can be signed in and probed from the UI, and the
backend registry shows what is linked.

### The shared work

- Every panel is a **store action** plus a component — the same pattern as
  the existing ones, so the facade stays the only path.
- The Bridge Inspector must show the new namespaces.
- The panels need the honest states: *downloading*, *not installed*, *not
  connected*, *not-implemented* — never a fake.

---

## Wave 6 — the golden paths

The tests today are all unit-level: they prove the handlers behave. Nothing
proves the **app** works.

### 6.1 Playwright-Electron

The end-to-end paths, driving the real app:

| Path | What it proves |
|---|---|
| the boot | the app starts, the backend registers, the window loads the canvas |
| the canvas loop | a node is added, moved, connected and saved |
| the agent run | an agent is spawned into a real terminal and answers |
| the file edit | a file is written and read back through the facade |
| the git flow | the status, the stage and the commit really run |
| the finder | the overlay finds a file by its content and previews it |
| the voice pack | the pack downloads, the state reports, the delete works |
| the team | a team starts, a member reports, a member is retried |
| the restart | the state survives the app restarting |

**Acceptance:** the suite runs on the CI runners (one per OS) and fails the
build when a path breaks.

### 6.2 The crash and the recovery paths

The app is killed mid-write, the terminal dies, the sidecar is deleted
underneath a running install — the app must recover, and say what it lost.

### 6.3 The Bridge Inspector

The Inspector is the surface's index. It must list every namespace with its
descriptions, and it must be the way a new contributor finds the method they
need.

---

## Wave 7 — the release

The installers are **unsigned** today, so macOS shows the Gatekeeper warning
and Windows shows SmartScreen. The release wave fixes that and makes the
update path real.

### 7.1 Signing

| | |
|---|---|
| macOS | the Developer ID certificate + the notarization (the stapled app) |
| Windows | the code-signing certificate, so the installer is trusted |

**Acceptance:** a fresh macOS machine opens the app without a warning, and
Windows shows the publisher.

### 7.2 The update round trip

The updater is implemented (`update.state`, `update.check`, `update.start`,
`update.install`) and the release job publishes the `latest.yml` — but nobody
has watched an app **update itself**.

**Acceptance:** an installed app finds the next release, downloads it, asks,
installs and restarts into the new version.

### 7.3 The release notes and the tags

`v1.0.0` (or `v0.9.0` if it is pre-1.0), the notes, the checksum, and the
README's "install" section pointing at the real artifact.

---

## How the work lands

Every wave goes through the same path:

1. a **branch** off `main` (`autumn-p9`, …),
2. a **pull request** into `main`,
3. the CI green (the check job, then the installers),
4. the PR merged.

`main` is never pushed to directly.
