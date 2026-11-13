# Architecture

Autumn is a spatial canvas for AI coding agents. This directory holds architecture docs that evolve side-by-side with code.

## Index

- **[Autumn Bus Full-Scale](./autumn-bus-fullscale.md)** - daemon vs mock hybrid, tasks/human/MCP, file map, verification. Mermaid diagrams for current mock and target daemon.

## Conventions

- Code references use `path:line` (e.g. `src/lib/autumn/bus-store.ts:1`).
- Diagrams use Mermaid `graph TD`.
- Each doc lists `What we get` as table mock vs daemon.
- After code changes run `graphify update .` then `npx next build` to keep `graphify-out/graph.json` and static shell in sync.

## Other Docs

- `docs/api/` - HTTP contracts for `/api/bus`, `/api/terminal`, `/api/agent/run` (to be added).
- `docs/ui/` - Canvas, node types, dock, sidebar specs (to be added).
