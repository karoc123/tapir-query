**Role:** Senior Full-Stack Developer / Platform Engineer.
**Context:** Phase 2 is stable. Now, we are entering Phase 3: **Infrastructure Overhaul, Performance Benchmarking, and Observability.**

**Task:** Perform the following upgrades and feature additions based on the current codebase and `@tapir-query-vision.md` / `@tapir-query-architecture.md`.

**1. Dependency & Framework Migration:**
* **Angular Upgrade:** Update the frontend from Angular 20 to **Angular 21**. Adjust all standalone components and signal-based logic to leverage any new stable features.
* **Test Framework Switch:** Migrate the frontend testing suite from **Karma/Jasmine to Jest**. 
    * Remove `karma.conf.js` and Jasmine-related types.
    * Configure `jest.config.js` and `setup-jest.ts`.
    * Ensure existing tests are compatible with Jest's syntax.
* **Git Submodules:** Add the repository `https://github.com/datablist/sample-csv-files` as a git submodule in the `/tests/fixtures` directory. Update the test runners to use these real-world samples for integration tests.

**2. Assets & Branding:**
* **Icon Integration:** Use the provided `icon.png` to generate all required app icons for Windows (`.ico`) and Linux (`.png` in various sizes) using the Tauri CLI (`tauri icon`). Ensure the `tauri.conf.json` points to the new assets.

**3. Observability & Logging (Fixing the "Silent Fail" Issue):**
* **Frontend Logger:** Implement a `LogService` in Angular that captures:
    * IPC communication errors.
    * File drop events and validation results.
    * Internal signal state changes.
* **Log Overlay/Viewer:** Add a "Log Console" drawer (toggleable) in the UI. When a user drops a file and "nothing happens," the logs must show the exact point of failure (e.g., "File access denied," "Invalid CSV format," "Tauri command timeout").
* **Backend Logging:** Ensure Rust errors are not just returned but also logged via `tracing` or `log` crates to the terminal during development.

**4. Performance Benchmarking:**
* **Telemetry:** Add high-resolution timers to the following processes:
    * **Bootup:** Time from app start to "Ready."
    * **File Load:** Time from file drop to schema detection.
    * **Query Execution:** Time for DuckDB to return a paginated chunk.
    * **Rendering:** Time to update the Virtual Grid.
* **Performance Dashboard:** Display these metrics in a small "DevTools" overlay or in the status bar to verify the "High-Performance" claim of the Vision document.

**5. Verification & Final Polish:**
* **README.md Update:** Reflect the changes in the test framework (Jest) and the new build/submodule requirements.
* **Bug Fix:** Investigate the "Drag & Drop" silence. Ensure the `DragDropDirective` correctly triggers the `FileService` and provides immediate visual feedback (Loading Spinner/Progress Bar).

**Output Requirement:**
> Deliver the migration scripts/configs and the refactored code for the Log-System and Performance metrics first. Ensure the `package.json` and `Cargo.toml` are correctly updated for the new versions.