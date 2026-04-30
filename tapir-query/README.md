# Tapir Query App

This directory contains the Angular frontend and the Tauri v2 backend project.

## Features

- CodeMirror SQL editor with `Ctrl/Cmd+Enter` run shortcut.
- CodeMirror completion with `Ctrl+Space` (`Cmd+Space` on macOS).
- Schema explorer sidebar with query history recall (last 20 successful queries).
- Direct-first query execution with session streaming fallback retained for resilience.
- Typed IPC bridge for `open_file`, `execute_query`, `start_query_session`, `read_query_session_chunk`, `close_query_session`, `export_csv`, and `export_rows`.
- Loading activity panel with latest backend/frontend log breadcrumbs during long-running operations.
- DevTools performance overlay for bootup, file load, query, and grid render timings.

## Development

```bash
pnpm install
pnpm tauri:dev
```

If running from a Snap-packaged editor terminal on Linux, prefer `pnpm tauri:dev` over `pnpm tauri dev` to avoid GLIBC symbol conflicts.

On Linux/WSL, `pnpm tauri:dev` also applies WebKitGTK software-rendering/sandbox guard env flags to reduce `WebKitWebProcess` watchdog crashes (signal 5) observed in accelerated paths.

In Tauri runtime, background row-count metrics queries are currently disabled as an incident mitigation while WSL/WebKit watchdog stability is monitored.

## Build

```bash
pnpm tauri build
```

## Tests

Frontend:

```bash
pnpm test
```

Backend + fixture integration:

```bash
pnpm test:backend
```

Backend:

```bash
cd src-tauri
cargo test
```

## Notes

- The frontend uses Standalone Angular components and Signals.
- Frontend dependencies are migrated to Angular 21.
- IPC access is isolated in `src/app/infrastructure/tauri-bridge.service.ts`.
- UI orchestration lives in `src/app/domain/file.service.ts` and `src/app/domain/query.service.ts`.
- Backend command handlers are in `src-tauri/src/commands`, orchestration in `src-tauri/src/domain`, and DuckDB engine code in `src-tauri/src/engine`.
- Unit tests run on Jest (`jest.config.js`, `setup-jest.ts`) instead of Karma/Jasmine.
