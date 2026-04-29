## 1. Kernziele & Anforderungen
* **Performance:** Laden und Abfragen von CSV-Dateien > 1 GB in unter 2 Sekunden.
* **Portabilität:** Native Binaries für Windows (x64) und Linux (x86_64/AARCH64). Keine Abhängigkeiten wie Java oder Python-Runtimes.
* **Bedienung:** SQL-Eingabemaske für komplexe Abfragen und eine schnelle "Global Search".
* **Ressourceneffizienz:** Niedriger RAM-Verbrauch durch Streaming-Verarbeitung.

---

## 2. Der Tech-Stack (Vorschlag)
| Schicht | Technologie | Grund |
| :--- | :--- | :--- |
| **Framework** | **Tauri v2** | Kleinere Binaries und sicherer als Electron. |
| **Sprache (Backend)** | **Rust** | Performance-Kritische Operationen & Typsicherheit. |
| **Query Engine** | **DuckDB (Rust Crates)** | Industriestandard für analytische In-Process Abfragen. |
| **Frontend UI** | **React + Tailwind CSS** | Schnelle Entwicklung der UI-Komponenten. |
| **Data Grid** | **TanStack Table (Virtual)** | Flüssiges Scrollen durch Millionen von Datensätzen. |
| **Editor** | **CodeMirror 6** | Für die SQL-Eingabe mit Syntax-Highlighting. |

---

## 3. Funktionale Spezifikationen

### A. Daten-Import & Handling
* **Auto-Schema-Detection:** DuckDB soll Datentypen (Integer, Date, String) automatisch erkennen.
* **Delimiter-Support:** Automatische Erkennung von Komma, Semikolon, Tab und Pipe.
* **Encoding:** Unterstützung für UTF-8 und ISO-8859-1 (wichtig für Windows-Altlasten).

### B. Query-Features
* **Standard SQL:** `SELECT`, `WHERE`, `GROUP BY`, `JOIN` (über mehrere geöffnete CSVs hinweg!).
* **Export:** Ergebnisse der SQL-Abfragen direkt als neue CSV oder JSON exportieren.
* **History:** Speicherung der letzten 20 erfolgreichen Queries.

### C. UI/UX Komponenten
* **Sidebar:** Liste der geladenen Dateien und deren Spaltennamen (Schema-Browser).
* **Main View:** Split-Screen (Oben: SQL-Editor, Unten: Result-Grid).
* **Status Bar:** Anzeige von Dateigröße, Zeilenanzahl und Abfragezeit in Millisekunden.

---

## 4. Datenfluss-Architektur (Backend/Frontend)
1.  **Event:** User droppt Datei -> Frontend sendet Pfad an Rust via `tauri::command`.
2.  **Processing:** Rust öffnet eine DuckDB-Instanz und registriert die Datei als View.
3.  **Query:** User sendet SQL -> Rust führt `duckdb.query()` aus.
4.  **Transfer:** Ergebnisse werden als JSON-Chunks (oder effizienter via IPC-Binary) an das Frontend gestreamt.
5.  **Rendering:** Das Virtual-Grid zeigt nur die sichtbaren Zeilen an.

---

## 5. Meilensteine (MVP - Minimum Viable Product)
1.  **Phase 1:** Tauri-Grundgerüst aufsetzen und DuckDB in Rust einbinden.
2.  **Phase 2:** "Drag & Drop" von CSVs mit automatischer Tabellen-Vorschau.
3.  **Phase 3:** SQL-Eingabefeld implementieren und Ergebnisse im Grid rendern.
4.  **Phase 4:** Export-Funktion und Linux/Windows Build-Pipeline (GitHub Actions).