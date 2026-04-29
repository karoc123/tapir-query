# Vision Document: Tapir Query

## 1. Executive Summary
**Tapir Query** is an open-source, high-performance CSV analysis tool designed for professionals who need to explore, query, and transform large datasets without the overhead of heavy BI software. Built with Rust and DuckDB, it serves as a lightweight, cross-platform alternative to legacy plugins, offering a "no-nonsense" approach to data inspection.

## 2. Core Philosophy: The "Unexcited" Tool
In an era of bloated software and complex cloud platforms, Tapir Query follows the philosophy of an **unexcited tool**:
* **Quiet & Reliable:** It starts instantly and performs predictably.
* **Local-First:** Data stays on the machine—critical for sensitive banking and financial environments.
* **Focused:** It doesn't try to be a spreadsheet or a database manager; it is a lens for CSV data.

## 3. Target Audience
* **Financial Analysts:** Users who deal with massive transaction logs and reconciliation files.
* **Software Engineers:** Developers needing a quick SQL interface for local flat files.
* **Data Auditors:** Professionals requiring a fast way to validate data integrity across millions of rows.

## 4. Key Capabilities
### Current Focus (MVP)
* **High-Velocity Ingestion:** Loading gigabyte-scale CSVs in seconds using DuckDB’s vectorized engine.
* **SQL-Powered Exploration:** Full SQL support (SELECT, JOIN, GROUP BY) to query CSVs as if they were relational databases.
* **Cross-Platform Consistency:** A unified experience across Linux and Windows via Tauri.
* **Seamless Export:** Refining data through queries and exporting the results back to clean CSV files.

### Future Roadmap
* **Frequency Analysis:** One-click statistics for column distributions and outliers.
* **Lightweight Visualization:** Instant, unbloated charts (Bar, Line, Scatter) to identify patterns visually.
* **Schema Inference:** Smart detection of types, dates, and currencies tailored for financial datasets.

## 5. Technical Excellence
By leveraging **Rust** for safety and speed, **Tauri** for a slim desktop footprint, and **DuckDB** for analytical power, Tapir Query aims to outperform existing text-editor plugins while providing a modern, developer-friendly interface.

## 6. Open Source & Community
Tapir Query is built to be extended. As an open-source project, it encourages transparency—a vital trait for tools used in infrastructure-critical sectors like banking.