### Der Engineering Prompt: UI Stability & Interaction Sync

**Role:** Senior Frontend Engineer & UI Specialist.
**Context:** Phase 5 (Context-First UI) is active. Now, we refine the **Data Grid interaction** and **Action Bar layout** to ensure maximum visual "calmness" and a seamless sync between UI-actions and SQL-code.

**1. Grid Header Refinement (Stability & Icons):**

- **Eliminate Layout Shifts:** Replace the text-based sort indicator ("ASC"/"DESC") with fixed-size **SVG Icons** (Arrow Up/Down). The column width must remain constant regardless of the sort state.
- **Filter Interaction:** Add a minimalist **Filter Icon** next to the Sort Icon in each header.
- **SQL Sync (The "Magic" Link):**
  - When a user clicks a Sort or Filter icon, the `QueryService` must automatically generate/update the corresponding SQL snippet in the **CodeMirror Editor**.
  - _Example:_ Clicking "Sort ASC" on column `amount` updates the editor to include `ORDER BY "amount" ASC`.
  - This requires a robust `SqlGeneratorService` that can parse/modify the current SQL string without destroying user-written custom logic.

**2. Layout Re-arrangement (Iconography & Primary Actions):**

- **Icon Grouping:** Move the **[Settings]** and **[Help/Cheat Sheet]** icons to the right side of the **[Columns]** toggle icon to create a logical "Metadata/Tools" cluster.
- **Command Center (Right Side):**
  - Add a prominent **[Execute]** button (Primary Action, styled in Soft Tapir-Blue). It must trigger the same logic as `Ctrl + Enter`.
  - Place the **[Export]** button directly below or adjacent to the Execute button, maintaining a clear "Action-Stack" on the right.

**3. Observability & Visual "Calmness" (Overlay System):**

- **Status Overlay Component:** Create a `GridStatusOverlayComponent`.
- **Behavior:** When a query is executing or a file is being opened, do **not** hide the grid and do **not** shift the layout by adding text below the query box.
- **Implementation:** Display the log/status text (e.g., "Executing query...", "Error: Syntax error near...") inside this overlay, positioned **absolutely over the top section of the grid**.
- **Aesthetic:** Use a semi-transparent background (blur effect) to keep the grid visible but "inactive" during processing. This maintains the visual anchor of the data.
