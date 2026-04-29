**Role:** Senior UI/UX Architect & Angular Engineering Lead.
**Context:** The technical backend, fixed dev-mode, and documentation for **Tapir Query** are stable. We are now executing Phase 5: **A Radical UI Overhaul for Cognitive Relief.** The core philosophy is "Context-First" – only show what is needed *right now*. Use the unexcited "Soft Tapir" color palette.

**Task:** Refactor the entire frontend layout and component structure based on the specifications below, referencing `@tapir-query-vision.md` and `@tapir-query-architecture.md`.

**1. The Context-First Layout (Structural Changes):**
Implement a state-driven layout managed by a new `LayoutStateService` using Angular Signals.

* **Empty State (Default):** radicals minimalism.
    * Hide all sidebars, grids, and action headers.
    * Center of screen: Display only a large, dashed Drop-Zone with clear copy: "Drop CSV here or [Browse Files]". Use the manual File Picker as the main action.
* **Loaded State (After File Ingestion):**
    * Use CSS Grid to create three distinct zones:
        * **Zone A (Header - Action Bar):** Single row. Contains File Info (name, size), the SQL Editor (Search-bar style, auto-expanding on multi-line), and minimal buttons ([Export], [Settings], [?] for Cheat Sheet).
        * **Zone B (Sidebar - Schema):** Slim, collapsible sidebar (default: collapsed) showing column names and DuckDB types. Clicking a column name copies it to the SQL Editor.
        * **Zone C (Main - Data Grid):** Focus zone. The Virtualized Grid with minimalist styling (no heavy borders, soft row-highlighting on hover).
    * **Zone D (Footer - Status Bar):** Minimalist text: `X rows • Query took Y ms`.

**2. New Feature: DuckDB Cheat Sheet:**
* Create a standalone `CheatSheetComponent` (drawer or modal).
* Triggered by the `[?]` button in the Action Bar.
* Content: A curated list of common DuckDB operations tailored for CSV querying (e.g., `read_csv_auto()`, filtering, aggregation, basic joins). Keep it clean and readable.

**3. UX Fix: Professional Error Display:**
Refactor how SQL errors are displayed to the user. Do not show raw JSON.

* **Parsing Service:** Create an `ErrorParsingService`. Input: The raw error object from Tauri IPC. Output: A clean, user-friendly error DTO.
* **Error Component:** An inline panel below the SQL Editor (not a modal).
* **Implementation Example:** Given the following raw error from the prompt:
    ```json
    {
      "error": "sql error: failed to describe query: Parser Error: syntax error at or near \"Name\"\n\nLINE 1: ... SELECT * FROM (SELECT * FROM \"people_2000000\" where Last Name = \"Hart\") AS tapir_result\n                                                                          ^"
    }
    ```
    * **Do not show:** The JSON structure.
    * **Do show:** Extract the core message ("syntax error at or near 'Name'"). Crucially, display the full `LINE 1: ...` part, including the caret `^`, using a **monospace font** to maintain alignment and clearly indicate the error position.

**4. Architectural Rigor & Separation of Concerns:**
* ** Dumb Components:** View components must only render data provided by Signals. No business logic.
* **State Services:** All UI state transitions (e.g., opening/closing sidebars, setting error states, theme switching) must be handled by dedicated Angular Services using Signals. Follow DRY and SOLID.
* **DuckDB Decoupling:** Ensure the UI layer only communicates with the `QueryService` or `FileService`, never directly with DuckDB syntax concerns.

**5. Design Tokens & "Soft Tapir" Palette (styles.css):**
Define CSS Variables/Tailwind classes for the unexcited banking-grade aesthetic:
* **Backgrounds:** Light warm-grays/Off-whites (#F5F5F5) for default, deep anthracite (#2C3E50) for Dark Banking.
* **Text:** Primary Anthracite (#2C3E50), Errors in Muted Rost-Red.
* **Accents:** Soft Tapir-Gray-Blue (#5D6D7E) for active/focused elements.

**6. Test Foundation:**
* **Unit Tests:** Demand unit tests for the `ErrorParsingService` and the `LayoutStateService`. Verify the empty/loaded state transitions.
* **Component Tests:** Require tests ensuring that components render correctly based on Signal state changes. Fix existing `ng test` failures.

**Output Requirement:**
> Deliver the modular CSS variable definitions, the Signal-based Layout Service, and the revamped Error Parsing Service first. Ensure the `README.md` and `architecture.md` are updated to reflect the new state-driven UI paradigm.