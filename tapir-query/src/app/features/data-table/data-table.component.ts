import { CommonModule } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { afterRenderEffect, Component, computed, inject, input, output } from "@angular/core";
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
  readonly totalRows = input<number>(0);
  readonly windowStartOffset = input<number>(0);
  readonly loading = input<boolean>(false);
  readonly sortColumn = input<string | null>(null);
  readonly sortDirection = input<SortDirection | null>(null);
  readonly sortRequested = output<TableSortRequest>();
  readonly filterRequested = output<string>();
  readonly viewportIndexChange = output<number>();

  readonly gridTemplateColumns = computed(() => {
    const count = Math.max(this.columns().length, 1);
    return `repeat(${count}, minmax(12rem, 1fr))`;
  });

  readonly rowCountLabel = computed(() => `${this.rows().length.toLocaleString()} rows`);

  readonly rowIndexes = computed(() => Array.from({ length: this.totalRows() }, (_, index) => index));

  constructor() {
    afterRenderEffect(() => {
      this.rows();
      this.perf.end("renderGrid");
    });
  }

  rowForIndex(rowIndex: number): QueryRow | null {
    const localIndex = rowIndex - this.windowStartOffset();
    if (localIndex < 0 || localIndex >= this.rows().length) {
      return null;
    }

    return this.rows()[localIndex] ?? null;
  }

  onViewportIndexChanged(index: number): void {
    this.viewportIndexChange.emit(index);
  }

  toggleSort(column: string): void {
    const nextDirection: SortDirection = this.sortColumn() === column && this.sortDirection() === "asc" ? "desc" : "asc";

    this.requestSort(column, nextDirection);
  }

  requestSort(column: string, direction: SortDirection): void {
    this.sortRequested.emit({
      column,
      direction,
    });
  }

  requestFilter(column: string): void {
    this.filterRequested.emit(column);
  }

  isSortActive(column: string, direction: SortDirection): boolean {
    return this.sortColumn() === column && this.sortDirection() === direction;
  }

  trackByAbsoluteIndex(_index: number, rowIndex: number): number {
    return rowIndex;
  }
}
