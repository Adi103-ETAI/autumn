# Autopilot

A **team of agents** under one node.

You give Autumn a reviewed plan — who is on the team, what each of them does,
which of them waits for which — and it starts **one real agent process per
member**, each in its own terminal, each with its own task.

```
electron/backend/autopilot.ts
```

## The six methods

| Method | What it does |
|---|---|
| `autopilot.start` | Validate the plan, resolve the repository, create the team, launch every member. |
| `autopilot.stop` | Stop the team: every member's process is really stopped. |
| `autopilot.retryMember` | Launch one member again (it must need it). |
| `autopilot.stopMember` | Stop one member; the rest keep working. |
| `autopilot.snapshot` | The team snapshot — the newest team of a canvas, or one by id. |
| `autopilot.releaseTerminal` | Hand a stopped member's terminal back to the user. |

Plus the push: `autopilot.onChanged`, fired on every real change.

## The plan

```jsonc
{
  "version": 1,
  "kind": "team_proposal",
  "objective": "ship the finder",
  "optimize": "speed" | "cost" | "quality" | "balanced",
  "agents": [
    { "slotId": "s1", "role": "builder", "harness": "codex", "model": "…", "candidateId": "cand-1" }
  ],
  "assignments": [
    { "slotId": "s1", "task": "write the finder", "dependsOn": [] }
  ],
  "connections": [{ "from": "s1", "to": "s2" }]
}
```

The plan is validated before anything starts:

- the canvas id must be valid;
- the candidate binding must be present, bounded and free of duplicates;
- every agent must have a slot, a role, a harness and a candidate;
- every assignment must name a slot that exists;
- the team must fit in the device's slot budget (20 approved slots at once);
- only one team may run on a canvas at a time.

## The repository

A team needs **one existing local Git repository**. Autumn resolves it the way
git does:

```
git rev-parse --show-toplevel
git rev-parse HEAD
```

The root and the HEAD sha are recorded on the operation, so the team knows
exactly what it started from. A path that is not a repository is refused with
the reason.

## The members

Each member gets:

- a node id (`opterm-<uuid>`) and its own canvas;
- a role, a harness, a model and a task;
- a status from the member vocabulary.

| Status | Meaning |
|---|---|
| `queued` | Not started yet. |
| `isolating` | Getting its workspace. |
| `launching` | The harness is being resolved and started. |
| `connecting` | The agent is joining the bus. |
| `needs-setup` | The harness is not installed — with a message that says which. |
| `ready` | Launched, not started on its task yet. |
| `working` | Running. |
| `needs-input` | The agent is waiting for the human. |
| `stuck` | The agent reported that it is blocked. |
| `done` | Finished. |
| `failed` | It died; the error is kept. |
| `stopped` | Stopped by the user. |
| `released` | Its terminal was handed back. |

**A missing CLI is never faked.** If the harness is not on the machine, the
member goes to `needs-setup` and says so:

> The codex CLI is not installed on this machine.

## The worker reports

The members report their own progress in the terminal's output, in the
vocabulary the operation understands:

```
[worker status: checkpoint] half way through the migration
[worker status: needs input] which database should I use?
[worker status: stuck] waiting for a lock on schema.prisma
[worker status: done] shipped
```

| Report | The member becomes |
|---|---|
| `checkpoint` | `working` |
| `needs input` | `needs-input` |
| `stuck` | `stuck` |
| `done` | `done` |

When every member is done, the operation is `completed`.

## The operation

```ts
{
  id: "operation-<uuid>",
  canvasId, objective, optimize,
  status: "starting" | "running" | "stopping" | "stopped" | "completed" | "failed" | "interrupted",
  repoRoot, baseSha,
  createdAt, updatedAt,
  connections: [{ from, to }],
  members: [{ slotId, nodeId, canvasId, role, harness, model, task, dependsOn, status, … }]
}
```

It is persisted to `<userData>/autopilot-operations.json` and survives a
restart of the app.

## The bus

Every member joins the canvas bus as a peer, so the team can talk to each
other and to you while it works.

## The gate

Team staffing is **local**: there is no server to ask. It is on by default and
can be turned off from `<userData>/db/autopilot-gate.json`:

```json
{ "enabled": false, "operatorDisabled": true, "message": "Team staffing is disabled." }
```

## The tests

`electron/backend/autopilot.test.js` uses a **real git repository** in a temp
directory and **real agent processes**: the "harness" is a script that prints a
worker report, and the test asserts that the member's status really follows it.
