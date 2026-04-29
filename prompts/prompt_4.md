**Role:** Senior DevOps & Frontend Architect.
**Context:** Phase 3 is completed. We are now moving to **Phase 4: Production Readiness, Cleanup, and Advanced UI.**

**Task:** Perform the following actions based on the current state of **Tapir Query**.

**1. Repository Cleanup (Mobile & Legacy):**
* **Remove Mobile Artefacts:** Delete all Android and iOS related directories and configurations (e.g., `src-tauri/gen/android`, `src-tauri/gen/apple`, or any mobile-specific icons). Tapir Query is strictly a Desktop application.
* **Cleanup Samples:** Ensure the `fixtures:pull` script works as a one-time setup. Once the samples are generated for tests, the submodule should no longer be an active dependency for the build process.
* **General Housekeeping:** Remove any unused boilerplate code, legacy Karma/Jasmine files (if any remain), and temporary square-padding assets for the icons. The folder "prompts" has to stay untouched.

**2. Stability & File Access (Fixing Drag & Drop):**
* **Manual File Picker:** Implement a `FilePickerComponent` (or integrate into the existing shell). Use the Tauri `dialog` plugin to allow users to manually browse and select CSV files.
* **Drag & Drop Debugging:** Since "nothing happens," investigate if the Tauri `drag-drop` event is being intercepted by the WebView or if the `tauri.conf.json` permissions for file access are missing. Ensure the `LogService` captures the raw event from Tauri's `listen` API.

**3. Settings & Theming:**
* **Settings View:** Create a minimalist "Settings" modal or sidebar.
* **Theme Support:** Implement a theme-switching mechanism using Angular Signals.
    * **Default Theme:** "Soft Tapir" (Soft Slate Grays, Muted White, Anthracite accents).
    * **Dark Theme:** High-contrast for banking environments.
* **Design Philosophy:** Keep it "unexcited" and clean. Use soft transitions and professional typography.

**4. GitHub Actions (Release Pipeline):**
* **Release Workflow:** Create `.github/workflows/release.yml`.
    * **Trigger:** `workflow_dispatch` (manual) with an input field for the **Version** (e.g., `1.0.0`).
    * **Jobs:**
        * **Build Windows:** Generate `.exe` and `.msi`.
        * **Build Linux:** Generate `.deb` and `AppImage`.
    * **Changelog:** Automatically generate a `CHANGELOG.md` entry based on the commit history since the last tag.
    * **GitHub Release:** Create a draft release and upload the binaries as assets.

**5. Documentation & Metadata:**
* **Version Management:** Synchronize the version from the Action input with `package.json` and `src-tauri/tauri.conf.json` before building.
* **Update Markdowns:** Record all architectural changes (removal of mobile, new theme system, GitHub Action) in `@tapir-query-architecture.md` and `@tapir-query-vision.md`.

**Output Requirement:**
> Deliver the GitHub Action YAML first, followed by the Angular Theme Service and the Tauri Dialog/Picker implementation. Ensure the cleanup instructions are provided as a script or a clear file-list to delete.