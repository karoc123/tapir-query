**Role:** Principal Software Architect.
**Context:** We are finalizing Phase 5. The focus shifts to **Infrastructure Reliability** (Fixing the Drag 'n Drop event-loop), **Async Performance Patterns**, and **Strict Clean Code**

**Task:** Refactor and extend the application based on the following architectural requirements.

**1. Reliable Ingestion Infrastructure (Event-Bridge):**

- **The Problem:** Drag 'n Drop events are not reaching the domain layer reliably.
- **Requirement:** Implement a robust **Global Event Listener Pattern**. Instead of component-level listeners, use the Tauri Window API to capture file-drop events at the highest level.
- **Clean Code:** Ensure proper cleanup (Unsubscribe/Off) of these listeners to prevent memory leaks.

**2. Query-Builder Pattern (Filter Interaction):**

- **Interaction:** When a Filter-Icon is triggered, the UI must prompt for a value.
- **Architecture:** Implement an **Intent-to-SQL-Transform** pattern. The UI emits a `FilterIntent` (Column, Value, Operator). A domain-level `SqlGenerator` intercepts this and performs a non-destructive injection into the existing SQL state (handling `WHERE` clauses and existing conditions correctly).

**3. Async Performance UI (The Status-Bar Counter):**

- **Requirement:** Display "X of Y Rows" in the status bar.
- **Pattern:** Use the **Background-Count Pattern**.
  - The main data query must remain fast.
  - After the main data is fetched, trigger a separate, low-priority `SELECT COUNT(*)` query for both the filtered and the total dataset.
  - **Reactive State:** Use Signals to manage these counts. If the total count is pending, display a `LoadingIndicator`.
- **Clean Code:** Encapsulate this logic in a `DatasetMetricsService` so the Table-Component remains "dumb" and only displays the final numbers.

**4. Layout & Branding:**

- **Full-Height Layout:** Refactor the CSS architecture to ensure the Data Table occupies **100% of the remaining vertical space** using a flex-box or CSS-grid "sticky footer" pattern. Avoid fixed-pixel heights.
- **Branding:** Update the application identity across all platforms to **"Tapir:Query"**. This applies to the Window Title, Taskbar identifiers, and metadata.

**5. Testing & Quality Assurance (Expert-Level Coverage):**

- **Strategy:** Shift focus from "Does it render?" to **"Does the logic hold?"**.
- **Services:** Increase test coverage for the `SqlGenerator` (verify complex JOIN/WHERE merges) and the `IngestionService` (mocking Tauri events).
- **Edge Cases:** Implement tests for malformed SQL inputs, extremely large row counts (overflow handling)

Fixe diese Warnungen im Build:
prepare-changelog
Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/checkout@v4, actions/upload-artifact@v4. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026. Please check if updated versions of these actions are available that support Node.js 24. To opt into Node.js 24 now, set the FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true environment variable on the runner or in your workflow file. Once Node.js 24 becomes the default, you can temporarily opt out by setting ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
build-linux
Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4, pnpm/action-setup@v4. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026. Please check if updated versions of these actions are available that support Node.js 24. To opt into Node.js 24 now, set the FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true environment variable on the runner or in your workflow file. Once Node.js 24 becomes the default, you can temporarily opt out by setting ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
build-windows
Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4, pnpm/action-setup@v4. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026. Please check if updated versions of these actions are available that support Node.js 24. To opt into Node.js 24 now, set the FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true environment variable on the runner or in your workflow file. Once Node.js 24 becomes the default, you can temporarily opt out by setting ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
create-release
Node.js 20 actions are deprecated. The following actions are running on Node.js 20 and may not work as expected: actions/download-artifact@v4, softprops/action-gh-release@v2. Actions will be forced to run with Node.js 24 by default starting June 2nd, 2026. Node.js 20 will be removed from the runner on September 16th, 2026. Please check if updated versions of these actions are available that support Node.js 24. To opt into Node.js 24 now, set the FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true environment variable on the runner or in your workflow file. Once Node.js 24 becomes the default, you can temporarily opt out by setting ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

Make yourself a plan before you start and ASK ME FOR CLARIFICATION IF ANY REQUIREMENT IS UNCLEAR. This is a complex task that requires careful architectural consideration. You are running inside VS-Code with access to the full codebase. Use your tools wisely, and ensure that your changes are cohesive and maintainable.
