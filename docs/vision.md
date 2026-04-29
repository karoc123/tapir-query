# Vision Document: Tapir Query

## 1. Executive Summary

Tapir Query is an open-source, high-performance CSV analysis application for professionals who need to inspect and transform large flat files without heavyweight BI platforms. It combines Rust, DuckDB, Tauri v2, and Angular (Standalone + Signals) to deliver a fast, strict, and maintainable desktop tool.

## 2. Product Philosophy: The Unexcited Tool

Tapir Query follows the philosophy of an unexcited tool: calm, predictable, and focused.

- Quiet and reliable: Startup and query execution should feel instant for common workflows.
- Local-first by default: Sensitive data never needs to leave the machine.
- Operational focus: It is not a spreadsheet replacement, but a precise lens for CSV data quality and exploration.

## 3. Target Users

- Financial analysts working with reconciliation logs, booking exports, and transaction archives.
- Software engineers who need SQL over local files for debugging and data checks.
- Data auditors validating consistency and integrity over millions of rows.

## 4. MVP Capabilities

- High-velocity ingestion: Register and scan gigabyte-scale CSV files through DuckDB.
- Native desktop file picking: Select CSV files via OS dialog in addition to drag-and-drop.
- SQL-first exploration: Run ad hoc SQL (`SELECT`, `WHERE`, `GROUP BY`, `JOIN`) against loaded files.
- Chunked result handling: Stream query results in predictable pages to keep memory stable.
- Cross-platform desktop delivery: Consistent behavior across Linux and Windows with Tauri v2.
- Fast export workflow: Persist filtered query results into new CSV artifacts.

## 5. Design Principles

- Local-first data handling: All parsing, querying, and export operations run on the local host process.
- Deterministic behavior: Explicit query execution, clear loading states, and measured response times.
- Strict architecture: Separation of concerns between UI components, frontend infrastructure services, and backend engine modules.
- Performance aware UX: Virtualized tables and paged IPC transfer to avoid UI freezes.

## 6. Technical Direction

- Backend: Rust command layer with a trait-driven DuckDB engine wrapper.
- Frontend: Angular latest (Standalone APIs + Signals) with typed service boundaries.
- UI personalization: persisted theme profiles with a lightweight settings surface.
- Runtime: Tauri v2 shell for low-overhead desktop binaries.
- Data engine: DuckDB embedded execution for analytical SQL over CSV files.

## 7. Delivery Readiness Direction

- Repeatable manual release flow through GitHub Actions with generated changelog sections.
- Platform-targeted Linux and Windows bundles packaged from synchronized version metadata.

## 8. Open Source Commitment

Tapir Query is built for transparency and extension. A clear architecture and testable modules make the project suitable for regulated and infrastructure-critical environments.
