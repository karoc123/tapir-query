import { CommonModule } from "@angular/common";
import { afterNextRender, Component, computed, effect, inject, OnDestroy } from "@angular/core";
import { DatasetMetricsService } from "./domain/dataset-metrics.service";
import { FileService } from "./domain/file.service";
import { QueryService } from "./domain/query.service";
import type { FilterOperator } from "./domain/sql-generator.service";
import { CheatSheetComponent } from "./features/cheat-sheet/cheat-sheet.component";
import { DataTableComponent, TableSortRequest } from "./features/data-table/data-table.component";
import { DragDropDirective } from "./features/drag-drop/drag-drop.directive";
import { FilePickerComponent } from "./features/file-picker/file-picker.component";
import { GridStatusOverlayComponent } from "./features/grid-status-overlay/grid-status-overlay.component";
import { QueryErrorPanelComponent } from "./features/query-error-panel/query-error-panel.component";
import { SchemaSidebarComponent } from "./features/schema-sidebar/schema-sidebar.component";
import { SettingsPanelComponent } from "./features/settings-panel/settings-panel.component";
import { SqlEditorComponent } from "./features/sql-editor/sql-editor.component";
import { LayoutStateService } from "./infrastructure/layout-state.service";
import { LogService } from "./infrastructure/log.service";
import { PerfService } from "./infrastructure/perf.service";
import { AppTheme, ThemeService } from "./infrastructure/theme.service";

@Component({
  selector: "app-root",
  imports: [
    CommonModule,
    CheatSheetComponent,
    DataTableComponent,
    DragDropDirective,
    FilePickerComponent,
    GridStatusOverlayComponent,
    QueryErrorPanelComponent,
    SchemaSidebarComponent,
    SettingsPanelComponent,
    SqlEditorComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnDestroy {
  private readonly fileService = inject(FileService);
  private readonly queryService = inject(QueryService);
  private readonly datasetMetricsService = inject(DatasetMetricsService);
  private readonly layoutState = inject(LayoutStateService);
  private readonly logsService = inject(LogService);
  private readonly perfService = inject(PerfService);
  private readonly themeService = inject(ThemeService);

  private readonly unlistenNativeDropEvents: Array<() => void> = [];

  readonly loading = this.queryService.loading;
  readonly currentFilePath = this.fileService.currentFilePath;
  readonly currentFileName = this.fileService.currentFileName;
  readonly currentFileSizeLabel = this.fileService.currentFileSizeLabel;
  readonly currentTable = this.fileService.currentTable;
  readonly schemaColumns = this.fileService.schemaColumns;
  readonly query = this.queryService.query;
  readonly queryError = this.queryService.queryError;
  readonly columns = this.queryService.columns;
  readonly rows = this.queryService.rows;
  readonly totalRowCount = this.queryService.totalRowCount;
  readonly windowStartOffset = this.queryService.windowStartOffset;
  readonly effectiveSql = this.queryService.effectiveSql;
  readonly lastQueryElapsedMs = this.queryService.lastQueryElapsedMs;
  readonly statusMessage = this.queryService.statusMessage;
  readonly showSlowLoadHint = this.queryService.showSlowLoadHint;
  readonly activeSortColumn = this.queryService.activeSortColumn;
  readonly activeSortDirection = this.queryService.activeSortDirection;
  readonly logEntries = this.logsService.entries;

  readonly isEmptyLayout = this.layoutState.isEmpty;
  readonly isLoadedLayout = this.layoutState.isLoaded;
  readonly schemaCollapsed = this.layoutState.schemaCollapsed;
  readonly cheatSheetOpen = this.layoutState.cheatSheetOpen;

  readonly activeTheme = this.themeService.theme;
  readonly settingsOpen = this.themeService.settingsOpen;
  readonly themeOptions = this.themeService.options;
  readonly defaultExportPath = "exports/query-results.csv";
  readonly totalCountPending = computed(() => this.datasetMetricsService.hasActiveSignature() && this.datasetMetricsService.totalPending());

  readonly rowStatusLabel = computed(() => {
    const visibleRows = this.rows().length;
    const hasMoreInWindow = this.totalRowCount() > visibleRows;
    const visibleLabel = `${visibleRows.toLocaleString()}${hasMoreInWindow ? "+" : ""}`;

    if (this.datasetMetricsService.hasActiveSignature()) {
      if (this.datasetMetricsService.filteredCount() !== null || this.datasetMetricsService.filteredPending()) {
        return this.datasetMetricsService.rowStatusLabel();
      }

      if (this.datasetMetricsService.totalPending() || this.datasetMetricsService.totalCount() === null) {
        return `${visibleLabel} of Loading... Rows`;
      }

      return `${visibleLabel} of ${this.datasetMetricsService.totalCount()!.toLocaleString()} Rows`;
    }

    if (hasMoreInWindow) {
      return `${visibleLabel} Rows`;
    }

    return `${visibleRows.toLocaleString()} ${visibleRows === 1 ? "Row" : "Rows"}`;
  });

  readonly queryElapsedLabel = computed(() => {
    const elapsed = this.lastQueryElapsedMs();
    if (elapsed === null) {
      return "not run yet";
    }

    return `${elapsed.toFixed(1)} ms`;
  });

  readonly schemaToggleLabel = computed(() => (this.schemaCollapsed() ? "Show Columns" : "Hide Columns"));

  readonly loadingActivityEntries = computed(() =>
    this.logEntries()
      .filter((entry) => entry.source !== "signals")
      .slice(-6)
      .reverse(),
  );

  constructor() {
    effect(() => {
      const loading = this.loading();
      const queryError = this.queryError();
      const tableName = this.currentTable();
      const effectiveSql = this.effectiveSql();

      if (loading || queryError !== null || !tableName || !effectiveSql) {
        this.datasetMetricsService.clear();
        return;
      }

      this.datasetMetricsService.refresh(effectiveSql, tableName);
    });

    afterNextRender(() => {
      this.perfService.markBootReady();
      this.logsService.info("boot", "Application is ready");
      void this.attachNativeDropLogger();
    });
  }

  ngOnDestroy(): void {
    for (const unlisten of this.unlistenNativeDropEvents) {
      unlisten();
    }
    this.unlistenNativeDropEvents.length = 0;
    this.datasetMetricsService.clear();
  }

  onFileDropped(filePath: string): Promise<void> {
    return this.queryService.openFile(filePath);
  }

  onDropError(message: string): void {
    this.logsService.error("drag-drop", message);
    this.queryService.reportError(message);
  }

  onManualFileSelected(filePath: string): Promise<void> {
    return this.onFileDropped(filePath);
  }

  onQueryChanged(query: string): void {
    this.queryService.updateQuery(query);
  }

  runQuery(): Promise<void> {
    return this.queryService.runQuery();
  }

  exportCsv(outputPath: string): Promise<void> {
    return this.queryService.exportCsv(outputPath);
  }

  async exportResults(): Promise<void> {
    if (this.loading()) {
      return;
    }

    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const outputPath = await save({
        defaultPath: this.defaultExportPath,
        filters: [
          {
            name: "CSV",
            extensions: ["csv"],
          },
        ],
      });

      if (!outputPath) {
        return;
      }

      await this.queryService.exportCsv(outputPath);
    } catch (error) {
      this.logsService.error("export", "Unable to open export save dialog", {
        error: this.extractError(error),
      });
      this.queryService.reportError("Unable to open export picker. Verify desktop runtime and dialog permissions.");
    }
  }

  async onFileNameClicked(): Promise<void> {
    if (this.loading()) {
      return;
    }

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "CSV",
            extensions: ["csv"],
          },
        ],
      });

      const path = Array.isArray(selection) ? selection[0] : selection;
      if (!path) {
        return;
      }

      if (!/\.csv$/i.test(path)) {
        this.onDropError("The selected file is not a CSV. Please pick a .csv file.");
        return;
      }

      await this.onManualFileSelected(path);
    } catch (error) {
      this.logsService.error("file-picker", "Unable to open replacement file picker", {
        error: this.extractError(error),
      });
      this.onDropError("Unable to open native file picker. Verify Tauri dialog permissions and desktop runtime context.");
    }
  }

  onTableSortRequested(request: TableSortRequest): Promise<void> {
    return this.queryService.sortByEntireTableColumn(request.column, request.direction);
  }

  onTableFilterRequested(columnName: string): void {
    const operator = this.promptFilterOperator(columnName);
    if (operator === null) {
      return;
    }

    const value = this.promptFilterValue(columnName);
    if (value === null) {
      return;
    }

    this.queryService.applyFilterIntent({
      columnName,
      value,
      operator,
    });
  }

  onTableViewportIndexChanged(index: number): void {
    this.queryService.onViewportIndexChange(index);
  }

  onColumnSelected(columnName: string): void {
    this.queryService.appendColumnToQuery(columnName);
  }

  toggleSchemaSidebar(): void {
    this.layoutState.toggleSchemaSidebar();
  }

  toggleCheatSheet(): void {
    this.layoutState.toggleCheatSheet();
  }

  closeCheatSheet(): void {
    this.layoutState.closeCheatSheet();
  }

  toggleSettings(): void {
    this.themeService.toggleSettings();
  }

  closeSettings(): void {
    this.themeService.closeSettings();
  }

  onThemeSelected(theme: AppTheme): void {
    this.themeService.setTheme(theme);
    this.logsService.info("settings", "Theme changed", {
      theme,
    });
  }

  formatActivityTime(timestamp: number): string {
    return `${(timestamp / 1000).toFixed(1)}s`;
  }

  private promptFilterOperator(columnName: string): FilterOperator | null {
    if (typeof window === "undefined" || typeof window.prompt !== "function") {
      this.queryService.reportError("Filter prompts are unavailable in this runtime.");
      return null;
    }

    const response = window.prompt(`Operator for ${columnName} (=, !=, >, >=, <, <=, contains, startsWith, endsWith)`, "=");

    if (response === null) {
      return null;
    }

    const normalized = this.normalizeFilterOperator(response);
    if (normalized === null) {
      this.queryService.reportError("Unsupported filter operator. Use one of: =, !=, >, >=, <, <=, contains, startsWith, endsWith.");
      return null;
    }

    return normalized;
  }

  private promptFilterValue(columnName: string): string | null {
    if (typeof window === "undefined" || typeof window.prompt !== "function") {
      this.queryService.reportError("Filter prompts are unavailable in this runtime.");
      return null;
    }

    const response = window.prompt(`Filter value for ${columnName}`, "");
    if (response === null) {
      return null;
    }

    const normalized = response.trim();
    if (normalized.length === 0) {
      this.queryService.reportError("Filter value cannot be empty.");
      return null;
    }

    return normalized;
  }

  private normalizeFilterOperator(operator: string): FilterOperator | null {
    const normalized = operator.trim().toLowerCase();
    const operators: Record<string, FilterOperator> = {
      "=": "equals",
      eq: "equals",
      equals: "equals",
      "!=": "notEquals",
      "<>": "notEquals",
      neq: "notEquals",
      notequals: "notEquals",
      ">": "greaterThan",
      gt: "greaterThan",
      greaterthan: "greaterThan",
      ">=": "greaterOrEqual",
      gte: "greaterOrEqual",
      greaterorequal: "greaterOrEqual",
      "<": "lessThan",
      lt: "lessThan",
      lessthan: "lessThan",
      "<=": "lessOrEqual",
      lte: "lessOrEqual",
      lessorequal: "lessOrEqual",
      contains: "contains",
      startswith: "startsWith",
      endswith: "endsWith",
    };

    return operators[normalized] ?? null;
  }

  private async attachNativeDropLogger(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.logsService.warn("drag-drop.raw", "Tauri runtime not detected; native drag-drop listener was not attached.");
      return;
    }

    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const webview = getCurrentWebviewWindow();

      const unlisten = await webview.onDragDropEvent((event) => {
        this.logsService.info("drag-drop.raw", "Native drag-drop event", event);
      });

      this.unlistenNativeDropEvents.push(unlisten);
      this.logsService.info("drag-drop.raw", "Attached native drag-drop listener");
    } catch (error) {
      this.logsService.error("drag-drop.raw", "Failed to attach native drag-drop listener", { error: this.extractError(error) });
    }
  }

  private isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    const runtimeMarker = "__TAURI_INTERNALS__";
    return runtimeMarker in (window as unknown as Record<string, unknown>);
  }

  private extractError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Unknown runtime error";
  }
}
