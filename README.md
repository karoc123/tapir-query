# Tapir Query

Tapir Query is a desktop-first CSV analysis tool focused on auditability, speed, and local execution.

Built with Tauri v2, Rust, DuckDB, and Angular 21 (Standalone + Signals), it provides an SQL-native workflow without sending data to external services.

## Quick Start

1. Install dependencies.

```bash
cd tapir-query && pnpm install
```

1. Pull real-world fixture samples.

```bash
cd tapir-query && pnpm fixtures:pull
```

1. Start desktop development mode.

```bash
cd tapir-query && pnpm tauri:dev
```

## Why Tapir Query

- Local-first data processing through embedded DuckDB.
- Typed IPC contracts between Rust commands and Angular services.
- Query execution in predictable chunks for stable memory usage.
- Context-first UI that starts in a single empty-state ingestion surface.
- Built-in observability for logs and runtime timing telemetry.

## Performance (Phase 3 Highlights)

Phase 3 introduced benchmark-oriented instrumentation and backend tracing:

- Backend query responses include `elapsedMs` from Rust/DuckDB execution.
- Angular DevTools overlay records bootup, file load, query roundtrip, and grid render timings (latest + average).
- DuckDB connection pooling reduces repeated setup overhead during multi-query sessions.
- Real-world fixture query test (`reads_real_world_sample_fixture`) completed in `0.31s` test runtime on the current Linux baseline run.

Re-run the fixture benchmark check locally:

```bash
cd tapir-query/src-tauri
cargo test engine::duckdb_engine::tests::reads_real_world_sample_fixture -- --exact --nocapture
```

## Themes: Soft Tapir and Dark Banking

Use the `Settings` button in the app shell to switch theme profiles.

- `Soft Tapir`: balanced neutral light palette for daytime workflows.
- `Dark Banking`: higher-contrast dark palette for low-light operations.

Visual placeholder convention for screenshots in project docs:

- `docs/assets/theme-soft-tapir.png`
- `docs/assets/theme-dark-banking.png`

## Linux Troubleshooting (Snap/GLIBC Conflict)

If you see this error while running dev mode:

```text
symbol lookup error: ... libpthread.so.0: undefined symbol: __libc_pthread_init, version GLIBC_PRIVATE
```

Cause:

- A Snap-inherited `LD_LIBRARY_PATH` can force mismatched libc/pthread libraries into the Tauri Rust process.

Fix in this repository:

- Use `pnpm tauri:dev`.
- The script sanitizes inherited Snap-sensitive runtime variables before launching Tauri:
  - `LD_LIBRARY_PATH`
  - `LD_PRELOAD`
  - `GTK_PATH`
  - `GIO_MODULE_DIR`
  - `GTK_PATH_VSCODE_SNAP_ORIG`
  - `GIO_MODULE_DIR_VSCODE_SNAP_ORIG`

If you still hit the issue, launch your terminal outside Snap-managed shells and retry.

## Repository Layout

- Frontend app: `tapir-query/`
- Tauri/Rust backend: `tapir-query/src-tauri/`
- Architecture and product docs: `docs/`

## Release Pipeline

Manual release workflow: `.github/workflows/release.yml`

- Trigger: `workflow_dispatch` with a `version` input.
- Generates changelog section from commit history.
- Syncs version in `package.json`, `tauri.conf.json`, and `Cargo.toml`.
- Builds Linux and Windows bundles.
- Publishes a draft GitHub release with uploaded artifacts.

## Developer Commands

```bash
# frontend tests
cd tapir-query && pnpm test

# backend tests
cd tapir-query/src-tauri && cargo test

# backend + fixture flow
cd tapir-query && pnpm test:backend

# production build
cd tapir-query && pnpm tauri build
```

## Cleanup Script

```bash
cd tapir-query
./scripts/cleanup-desktop.sh
```

This removes mobile artifact paths and legacy fixture submodule traces for the desktop-only target.
