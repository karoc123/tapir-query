**Role:** Senior Full-Stack Developer.
**Context:** We are enhancing **Tapir:Query** with a persistent **Query History**. The goal is a minimalist "Quality of Life" feature that allows users to recall previous SQL commands without cluttering the "unexcited" UI.

**1. High-Level Anforderungen & Logik:**

- **Persistent Storage:** Implementiere eine Historie, die über Sitzungen hinweg erhalten bleibt. Nutze dafür den **Tauri Store** oder ein einfaches lokales JSON-File im App-Data-Verzeichnis.
- **Auto-Capture:** Jede erfolgreich ausgeführte Query (und nur erfolgreiche) soll automatisch in der Historie gespeichert werden.
- **Deduplizierung & Ranking:**
  - Identische Queries dürfen nicht doppelt vorkommen.
  - Wird eine bereits existierende Query erneut ausgeführt, rückt diese an die oberste Stelle ("Move-to-Top").
  - Begrenze die Historie auf die **letzten 50 Einträge**.
- **Interaktions-Modell:** Das Auswählen einer Query aus der Historie lädt den Text lediglich in den SQL-Editor. Eine automatische Ausführung darf **nicht** erfolgen (Sicherheitsaspekt).

**2. UI/UX Integration (Soft Tapir Style):**

- **Trigger:** Platziere ein dezentes "History"-Icon (z.B. eine Uhr) unmittelbar links neben oder innerhalb des SQL-Eingabefelds.
- **Dropdown-Menü:** Bei Klick öffnet sich ein minimalistisches, absolut positioniertes Overlay.
  - **Darstellung:** Zeige die Queries einzeilig gekürzt an. Der vollständige Text erscheint bei Hover als Tooltip.
  - **Zeitstempel:** Füge jedem Eintrag einen dezenten, relativen Zeitstempel (z.B. "vor 10 Min") hinzu.
- **Visuals:** Das Dropdown muss sich nahtlos in die bestehende Farbpalette einfügen (keine harten Schatten, weiche Kanten, dezente Hover-Effekte).

**3. Architektonische Vorgaben:**

- **HistoryService (Angular):** Kapsle die gesamte Logik (Laden, Speichern, Bereinigen) in einem dedizierten Service unter Verwendung von Angular Signals.
- **Backend-Bridge (Rust):** Implementiere die notwendigen Tauri-Commands zum Lesen und Schreiben der Historie im lokalen Dateisystem, um die Datenintegrität sicherzustellen.
- **Performance:** Das Laden der Historie darf den App-Start nicht verzögern. Nutze asynchrone Dateioperationen im Rust-Backend.
- **Entkoppelung:** Der `HistoryService` sollte über Events oder Signals mit dem `QueryService` kommunizieren, ohne die bestehende Query-Logik zu verkomplizieren.

**4. Qualitätssicherung:**

- Erstelle Unit-Tests für den `HistoryService`, die das Deduplizierungs-Verhalten und das Limit von 50 Einträgen verifizieren.
- Stelle sicher, dass ungültige oder fehlerhafte Queries die Historie nicht "verschmutzen".
