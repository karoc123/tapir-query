**Role:** Senior Systems Architect.
**Context:** We are expanding **Tapir:Query** with a dedicated **Data Analysis Plugin**. The goal is a high-performance, non-blocking analytical layer for large-scale CSV audits.

**1. High-Level Requirements & Plugin-Architektur:**

- **Decoupled Plugin Architecture:** Das Analyse-Modul muss vollständig vom Kern-Query- und Grid-Prozess isoliert sein. Es agiert als "On-Demand"-Erweiterung, deren Aktivierung keine Seiteneffekte auf die Stabilität der Hauptanwendung hat.
- **Exact Data Profiling (No Sampling):** Alle Metriken (Kardinalität, Vollständigkeit, String-Längen) müssen auf dem **vollständigen aktiven Datensatz** der aktuellen Query basieren. Exaktheit ist für Compliance-Prüfungen zwingend erforderlich.
- **Responsive Split-View:** Bei Aktivierung transformiert sich das UI in ein Split-Screen-Layout:
  - **Obere Hälfte:** Profiling-Dashboard mit grafischen Auswertungen pro Spalte.
  - **Untere Hälfte:** Bestehende Datentabelle zur parallelen Referenzierung.

**2. Asynchrones & Inkrementelles Berechnungsmodell:**

- **Non-Blocking Execution:** Die Berechnung der Metriken muss vollständig asynchron im Hintergrund erfolgen. Der Nutzer darf währenddessen uneingeschränkt in der Tabelle scrollen, Daten sortieren oder neue SQL-Queries verfassen.
- **Incremental Data Arrival:** Ergebnisse sollen nicht als ein großer Block, sondern "nach und nach" (per Spalte oder Metrik-Typ) im UI eintreffen, sobald sie vom Backend berechnet wurden.
- **Granulare Loading-States:** Jede visuelle Komponente (Diagramm/Karte) muss einen eigenen Loading-Indikator anzeigen, solange die spezifischen Daten dafür noch berechnet werden. Sobald ein Wert vorliegt, wird der Indikator durch die Visualisierung ersetzt.

**3. Analytischer Scope (Pro Spalte):**

- **Kardinalitäts-Analyse:** Häufigkeit eindeutiger Werte ("Top 10") zur Identifikation dominanter Partner oder Formatierungsfehler.
- **Vollständigkeits-Audit:** Verhältnis von befüllten Feldern zu NULL/Leerwerten zur Prüfung von Pflichtfeld-Vorgaben.
- **String-Längen-Profil:** Histogramm der Zeichenlängen zur Aufdeckung von Ausreißern (z. B. extrem kurze oder lange Einträge in Feldern wie IBAN oder Verwendungszweck).

**4. Architektonische Leitplanken:**

- **Reactive State Management:** Der Fortschritt der Hintergrundberechnungen und die inkrementelle Datenübergabe müssen über ein robustes Signal-basiertes State-Management gesteuert werden.
- **Concurrency Handling:** Das Backend muss in der Lage sein, Analyse-Anfragen parallel zum Grid-Datenstrom zu verarbeiten, ohne die DuckDB-Verbindung für die UI-Interaktionen zu blockieren.
- **Visual Consistency:** Die Grafiken folgen dem "Soft Tapir"-Design (minimalistisch, funktional, professionelle Farbpalette).

**5. Qualität & Performance:**

- Die Performance-Metriken der App sollen die Berechnungsdauer der Profiling-Tasks separat erfassen.
- Erweitere die Test-Suite um Prüfungen für die korrekte asynchrone Abfolge und die mathematische Präzision der Ergebnisse.
