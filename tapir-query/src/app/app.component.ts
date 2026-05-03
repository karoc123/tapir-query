import { CommonModule } from "@angular/common";
import { afterNextRender, Component, computed, effect, inject, OnDestroy, signal, untracked, ViewChild } from "@angular/core";
import { DataAnalysisPluginService } from "./domain/data-analysis-plugin.service";
import { DatasetMetricsService } from "./domain/dataset-metrics.service";
import { FileService } from "./domain/file.service";
import { HistoryService } from "./domain/history.service";
import { IngestionService } from "./domain/ingestion.service";
import { QueryService } from "./domain/query.service";
import type { FilterIntent } from "./domain/sql-generator.service";
import { CheatSheetComponent } from "./features/cheat-sheet/cheat-sheet.component";
import { DataTableComponent, TableSortRequest } from "./features/data-table/data-table.component";
import { DataAnalysisDashboardComponent } from "./features/data-analysis-dashboard/data-analysis-dashboard.component";
import { DragDropDirective } from "./features/drag-drop/drag-drop.directive";
import { FilePickerComponent } from "./features/file-picker/file-picker.component";
import { GridStatusOverlayComponent } from "./features/grid-status-overlay/grid-status-overlay.component";
import { QueryErrorPanelComponent } from "./features/query-error-panel/query-error-panel.component";
import { SchemaSidebarComponent } from "./features/schema-sidebar/schema-sidebar.component";
import { SettingsPanelComponent } from "./features/settings-panel/settings-panel.component";
import { SqlEditorComponent } from "./features/sql-editor/sql-editor.component";
import { AppInfoService } from "./infrastructure/app-info.service";
import { LayoutStateService } from "./infrastructure/layout-state.service";
import { LogService } from "./infrastructure/log.service";
import { PerfService } from "./infrastructure/perf.service";
import { ColumnSchema } from "./infrastructure/tauri-contracts";
import { AppTheme, ThemeService } from "./infrastructure/theme.service";

@Component({
  selector: "app-root",
  imports: [
    CommonModule,
    CheatSheetComponent,
    DataTableComponent,
    DataAnalysisDashboardComponent,
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
  private readonly historyService = inject(HistoryService);
  private readonly dataAnalysisPluginService = inject(DataAnalysisPluginService);
  private readonly datasetMetricsService = inject(DatasetMetricsService);
  private readonly ingestionService = inject(IngestionService);
  private readonly layoutState = inject(LayoutStateService);
  private readonly appInfoService = inject(AppInfoService);
  private readonly logsService = inject(LogService);
  private readonly perfService = inject(PerfService);
  private readonly themeService = inject(ThemeService);

  private readonly unlistenNativeDropEvents: Array<() => void> = [];

  @ViewChild(SqlEditorComponent)
  private readonly sqlEditor?: SqlEditorComponent;

  readonly loading = this.queryService.loading;
  readonly currentFilePath = this.fileService.currentFilePath;
  readonly currentFileName = this.fileService.currentFileName;
  readonly currentFileSizeLabel = this.fileService.currentFileSizeLabel;
  readonly currentTable = this.fileService.currentTable;
  readonly schemaColumns = this.fileService.schemaColumns;
  readonly query = this.queryService.query;
  readonly historyEntries = this.historyService.entries;
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
  readonly cheatSheetOpen = this.layoutState.cheatSheetOpen;
  readonly analysisPanelOpen = this.layoutState.analysisPanelOpen;

  readonly analysisColumnProfiles = this.dataAnalysisPluginService.columnProfiles;
  readonly analysisRunning = this.dataAnalysisPluginService.running;
  readonly analysisProgressLabel = this.dataAnalysisPluginService.progressLabel;
  readonly analysisCompletionRatio = this.dataAnalysisPluginService.completionRatio;

  readonly activeTheme = this.themeService.theme;
  readonly settingsOpen = this.themeService.settingsOpen;
  readonly themeOptions = this.themeService.options;
  readonly appVersion = this.appInfoService.version;
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

  readonly analysisToggleLabel = computed(() => (this.analysisPanelOpen() ? "Hide Data Analysis" : "Show Data Analysis"));

  readonly analysisSplitMin = 28;
  readonly analysisSplitMax = 72;
  private readonly analysisSplitStorageKey = "tapir.analysis.split.v1";
  private readonly defaultAnalysisSplitPercent = 46;

  private readonly analysisSelectedColumnNames = signal<string[]>([]);
  private readonly analysisSplitPercentState = signal(this.loadAnalysisSplitPercent());
  private splitterDragState: {
    pointerId: number;
    startY: number;
    startPercent: number;
    containerHeight: number;
  } | null = null;

  readonly analysisSplitPercent = computed(() => this.analysisSplitPercentState());
  readonly analysisSplitCssValue = computed(() => `${this.analysisSplitPercentState().toFixed(2)}%`);

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

    effect(() => {
      const analysisOpen = this.analysisPanelOpen();
      if (!analysisOpen) {
        untracked(() => {
          this.analysisSelectedColumnNames.set([]);
          this.dataAnalysisPluginService.disable();
        });
        return;
      }

      untracked(() => {
        this.dataAnalysisPluginService.enable();
      });

      const loading = this.loading();
      const queryError = this.queryError();
      const tableName = this.currentTable();
      const effectiveSql = this.effectiveSql();
      const columns = this.schemaColumns();
      const selectedColumnNames = this.analysisSelectedColumnNames();
      const selectedColumns = this.resolveSelectedAnalysisColumns(columns, selectedColumnNames);

      if (selectedColumns.length !== selectedColumnNames.length) {
        untracked(() => {
          this.analysisSelectedColumnNames.set(selectedColumns.map((column) => column.name));
        });
      }

      if (loading || queryError !== null || !tableName || !effectiveSql) {
        untracked(() => {
          this.dataAnalysisPluginService.suspend();
        });
        return;
      }

      untracked(() => {
        this.dataAnalysisPluginService.refresh({
          tableName,
          sql: effectiveSql,
          columns: selectedColumns,
        });
      });
    });

    afterNextRender(() => {
      this.perfService.markBootReady();
      this.logsService.info("boot", "Application is ready");
      void this.attachNativeDropIngestion();
    });
  }

  ngOnDestroy(): void {
    for (const unlisten of this.unlistenNativeDropEvents) {
      unlisten();
    }
    this.unlistenNativeDropEvents.length = 0;
    this.datasetMetricsService.clear();
    this.dataAnalysisPluginService.disable();
  }

  async onFileDropped(filePath: string): Promise<void> {
    try {
      await this.queryService.openFile(filePath);
    } catch (error) {
      this.handleUnhandledQueryFailure("open-file", error);
    }
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

  onHistorySelected(query: string): void {
    this.queryService.selectHistoryQuery(query);
  }

  async runQuery(): Promise<void> {
    try {
      await this.queryService.runQuery();
    } catch (error) {
      this.handleUnhandledQueryFailure("query", error);
    } finally {
      this.focusQueryEditorSoon();
    }
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

  async onTableSortRequested(request: TableSortRequest): Promise<void> {
    try {
      await this.queryService.sortByEntireTableColumn(request.column, request.direction);
    } catch (error) {
      this.handleUnhandledQueryFailure("query-sort", error);
    }
  }

  onTableFilterRequested(intent: FilterIntent): void {
    this.queryService.applyFilterIntent(intent);
  }

  onTableViewportIndexChanged(index: number): void {
    this.queryService.onViewportIndexChange(index);
  }

  onColumnSelected(columnName: string): void {
    this.queryService.appendColumnToQuery(columnName);
  }

  onAnalysisColumnDropped(payload: { columnName: string; dataType: string | null }): void {
    const columnName = payload.columnName.trim();
    if (!columnName) {
      return;
    }

    const schemaColumns = this.schemaColumns();
    const existsInSchema = schemaColumns.some((column) => column.name === columnName);
    if (!existsInSchema) {
      return;
    }

    this.analysisSelectedColumnNames.update((selected) => {
      if (selected.includes(columnName)) {
        return selected;
      }

      return [...selected, columnName];
    });
  }

  onAnalysisColumnRemoved(columnName: string): void {
    this.analysisSelectedColumnNames.update((selected) => selected.filter((entry) => entry !== columnName));
  }

  toggleCheatSheet(): void {
    this.layoutState.toggleCheatSheet();
  }

  toggleAnalysisPanel(): void {
    this.layoutState.toggleAnalysisPanel();
  }

  onAnalysisSplitterPointerDown(event: PointerEvent): void {
    if (!this.analysisPanelOpen()) {
      return;
    }

    const handle = event.currentTarget as HTMLElement | null;
    if (!handle) {
      return;
    }

    const dataZone = handle.closest(".data-zone") as HTMLElement | null;
    const containerHeight = dataZone?.getBoundingClientRect().height ?? 0;
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
      return;
    }

    this.splitterDragState = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPercent: this.analysisSplitPercentState(),
      containerHeight,
    };

    handle.setPointerCapture(event.pointerId);
    handle.classList.add("is-dragging");
    event.preventDefault();
  }

  onAnalysisSplitterPointerMove(event: PointerEvent): void {
    const dragState = this.splitterDragState;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaPercent = ((event.clientY - dragState.startY) / dragState.containerHeight) * 100;
    this.setAnalysisSplitPercent(dragState.startPercent + deltaPercent);
    event.preventDefault();
  }

  onAnalysisSplitterPointerUp(event: PointerEvent): void {
    const dragState = this.splitterDragState;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const handle = event.currentTarget as HTMLElement | null;
    if (handle?.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle?.classList.remove("is-dragging");
    this.persistAnalysisSplitPercent(this.analysisSplitPercentState());
    this.splitterDragState = null;
  }

  onAnalysisSplitterKeyDown(event: KeyboardEvent): void {
    if (!this.analysisPanelOpen()) {
      return;
    }

    if (event.key === "ArrowUp") {
      this.setAnalysisSplitPercent(this.analysisSplitPercentState() - 4, true);
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      this.setAnalysisSplitPercent(this.analysisSplitPercentState() + 4, true);
      event.preventDefault();
      return;
    }

    if (event.key === "Home") {
      this.setAnalysisSplitPercent(this.analysisSplitMin, true);
      event.preventDefault();
      return;
    }

    if (event.key === "End") {
      this.setAnalysisSplitPercent(this.analysisSplitMax, true);
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      this.setAnalysisSplitPercent(this.defaultAnalysisSplitPercent, true);
      event.preventDefault();
    }
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

  private async attachNativeDropIngestion(): Promise<void> {
    const unlisten = await this.ingestionService.attachNativeDropListener({
      onFilePath: async (filePath) => {
        const normalizedPath = this.normalizeDroppedFilePath(filePath);

        if (!/\.csv$/i.test(normalizedPath)) {
          this.onDropError("Only CSV files are supported. Drop a .csv file.");
          return;
        }

        if (this.loading()) {
          this.logsService.warn("drag-drop.raw", "Ignoring native file drop while another file is loading", {
            filePath: normalizedPath,
          });
          return;
        }

        await this.onFileDropped(normalizedPath);
      },
    });

    if (unlisten !== null) {
      this.unlistenNativeDropEvents.push(unlisten);
    }
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

  private normalizeDroppedFilePath(filePath: string): string {
    const trimmed = filePath.trim();

    if (trimmed.startsWith("file://")) {
      try {
        const parsed = new URL(trimmed);
        return this.stripWindowsDrivePrefix(decodeURIComponent(parsed.pathname));
      } catch {
        return this.stripWindowsDrivePrefix(decodeURIComponent(trimmed.replace(/^file:\/\//, "")));
      }
    }

    return this.stripWindowsDrivePrefix(trimmed);
  }

  private stripWindowsDrivePrefix(path: string): string {
    if (/^\/[A-Za-z]:[\\/]/.test(path)) {
      return path.slice(1);
    }

    return path;
  }

  private resolveSelectedAnalysisColumns(columns: ColumnSchema[], selectedColumnNames: string[]): ColumnSchema[] {
    if (selectedColumnNames.length === 0 || columns.length === 0) {
      return [];
    }

    const byName = new Map(columns.map((column) => [column.name, column]));
    const resolved: ColumnSchema[] = [];

    for (const selectedName of selectedColumnNames) {
      const column = byName.get(selectedName);
      if (column) {
        resolved.push(column);
      }
    }

    return resolved;
  }

  private setAnalysisSplitPercent(nextPercent: number, persist = false): void {
    const clampedPercent = Math.max(this.analysisSplitMin, Math.min(this.analysisSplitMax, nextPercent));
    const roundedPercent = Number(clampedPercent.toFixed(2));
    this.analysisSplitPercentState.set(roundedPercent);

    if (persist) {
      this.persistAnalysisSplitPercent(roundedPercent);
    }
  }

  private loadAnalysisSplitPercent(): number {
    if (typeof localStorage === "undefined") {
      return this.defaultAnalysisSplitPercent;
    }

    try {
      const rawValue = localStorage.getItem(this.analysisSplitStorageKey);
      if (rawValue === null) {
        return this.defaultAnalysisSplitPercent;
      }

      const parsedValue = Number.parseFloat(rawValue);
      if (!Number.isFinite(parsedValue)) {
        return this.defaultAnalysisSplitPercent;
      }

      return Math.max(this.analysisSplitMin, Math.min(this.analysisSplitMax, parsedValue));
    } catch {
      return this.defaultAnalysisSplitPercent;
    }
  }

  private persistAnalysisSplitPercent(splitPercent: number): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(this.analysisSplitStorageKey, splitPercent.toFixed(2));
    } catch {
      // Ignore storage limitations.
    }
  }

  private focusQueryEditorSoon(): void {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        this.sqlEditor?.focusEditor();
      });
      return;
    }

    setTimeout(() => {
      this.sqlEditor?.focusEditor();
    }, 0);
  }

  private handleUnhandledQueryFailure(source: string, error: unknown): void {
    const message = this.extractError(error);
    this.logsService.error(source, "Unhandled query UI failure", {
      error: message,
    });
    this.queryService.reportError(message);
  }
}
