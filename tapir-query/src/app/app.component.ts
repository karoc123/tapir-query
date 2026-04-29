import { CommonModule } from "@angular/common";
import { afterNextRender, Component, computed, inject, OnDestroy } from "@angular/core";
import { FileService } from "./domain/file.service";
import { QueryService } from "./domain/query.service";
import { CheatSheetComponent } from "./features/cheat-sheet/cheat-sheet.component";
import { DataTableComponent, TableSortRequest } from "./features/data-table/data-table.component";
import { DragDropDirective } from "./features/drag-drop/drag-drop.directive";
import { FilePickerComponent } from "./features/file-picker/file-picker.component";
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
  readonly visibleRowCount = this.queryService.visibleRowCount;
  readonly lastQueryElapsedMs = this.queryService.lastQueryElapsedMs;
  readonly statusMessage = this.queryService.statusMessage;
  readonly showSlowLoadHint = this.queryService.showSlowLoadHint;
  readonly activeSortColumn = this.queryService.activeSortColumn;
  readonly activeSortDirection = this.queryService.activeSortDirection;

  readonly mode = this.layoutState.mode;
  readonly isEmptyLayout = this.layoutState.isEmpty;
  readonly isLoadedLayout = this.layoutState.isLoaded;
  readonly schemaCollapsed = this.layoutState.schemaCollapsed;
  readonly cheatSheetOpen = this.layoutState.cheatSheetOpen;

  readonly activeTheme = this.themeService.theme;
  readonly settingsOpen = this.themeService.settingsOpen;
  readonly themeOptions = this.themeService.options;
  readonly defaultExportPath = "exports/query-results.csv";

  readonly activeThemeLabel = computed(() =>
    this.activeTheme() === "soft-tapir" ? "Soft Tapir" : "Dark Banking",
  );

  readonly rowStatusLabel = computed(() =>
    `${this.visibleRowCount().toLocaleString()} rows`,
  );

  readonly queryElapsedLabel = computed(() => {
    const elapsed = this.lastQueryElapsedMs();
    if (elapsed === null) {
      return "not run yet";
    }

    return `${elapsed.toFixed(1)} ms`;
  });

  readonly schemaToggleLabel = computed(() =>
    this.schemaCollapsed() ? "Show Columns" : "Hide Columns",
  );

  constructor() {
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
        filters: [{
          name: "CSV",
          extensions: ["csv"],
        }],
      });

      if (!outputPath) {
        return;
      }

      await this.queryService.exportCsv(outputPath);
    } catch (error) {
      this.logsService.error("export", "Unable to open export save dialog", {
        error: this.extractError(error),
      });
      this.queryService.reportError(
        "Unable to open export picker. Verify desktop runtime and dialog permissions.",
      );
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
        filters: [{
          name: "CSV",
          extensions: ["csv"],
        }],
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
      this.onDropError(
        "Unable to open native file picker. Verify Tauri dialog permissions and desktop runtime context.",
      );
    }
  }

  onTableSortRequested(request: TableSortRequest): Promise<void> {
    return this.queryService.sortByEntireTableColumn(request.column, request.direction);
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

  private async attachNativeDropLogger(): Promise<void> {
    if (!this.isTauriRuntime()) {
      this.logsService.warn(
        "drag-drop.raw",
        "Tauri runtime not detected; native drag-drop listener was not attached.",
      );
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
      this.logsService.error(
        "drag-drop.raw",
        "Failed to attach native drag-drop listener",
        { error: this.extractError(error) },
      );
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
