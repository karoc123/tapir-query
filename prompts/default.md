**Context:** I am developing **Tapir Query**, an open-source, high-performance CSV analyzer. I have updated my choice to use **Angular (latest, Standalone, Signals)** for the frontend to ensure a strict, maintainable architecture.

**Task:** Act as a Full-Stack Architect. Based on `vision.md` and `architecture.md`, generate the initial codebase, documentation, and testing suite.

**1. Documentation Updates:**
* Update `vision.md` and `architecture.md` to reflect the switch to **Angular** and the **Tauri v2** framework.
* Ensure the architecture highlights the "unexcited" design and "local-first" data handling.

**2. Project Structure & Build System:**
* Create a **README.md** with clear instructions on:
   * How to install dependencies (Rust, Node.js).
   * How to run the app in development mode (`npm run tauri dev`).
   * How to build the production executable (e.g., `.exe` for Windows) using `npm run tauri build`.
   * How to execute backend tests (`cargo test`) and frontend tests (`ng test`).

**3. Backend (Rust & DuckDB):**
* Implement a modular structure:
   * `src-tauri/src/engine`: Trait-based DuckDB wrapper to execute SQL on CSV paths.
   * `src-tauri/src/commands`: Tauri commands for `open_file`, `execute_query`, and `export_csv`.
* Use **Streaming** logic to handle files 1GB without crashing.
* Include at least one **Unit Test** in Rust that validates the SQL generation for a sample CSV schema.

**4. Frontend (Angular & Tailwind):**
* Implement a **TauriBridgeService** (Infrastructure Layer) to abstract IPC calls.
* Create a **DataTableComponent** (UI Layer) using:
   * **Angular Signals** for state management (rows, loading state, current query).
   * **Drag-and-Drop** directive to handle file imports.
   * **TanStack Table (or similar)** logic for virtualized scrolling, sorting, and filtering.
* Implement a simple **SQL Editor** component (using a lightweight textarea or CodeMirror).

**5. End-to-End Workflow Implementation:**
* The app must allow: Opening a CSV -Viewing in a Grid -Writing a SQL filter (e.g., `WHERE amount 1000`) -Seeing updated results -Exporting to a new CSV.

**Quality Standards:**
* Follow **DRY, KISS, and Separation of Concerns**.
* Use **Strict Typing** in TypeScript and Rust.
* Ensure the UI is clean and professional (Banking-grade).

Make yourself a detailed plan before you start and ASK ME for clarifications. You are running inside VS-Code on a Linux setup.