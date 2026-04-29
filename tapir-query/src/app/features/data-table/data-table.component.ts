import { CommonModule } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { afterRenderEffect, Component, computed, effect, inject, input, output } from "@angular/core";
import { PerfService } from "../../infrastructure/perf.service";
import { QueryRow } from "../../infrastructure/tauri-contracts";

export type SortDirection = "asc" | "desc";

export interface TableSortRequest {
  column: string;
  direction: SortDirection;
}

@Component({
  selector: "app-data-table",
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  templateUrl: "./data-table.component.html",
  styleUrl: "./data-table.component.css",
})
export class DataTableComponent {
  private readonly perf = inject(PerfService);

  readonly columns = input<string[]>([]);
  readonly rows = input<QueryRow[]>([]);
  readonly loading = input<boolean>(false);
  readonly sortColumn = input<string | null>(null);
  readonly sortDirection = input<SortDirection | null>(null);
  readonly visibleRowsChange = output<QueryRow[]>();
  readonly sortRequested = output<TableSortRequest>();

  readonly gridTemplateColumns = computed(() => {
    const count = Math.max(this.columns().length, 1);
    return `repeat(${count}, minmax(12rem, 1fr))`;
  });

  readonly rowCountLabel = computed(() => `${this.rows().length.toLocaleString()} rows`);

  constructor() {
    effect(() => {
      this.visibleRowsChange.emit(this.rows());
    });

    afterRenderEffect(() => {
      this.rows();
      this.perf.end("renderGrid");
    });
  }

  toggleSort(column: string): void {
    const nextDirection: SortDirection =
      this.sortColumn() === column && this.sortDirection() === "asc" ? "desc" : "asc";

    this.sortRequested.emit({
      column,
      direction: nextDirection,
    });
  }

  sortIndicator(column: string): string {
    if (this.sortColumn() !== column) {
      return "";
    }

    return this.sortDirection() === "asc" ? "ASC" : "DESC";
  }

  trackByIndex(index: number): number {
    return index;
  }
}