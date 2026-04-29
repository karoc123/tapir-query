**Role:** Senior Software Architect & Lead Developer.
**Context:** The baseline for **Tapir Query** is functional. Dependency issues are resolved. Now, we move to Phase 2: **Refactoring for Excellence, Verification, and Feature Completion.**

**Task:** Perform a comprehensive cleanup and enhancement pass based on the existing code and `@tapir-query-vision.md` / `@tapir-query-architecture.md`.

**1. Refactoring & Code Quality (DRY/KISS):**
* **Backend (Rust):**    * Audit the `DuckDbEngine` implementation. Ensure error handling is exhaustive—map all DuckDB and IO errors to our custom `AppError` enum using `thiserror`.
   * Refine the `QueryEngine` trait to ensure it is fully decoupled from the Tauri command layer.
   * Optimize the connection pooling for DuckDB to ensure thread-safety during concurrent queries.
* **Frontend (Angular):**
   * Move business logic from `app.component.ts` into specialized **domain services** (e.g., `QueryService`, `FileService`).
   * Strengthen **Signal-based state management**: Ensure all state transitions (Loading -Success/Error) are atomic and predictable.
   * Improve typing: Replace any `any` types in the IPC layer with strict TypeScript interfaces derived from the Rust DTOs.
   * Write a .gitignore for the project.

**2. Feature Completion (UX & Professionalism):**
* **SQL Editor:** Replace the basic textarea with **CodeMirror 6**. Add SQL syntax highlighting and basic "Enter to execute" (Cmd/Ctrl + Enter) support.
* **Schema Sidebar:** Implement a sidebar component that displays the columns and detected types of the currently loaded CSV (fetched via DuckDB's `DESCRIBE` or `PRAGMA table_info`).
* **Query History:** Implement a simple persistence layer (using Tauri's `AppConfig` or a local file) to store and retrieve the last 20 successful SQL queries.

**3. Verification & Testing:**
* **Backend Tests:** Expand `cargo test` to include edge cases: empty CSVs, CSVs with special characters in headers, and invalid SQL syntax.
* **Frontend Tests:** Fix existing test failures. Implement a "MockTauriService" for Angular unit tests to verify that the UI reacts correctly to backend error responses.
* **E2E Flow:** Verify the "Export" functionality ensures that the exported CSV matches the filtered/sorted state of the DuckDB view.

**4. Documentation Sync:**
* Review and update `README.md`. Ensure the "Build & Test" section is 100% accurate given the resolved dependency issues.
* Document the IPC protocol (Tauri commands vs. Angular events) within `@tapir-query-architecture.md`.

**Output Requirement:** Provide the refactored code in modular chunks. Prioritize clean interfaces and remove any "placeholder" logic. Ensure the "unexcited" banking-grade aesthetic is maintained in the UI.
