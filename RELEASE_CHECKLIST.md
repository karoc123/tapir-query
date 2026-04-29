# Release Checklist

Use this checklist before running the manual GitHub release workflow.

## 1. Bump Version

- Decide release version (example: `1.0.0`).
- Confirm the same version will be used for:
  - `tapir-query/package.json`
  - `tapir-query/src-tauri/tauri.conf.json`
  - `tapir-query/src-tauri/Cargo.toml`
- Ensure release notes scope (commits since last tag) is understood.

## 2. Pull Samples

```bash
cd tapir-query
pnpm fixtures:pull
```

- Verify fixture files exist in `tapir-query/tests/fixtures/downloads/`.

## 3. Local Test Run

```bash
cd tapir-query
pnpm test
pnpm ng build
cd src-tauri
cargo test
```

- Optional full packaging smoke test:

```bash
cd tapir-query
pnpm tauri build
```

## 4. Trigger GitHub Action

- Open GitHub Actions.
- Run workflow: `.github/workflows/release.yml`.
- Use `workflow_dispatch` and provide the release `version` input.

## 5. Verify Binaries

- Confirm all expected artifacts are attached to the draft release:
  - Windows: `.msi`, `.exe` (NSIS)
  - Linux: `.deb`, `.AppImage`
- Validate draft release title/tag/version alignment.
- Sanity-install at least one Linux package locally when possible.
- Publish release only after verification completes.
