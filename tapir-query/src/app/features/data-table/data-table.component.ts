import { CommonModule } from "@angular/common";
import { ScrollingModule } from "@angular/cdk/scrolling";
import { afterRenderEffect, Component, computed, ElementRef, HostListener, inject, input, output, signal } from "@angular/core";
import { PerfService } from "../../infrastructure/perf.service";
import { QueryRow } from "../../infrastructure/tauri-contracts";
import type { FilterIntent, FilterOperator } from "../../domain/sql-generator.service";

export type SortDirection = "asc" | "desc";

export interface TableSortRequest {
  column: string;
  direction: SortDirection;
}

interface FilterOperatorOption {
  value: FilterOperator;
  label: string;
}

interface FilterEditorDraft {
  columnName: string;
  operator: FilterOperator;
  value: string;
}

const FILTER_OPERATOR_OPTIONS: FilterOperatorOption[] = [
  { value: "equals", label: "Equals (=)" },
  { value: "notEquals", label: "Not equal (!=)" },
  { value: "greaterThan", label: "Greater than (>)" },
  { value: "greaterOrEqual", label: "Greater or equal (>=)" },
  { value: "lessThan", label: "Less than (<)" },
  { value: "lessOrEqual", label: "Less or equal (<=)" },
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
  { value: "endsWith", label: "Ends with" },
];

@Component({
  selector: "app-data-table",
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  templateUrl: "./data-table.component.html",
  styleUrl: "./data-table.component.css",
})
export class DataTableComponent {
  private readonly perf = inject(PerfService);
  private readonly hostElement = inject(ElementRef<HTMLElement>);

  readonly columns = input<string[]>([]);
  readonly rows = input<QueryRow[]>([]);
  readonly totalRows = input<number>(0);
  readonly windowStartOffset = input<number>(0);
  readonly loading = input<boolean>(false);
  readonly sortColumn = input<string | null>(null);
  readonly sortDirection = input<SortDirection | null>(null);
  readonly sortRequested = output<TableSortRequest>();
  readonly filterRequested = output<FilterIntent>();
  readonly viewportIndexChange = output<number>();

  private readonly filterEditorDraft = signal<FilterEditorDraft | null>(null);

  readonly filterOperatorOptions = FILTER_OPERATOR_OPTIONS;

  readonly activeFilterOperator = computed(() => this.filterEditorDraft()?.operator ?? "equals");
  readonly activeFilterValue = computed(() => this.filterEditorDraft()?.value ?? "");
  readonly isFilterApplyDisabled = computed(() => (this.filterEditorDraft()?.value.trim().length ?? 0) === 0);

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

  toggleFilterEditor(column: string): void {
    const active = this.filterEditorDraft();
    if (active?.columnName === column) {
      this.filterEditorDraft.set(null);
      return;
    }

    this.filterEditorDraft.set({
      columnName: column,
      operator: "equals",
      value: "",
    });
  }

  closeFilterEditor(): void {
    this.filterEditorDraft.set(null);
  }

  isFilterOpen(column: string): boolean {
    return this.filterEditorDraft()?.columnName === column;
  }

  onFilterOperatorChanged(event: Event): void {
    const active = this.filterEditorDraft();
    if (!active) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const operator = this.parseFilterOperator(target.value);
    if (operator === null) {
      return;
    }

    this.filterEditorDraft.set({
      ...active,
      operator,
    });
  }

  onFilterValueInput(event: Event): void {
    const active = this.filterEditorDraft();
    if (!active) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.filterEditorDraft.set({
      ...active,
      value: target.value,
    });
  }

  applyActiveFilter(): void {
    const active = this.filterEditorDraft();
    if (!active) {
      return;
    }

    const value = active.value.trim();
    if (!value) {
      return;
    }

    this.filterRequested.emit({
      columnName: active.columnName,
      operator: active.operator,
      value,
    });

    this.filterEditorDraft.set(null);
  }

  isSortActive(column: string, direction: SortDirection): boolean {
    return this.sortColumn() === column && this.sortDirection() === direction;
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent): void {
    if (this.filterEditorDraft() === null) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (this.hostElement.nativeElement.contains(target)) {
      return;
    }

    this.filterEditorDraft.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscapeKey(): void {
    if (this.filterEditorDraft() !== null) {
      this.filterEditorDraft.set(null);
    }
  }

  trackByAbsoluteIndex(_index: number, rowIndex: number): number {
    return rowIndex;
  }

  private parseFilterOperator(value: string): FilterOperator | null {
    const allowed = new Set<FilterOperator>(["equals", "notEquals", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "contains", "startsWith", "endsWith"]);

    return allowed.has(value as FilterOperator) ? (value as FilterOperator) : null;
  }
}
