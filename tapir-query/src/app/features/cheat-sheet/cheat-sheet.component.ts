import { CommonModule } from "@angular/common";
import { Component, input, output } from "@angular/core";

interface CheatItem {
  title: string;
  sql: string;
  note: string;
}

@Component({
  selector: "app-cheat-sheet",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./cheat-sheet.component.html",
  styleUrl: "./cheat-sheet.component.css",
})
export class CheatSheetComponent {
  readonly open = input(false);
  readonly closeRequested = output<void>();

  readonly items: CheatItem[] = [
    {
      title: "Quick Select",
      sql: "SELECT * FROM my_table LIMIT 100;",
      note: "Inspect a slice before writing full analysis queries.",
    },
    {
      title: "Targeted Filtering",
      sql: "SELECT * FROM my_table WHERE status = 'ACTIVE' AND amount > 1000;",
      note: "Combine exact filters first, then widen if needed.",
    },
    {
      title: "Aggregation",
      sql: "SELECT region, COUNT(*) AS rows, AVG(amount) AS avg_amount FROM my_table GROUP BY region ORDER BY rows DESC;",
      note: "Use grouped rollups to validate data balance across dimensions.",
    },
    {
      title: "Date Bucketing",
      sql: "SELECT date_trunc('month', order_date) AS month, SUM(amount) AS total FROM my_table GROUP BY month ORDER BY month;",
      note: "Monthly buckets are useful for trend sanity checks.",
    },
    {
      title: "Basic Join",
      sql: "SELECT o.order_id, c.customer_name FROM orders o LEFT JOIN customers c ON o.customer_id = c.customer_id;",
      note: "Alias tables for readability in cross-file analyses.",
    },
    {
      title: "CSV Registration Reminder",
      sql: "SELECT * FROM read_csv_auto('/absolute/path/to/file.csv', SAMPLE_SIZE=-1, IGNORE_ERRORS=true);",
      note: "Equivalent DuckDB function behind Tapir file registration.",
    },
  ];

  close(): void {
    this.closeRequested.emit();
  }
}
