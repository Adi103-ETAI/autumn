# Data and privacy

Autumn is local-first. This page says exactly what that means, file by file.

## The one data directory

Everything Autumn writes lives in one place:

```
~/.autumn/                       # or $AUTUMN_USER_DATA_DIR
```

| Path | What it is |
|---|---|
| `db/app-settings.json` | The settings document. |
| `db/*.json` | The local database and the per-subsystem stores. |
| `rclone/` | The storage sidecar and its config (downloaded on demand). |
| `voice-models/` | The speech models and the optional runtime (downloaded on demand). |
| `session-library.json` | The index of the sessions found on this machine. |
| `voice/` | The recorded audio, the usage counters, the cache. |
| `autopilot-operations.json` | The teams that were started. |
| `autopilot-gate.json` | The local staffing gate. |

Nothing is written outside it, and the whole directory can be deleted to reset
the app.

## The database

SQLite, through Prisma, in `<userData>/db/`. It holds the canvases, the nodes,
the tasks, the messages, the sessions, the artifacts and the agent logs.

## The secrets

| Secret | Where it lives | How it is protected |
|---|---|---|
| The memory provider's key | `<userData>/supermemory-vault.json` | Encrypted with the OS keychain; mode `0600`. **Without a keychain it is kept in memory only and never written to disk.** |
| Your own API keys (the agents you brought) | The settings document | Read only when a request needs them; never logged. |
| The token in the diagnostic reports | Nowhere | The reports are scrubbed before they are written. |

Two rules the code follows:

1. A secret is never written to a log, a crash report or an analytics event.
2. A secret is never returned to the renderer unless the user asked for it.

## What leaves the machine

Only what the user asked for:

| | When |
|---|---|
| The storage provider | When you connect a cloud drive and browse it. |
| The memory provider | When you connect a memory provider. |
| The model downloads | When you ask for on-device speech, or for a storage sidecar. |
| The agent CLI | When you run an agent — that is the CLI you installed, talking to its own service. |

**The renderer never talks to the network.** Every call it makes goes through
the IPC facade, and a guard test fails the build if a network client ever
appears in the renderer's source.

## What is sent to the agent CLI

When you run an agent, Autumn hands the CLI the prompt and the working
folder. The CLI then talks to its own service — that is the agent's own
account, not Autumn's. Autumn does not proxy, log or inspect that traffic.

## The analytics

There is no analytics client in the app. The `analytics` namespace exists in
the contract for the hosted tier and is not implemented.

## The clipboard

The clipboard is only touched when you ask for it: the copy and paste commands,
and a screenshot into the canvas.

## The microphone

Only when you turn the microphone on:

- the recording is a real file in `<userData>/voice/`;
- the audio never leaves the machine when on-device speech is on — the
  recognition runs locally;
- the microphone can be muted and the permission can be revoked from the OS at
  any time.

## Deleting everything

| | |
|---|---|
| The app's data | Delete `~/.autumn`. |
| The sidecars and the models | The app's settings, or `voice.voicePack` with `action:"delete"`. |
| The recordings | The `voice/` folder. |
| The session index | `session-library.json`. |
