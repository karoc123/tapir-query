**Role:** Senior Systems Engineer & Technical Writer.
**Context:** Phase 4 is nearly complete. The tool builds, but the development environment on Linux is hitting a symbol lookup error. Documentation needs a final "Professional Audit".

**Task:** Perform the following actions to ensure a smooth developer experience and a production-ready repository.

**1. Fix Dev-Mode (Linux/Snap Conflict):**
* **Analyze & Fix:** The error `undefined symbol: __libc_pthread_init` is a classic conflict between the Host GLIBC and the Snap-packaged libraries (often caused by VS Code or the environment inheriting `LD_LIBRARY_PATH` from a Snap).
* **Workaround Implementation:** * Update the `scripts` section in `package.json` for the `tauri dev` command to explicitly unset or sanitize the library path before running cargo. 
    * Example: `"tauri:dev": "unset LD_LIBRARY_PATH && tauri dev"`.
    * Provide a troubleshooting section in `README.md` for Linux users running into this Snap-related GLIBC conflict.

**2. Documentation Audit (Professional Polish):**
* **README.md (Root):**
    * Rewrite for an "Open Source Excellence" feel.
    * Add a "Quick Start" with three commands (Install, Pull Samples, Dev).
    * Include a "Performance" section highlighting the results of the Phase 3 benchmarks (DuckDB + Rust).
    * Add visual placeholders or instructions on how to use the "Soft Tapir" vs "Dark Banking" themes.
* **architecture.md:**
    * Ensure the diagram/description accurately reflects the **Angular 21 (Signals)** state and the **DuckDB Connection Pooling**.
    * Explicitly document the **IPC Protocol** (Tauri commands) and the **DTO (Data Transfer Object)** mapping between Rust and TS.
    * Record the decision to remain "Desktop-only" and the removal of mobile artifacts.

**3. Final Polish & Checklist:**
* **Release Checklist:** Create a `RELEASE_CHECKLIST.md` for the manual `workflow_dispatch`. 
    * Steps: Bump version, Pull Samples, Local Test Run, Trigger GitHub Action, Verify Binaries.
* **Cleanup:** Verify that `cleanup-desktop.sh` has removed all mobile traces and that no `ios/` or `android/` folders remain in `src-tauri`.

**4. Verification:**
* Ensure the **File Picker** (Tauri Dialog) is the primary CTA in the UI since Drag-and-Drop is currently being debugged via logs.
* Check that `theme.service.ts` correctly persists the chosen theme in `localStorage` or Tauri's store.

**Output Requirement:**
> Deliver the fix for the `ELIFECYCLE` error first (the shell command/config change). Then provide the polished `architecture.md` and `README.md`. Finally, provide the `RELEASE_CHECKLIST.md`.

Error:
OTE: Raw file sizes do not reflect development server per-request transformations.
  ➜  Local:   http://localhost:1420/
     Running DevCommand (`cargo  run --no-default-features --color always --`)
        Info Watching /home/karoc/dev/csv-analyzer/tapir-query/src-tauri for changes...
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.27s
     Running `target/debug/tapir-query`
target/debug/tapir-query: symbol lookup error: /snap/core20/current/lib/x86_64-linux-gnu/libpthread.so.0: undefined symbol: __libc_pthread_init, version GLIBC_PRIVATE
 ELIFECYCLE  Command failed.
 ELIFECYCLE  Command failed.