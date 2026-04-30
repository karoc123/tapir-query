# Tapir Query

Tapir Query is a desktop-first CSV analysis tool focused on auditability, speed, and local execution.

Built with Tauri v2, Rust, DuckDB, and Angular 21 (Standalone + Signals), it provides an SQL-native workflow without sending data to external services.

## Quick Start

0. If rust and cargo are not installed, install Rust toolchain:

```bash
sudo apt update && sudo apt install curl build-essential -y
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

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
- Builds Windows NSIS `.exe` and Linux `.deb` bundles only.
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
