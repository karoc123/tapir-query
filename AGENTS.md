# AGENTS Playbook: Tapir Query

This file is the operating guide for coding agents working in this repository.

## Session Snapshot (April 2026)

- Frontend is Angular 21 + Signals, backend is Tauri v2 + Rust + DuckDB.
- Phase 5 context-first UI is in place:
  - Empty mode: centered drop zone + Browse Files CTA only.
  - Loaded mode: Zone A action bar, Zone B collapsible schema sidebar, Zone C data grid, Zone D status bar.
- `LayoutStateService` owns layout transitions.
- `ErrorParsingService` converts raw Tauri/Rust errors to display-safe DTOs.
- `OpenFileResponse` includes `fileSizeBytes` across Rust and TypeScript contracts.
- Tauri command handlers are async and dispatch heavy work through `spawn_blocking`.
- Query flow defaults to session streaming (`start_query_session` + `read_query_session_chunk`) with a direct fast-path for simple `COUNT(*)` queries.
- Linux Snap GLIBC workaround is required for local dev (`pnpm tauri:dev` handles env sanitization).
- Release pipeline currently ships Windows NSIS `.exe` and Linux `.deb` artifacts only.

## Default Plan (How To Approach Any Task)

1. Confirm scope and delivery order.
2. Read relevant files before editing (`README.md`, `docs/architecture.md`, impacted services/components).
3. Map changes by layer: UI rendering, Signal/service state, IPC/contracts, and Rust command/domain/engine.
4. Implement smallest coherent slice first (service + contract, then component wiring).
5. Validate immediately with focused commands.
6. Update docs when architecture, contracts, or workflows change.
7. Summarize what changed, what passed, and remaining risks.

## Repository Facts

- Workspace root documentation:
  - `README.md`
  - `docs/architecture.md`
- App root:
  - `tapir-query/`
- Backend root:
  - `tapir-query/src-tauri/`

### High-Value Commands

From `tapir-query/`:

- Install deps: `pnpm install`
- Pull fixtures: `pnpm fixtures:pull`
- Frontend tests: `pnpm test`
- Frontend tests (single-process): `pnpm test --runInBand`
- Frontend build: `pnpm ng build`
- Desktop dev run: `pnpm tauri:dev`
- Desktop production build: `pnpm tauri build`
- Backend test suite: `cd src-tauri && cargo test`

## Development Guardrails

### Angular/UI

- Keep components presentational where possible.
- Put UI transitions and business behavior in services with Signals.
- Do not couple components directly to DuckDB details.
- For error output, always render parsed summaries/context, never raw JSON payloads.

### Rust/Tauri

- Keep snake_case DTOs with serde camelCase mapping.
- Keep command handlers thin; orchestration belongs in domain services.
- Preserve typed error mapping and predictable response contracts.

### Contracts

- Any contract change must be applied end-to-end:
  - Rust DTO
  - Tauri command response/request
  - TypeScript contract
  - Service usage
  - Tests

## Testing Instructions

Run the narrowest test set that proves the change, then run broader checks:

1. Changed frontend service/component specs.
2. `pnpm test --runInBand`.
3. `pnpm ng build`.
4. Backend tests if Rust/IPC changed: `cd src-tauri && cargo test`.

## Known Pitfalls

- Do not run Jest with `pnpm test -- --runInBand`; Jest may treat it as a file pattern and report no tests found.
- In strict TypeScript with index signatures, use bracket access (`obj["field"]`) instead of dot access.
- On Linux Snap environments, GLIBC conflicts can break `tauri dev` unless these vars are sanitized:
  - `LD_LIBRARY_PATH`
  - `LD_PRELOAD`
  - `GTK_PATH`
  - `GIO_MODULE_DIR`
  - `GTK_PATH_VSCODE_SNAP_ORIG`
  - `GIO_MODULE_DIR_VSCODE_SNAP_ORIG`

## Style Instructions

- Prefer clear, minimal diffs over broad refactors.
- Preserve existing naming and architecture conventions.
- Keep docs updated when behavior, workflows, or architecture changes.
- Use concise comments only where logic is non-obvious.

## Definition Of Done

- Feature/fix works and follows service/component separation.
- Contract changes are synchronized across Rust + TypeScript.
- Relevant tests/builds pass locally.
- `README.md` and/or `docs/architecture.md` updated if needed.
- Final handoff includes outcomes and any remaining risk.
