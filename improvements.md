# Tapir Query Deep-Dive Improvements (April 30, 2026)

## Scope and Method

This review covers:

- Rust backend (state, panic/error handling, resource management)
- IPC bridge contracts and call patterns
- Memory leak risks in frontend and backend
- Tauri capability/security posture (least privilege)
- Build warnings, deprecated surfaces, binary/startup performance
- Live run diagnostics with:
  - cd /home/zink/dev/tapir-query/tapir-query && RUST_BACKTRACE=1 pnpm tauri:dev

Primary files inspected:

- src-tauri/src/lib.rs
- src-tauri/src/commands/csv_commands.rs
- src-tauri/src/domain/csv_query_service.rs
- src-tauri/src/engine/duckdb_engine.rs
- src-tauri/tauri.conf.json
- src-tauri/capabilities/default.json
- src/app/domain/query.service.ts
- src/app/domain/ingestion.service.ts
- src/app/domain/dataset-metrics.service.ts
- src/app/infrastructure/tauri-bridge.service.ts
- src/app/infrastructure/tauri-contracts.ts

## Executive Summary

Overall architecture is solid and already improved in key areas:

- Good typed boundary between Rust and TypeScript DTOs.
- Blocking backend operations are correctly moved to spawn_blocking.
- Query execution in direct mode improves runtime resilience.
- Frontend listener cleanup is mostly disciplined.

Main risks now are operational/security hardening rather than core correctness:

1. Tauri app cannot start in dev because productName contains a colon.
2. Capability set is broader than needed (core:default + opener:default).
3. CSP is null (no content security policy), increasing blast radius in case of XSS.
4. Long-running backend work has no cancellation propagation.
5. Session streaming path still exists but is currently dormant/partially dead from frontend call graph.

## Live-Run Result

Command executed exactly as requested:

- cd /home/zink/dev/tapir-query/tapir-query && RUST_BACKTRACE=1 pnpm tauri:dev

Observed result:

- Startup failed before runtime boot.
- Error:
  - "tauri.conf.json" error on productName: "Tapir:Query" does not match "^[^/:*?\"<>|]+$"

Impact:

- No further app logs could be observed because Tauri exits during config validation.

Recommended fix:

- Keep branding in window title, but use a filesystem-safe productName (for example "Tapir Query").

## Findings and Recommendations

### P0 - Immediate Blockers

1. Invalid Tauri productName blocks local startup

- Evidence: src-tauri/tauri.conf.json productName is "Tapir:Query".
- Why it matters: all local dev and runtime checks are blocked.
- Fix:
  - Change productName to a valid value such as "Tapir Query".
  - Keep visual branding with colon in app.windows[0].title if desired.

### P1 - Security and Reliability

2. Capabilities are not least-privilege

- Evidence:
  - capabilities/default.json uses core:default, opener:default, dialog:default.
  - opener:default includes opening http/https/mailto/tel and reveal_item_in_dir.
- Why it matters:
  - If frontend is compromised, broad plugin permissions enlarge abuse surface.
- Fix:
  - Replace opener:default with narrower opener permissions or remove opener plugin entirely if unused.
  - Narrow dialog to only open/save as needed.
  - Replace core:default with explicit minimal core permissions needed by this app.

3. CSP disabled (csp: null)

- Evidence: src-tauri/tauri.conf.json app.security.csp is null.
- Why it matters:
  - Disables a major browser-side protection layer.
- Fix:
  - Define explicit CSP for production bundle.
  - Start with strict defaults and relax only required sources.

4. No backend cancellation propagation for long-running jobs

- Evidence:
  - Commands spawn blocking jobs and frontend drops stale results via requestToken.
  - Stale backend jobs still keep running until completion.
- Why it matters:
  - Wasteful CPU during rapid query edits and repeated runs.
  - Can amplify contention in unstable runtimes.
- Fix:
  - Introduce cancellable execution layer (query IDs + cooperative cancellation checks).
  - Consider single-flight/queue model per window or per service to avoid overlapping expensive jobs.

### P2 - Architecture and Clean Code

5. Session streaming path is currently dormant from primary flow

- Evidence:
  - QueryService run/open/sort all go through executeSqlDirect.
  - executeSqlWithSessionStreaming exists but is not called.
- Why it matters:
  - Dead or dormant orchestration code increases maintenance overhead and confusion.
- Fix options:
  - Option A: remove dormant streaming path until incident is closed.
  - Option B: gate by explicit feature flag and document mode switch clearly.

6. Native drop listener wiring currently attaches without ingestion handler

- Evidence:
  - AppComponent calls attachNativeDropListener() without handlers.
  - IngestionService only forwards file path when handlers.onFilePath exists.
- Why it matters:
  - Native listener may log events but not ingest files.
- Fix:
  - Pass onFilePath callback from AppComponent or remove unused listener path.

7. Panic surface in production bootstrap

- Evidence: src-tauri/src/lib.rs uses expect on app run.
- Why it matters:
  - Controlled panic is acceptable for fatal bootstrap, but still panic-based termination.
- Fix:
  - Prefer explicit error logging and process exit with code.

### P3 - Build Hygiene and Performance

8. Angular CSS budget warnings

- Evidence from ng build:
  - src/app/app.component.css exceeds budget by 718 bytes
  - src/app/features/data-table/data-table.component.css exceeds budget by 372 bytes
- Why it matters:
  - Warning noise obscures real regressions.
- Fix:
  - Either trim CSS or update realistic budget thresholds in angular.json.

9. Binary size optimization opportunities (Rust release profile)

- Current: no explicit [profile.release] tuning in src-tauri/Cargo.toml.
- Suggested profile:
  - lto = true
  - codegen-units = 1
  - strip = "symbols"
  - panic = "abort"
  - opt-level = "z" or 3 (benchmark both)

10. Startup latency opportunities

- Keep dynamic imports for Tauri-only modules (already partially done).
- Defer non-critical diagnostics/log initialization to first idle frame.
- Continue avoiding background COUNT(\*) on Tauri runtime while watchdog issue remains open.

11. Deprecated surfaces watchlist

- Dialog manifest contains deprecated alias permissions (ask/confirm aliases) in schema docs.
- Current app does not depend on deprecated aliases directly, but keep permission IDs explicit and modern when tightening capabilities.

## Memory Safety Assessment

Rust backend memory safety:

- No unsafe blocks observed in reviewed runtime modules.
- Mutex usage appears disciplined with lock scope kept short.
- Per-operation DuckDB connection approach avoids cross-thread connection lifetime hazards.

Residual risks:

- Session map growth if sessions are started and never closed under abnormal flows.
- No hard cap/TTL for sessions.

Recommended guardrails:

- Add max active sessions and idle TTL eviction.
- Expose diagnostics counters (active sessions, query queue depth, cancellation count).

## IPC and Contract Assessment

Strengths:

- Rust serde rename_all camelCase mapping aligns with TS contracts.
- Request/response DTOs are explicit and typed.
- Query rows are normalized to string/null before crossing IPC.

Optimization opportunities:

- Reduce command surface in active mode by hiding or feature-gating session commands if direct mode is canonical.
- Add contract-level version field for future migration safety.

## Suggested Implementation Plan

### Phase 1 (same day)

- Fix productName startup blocker.
- Tighten capability set (remove opener default if unused).
- Add clear architecture note about direct mode being active path.

### Phase 2 (1-2 days)

- Implement cancellable query orchestration.
- Add session TTL/cap guards.
- Decide and implement one mode policy:
  - direct-only for now, or
  - feature-flagged streaming.

### Phase 3 (2-4 days)

- Harden CSP for production.
- Tune Rust release profile and benchmark binary size/startup.
- Clean up CSS budget warnings and keep build output warning-clean.

## Verification Snapshot

Executed checks:

- pnpm ng build
  - Succeeded with two CSS budget warnings.
- cd src-tauri && cargo check
  - Succeeded without warnings.
- RUST_BACKTRACE=1 pnpm tauri:dev
  - Failed at config validation due invalid productName.

## Final Notes

The codebase is in a good trajectory: typed boundaries, clear layering, and practical incident mitigations are already present. The highest leverage now is hardening the security posture (capabilities + CSP), removing dormant complexity, and restoring warning-clean, reproducible startup behavior.
