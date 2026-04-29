import { computed, inject, Injectable, signal } from "@angular/core";
import { ExecuteQueryRequest, QueryRow } from "../infrastructure/tauri-contracts";
import {
  ErrorParsingService,
  ParsedQueryError,
} from "../infrastructure/error-parsing.service";
import { LogService } from "../infrastructure/log.service";
import { PerfService } from "../infrastructure/perf.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { FileService } from "./file.service";

export type SortDirection = "asc" | "desc";

interface QueryState {
  query: string;
  columns: string[];
  rows: QueryRow[];
  loading: boolean;
  showSlowLoadHint: boolean;
  queryError: ParsedQueryError | null;
  statusMessage: string;
  lastQueryElapsedMs: number | null;
  queryHistory: string[];
  activeSortColumn: string | null;
  activeSortDirection: SortDirection | null;
  effectiveSql: string | null;
}

interface ExecuteSqlOptions {
  sql: string;
  resetSort: boolean;
  sortColumn?: string | null;
  sortDirection?: SortDirection | null;
  statusOnStart: string;
  statusOnFinish: (rows: number, elapsedMs: number) => string;
}

@Injectable({
  providedIn: "root",
})
export class QueryService {
  private readonly bridge = inject(TauriBridgeService);
  private readonly fileService = inject(FileService);
  private readonly errorParser = inject(ErrorParsingService);
  private readonly logs = inject(LogService);
  private readonly perf = inject(PerfService);

  private readonly pageSize = 500;
  private readonly historyStorageKey = "tapir.queryHistory.v1";

  private requestToken = 0;
  private slowLoadTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly state = signal<QueryState>({
    query: "",
    columns: [],
    rows: [],
    loading: false,
    showSlowLoadHint: false,
    queryError: null,
    statusMessage: "Drop a CSV file to start querying.",
    lastQueryElapsedMs: null,
    queryHistory: this.loadHistory(),
    activeSortColumn: null,
    activeSortDirection: null,
    effectiveSql: null,
  });

  readonly query = computed(() => this.state().query);
  readonly columns = computed(() => this.state().columns);
  readonly rows = computed(() => this.state().rows);
  readonly loading = computed(() => this.state().loading);
  readonly showSlowLoadHint = computed(() => this.state().showSlowLoadHint);
  readonly queryError = computed(() => this.state().queryError);
  readonly errorMessage = computed(() => this.state().queryError?.summary ?? null);
  readonly statusMessage = computed(() => this.state().statusMessage);
  readonly lastQueryElapsedMs = computed(() => this.state().lastQueryElapsedMs);
  readonly queryHistory = computed(() => this.state().queryHistory);
  readonly visibleRowCount = computed(() => this.state().rows.length);
  readonly activeSortColumn = computed(() => this.state().activeSortColumn);
  readonly activeSortDirection = computed(() => this.state().activeSortDirection);

  updateQuery(query: string): void {
    this.logs.info("query", "Query text updated", {
      length: query.length,
    });
    this.patch({ query });
  }

  selectHistoryQuery(query: string): void {
    this.logs.info("query", "History query selected");
    this.patch({ query, queryError: null });
  }

  reportError(message: string): void {
    const parsed = this.parseError(message);
    this.logs.error("query", "Reported UI error", { message });
    this.patch({
      queryError: parsed,
      statusMessage: "Awaiting a valid CSV input.",
    });
  }

  appendColumnToQuery(columnName: string): void {
    const escaped = columnName.replace(/"/g, '""');
    const identifier = /[^a-zA-Z0-9_]/.test(columnName) ? `"${escaped}"` : escaped;
    const currentQuery = this.state().query.trimEnd();
    const spacer = currentQuery.length > 0 ? " " : "";

    this.patch({
      query: `${currentQuery}${spacer}${identifier}`,
      queryError: null,
    });
  }

  async openFile(filePath: string): Promise<void> {
    this.logs.info("query", "Opening dropped file", { filePath });
    this.perf.start("fileLoad");
    this.patch({
      loading: true,
      queryError: null,
      statusMessage: "Opening CSV file...",
      showSlowLoadHint: false,
      activeSortColumn: null,
      activeSortDirection: null,
    });

    try {
      const opened = await this.bridge.openFile(filePath);
      this.fileService.setOpenedFile(opened);
      this.perf.end("fileLoad");

      const nextHistory = this.computeNextHistory(this.state().queryHistory, opened.defaultQuery);
      this.persistHistory(nextHistory);

      this.patch({
        query: opened.defaultQuery,
        queryHistory: nextHistory,
        queryError: null,
      });

      await this.executeSqlWithBackgroundHydration({
        sql: opened.defaultQuery,
        resetSort: true,
        statusOnStart: "Running initial preview query...",
        statusOnFinish: (rows, elapsedMs) =>
          `Loaded ${opened.tableName} with ${rows.toLocaleString()} rows in ${elapsedMs} ms.`,
      });

      this.logs.info("query", "File loaded and initial query executed", {
        tableName: opened.tableName,
        columns: opened.columns.length,
      });
    } catch (error) {
      this.perf.end("fileLoad");
      const parsed = this.parseError(error);
      this.patch({
        loading: false,
        showSlowLoadHint: false,
        queryError: parsed,
        statusMessage: "Failed to open CSV file.",
      });
      this.clearSlowLoadTimer();
      this.logs.error("query", "Open file failed", {
        filePath,
        error: parsed.rawMessage,
      });
    }
  }

  async runQuery(): Promise<void> {
    if (!this.fileService.currentTable()) {
      this.patch({
        queryError: this.parseError("Open a CSV file before running a query."),
      });
      return;
    }

    const sql = this.state().query.trim();
    if (!sql) {
      this.patch({
        queryError: this.parseError("Write a SQL query before executing."),
      });
      return;
    }

    const nextHistory = this.computeNextHistory(this.state().queryHistory, sql);
    this.persistHistory(nextHistory);

    this.patch({
      queryHistory: nextHistory,
      activeSortColumn: null,
      activeSortDirection: null,
    });

    await this.executeSqlWithBackgroundHydration({
      sql,
      resetSort: true,
      statusOnStart: "Running query...",
      statusOnFinish: (rows, elapsedMs) =>
        `Rendered ${rows.toLocaleString()} rows in ${elapsedMs} ms.`,
    });
  }

  async sortByEntireTableColumn(columnName: string, direction: SortDirection): Promise<void> {
    const tableName = this.fileService.currentTable();
    if (!tableName) {
      this.patch({
        queryError: this.parseError("Open a CSV file before sorting."),
      });
      return;
    }

    const sql =
      `SELECT * FROM ${this.escapeIdentifier(tableName)} ` +
      `ORDER BY ${this.escapeIdentifier(columnName)} ${direction.toUpperCase()}`;

    this.logs.info("query", "Sorting full dataset by column", {
      columnName,
      direction,
      tableName,
    });

    await this.executeSqlWithBackgroundHydration({
      sql,
      resetSort: false,
      sortColumn: columnName,
      sortDirection: direction,
      statusOnStart: `Sorting full dataset by ${columnName} (${direction.toUpperCase()})...`,
      statusOnFinish: (rows, elapsedMs) =>
        `Sorted ${rows.toLocaleString()} rows by ${columnName} (${direction.toUpperCase()}) in ${elapsedMs} ms.`,
    });
  }

  async exportCsv(outputPath: string): Promise<void> {
    if (!this.fileService.currentTable()) {
      this.patch({
        queryError: this.parseError("Open a CSV file before exporting results."),
      });
      return;
    }

    const sql = this.state().effectiveSql;
    if (!sql) {
      this.patch({
        queryError: this.parseError("Run or sort data before exporting."),
      });
      return;
    }

    this.logs.info("query", "Exporting query result", {
      outputPath,
    });
    this.patch({
      loading: true,
      showSlowLoadHint: false,
      queryError: null,
      statusMessage: "Exporting CSV...",
    });

    try {
      const exported = await this.bridge.exportCsv({
        sql,
        outputPath,
      });

      this.patch({
        loading: false,
        showSlowLoadHint: false,
        queryError: null,
        statusMessage: `Export complete: ${exported.rowsWritten.toLocaleString()} rows -> ${exported.outputPath}`,
      });
      this.logs.info("query", "Export completed", exported);
    } catch (error) {
      const parsed = this.parseError(error);
      this.patch({
        loading: false,
        showSlowLoadHint: false,
        queryError: parsed,
        statusMessage: "Export failed.",
      });
      this.logs.error("query", "Export failed", {
        error: parsed.rawMessage,
      });
    }
  }

  private async executeSqlWithBackgroundHydration(options: ExecuteSqlOptions): Promise<void> {
    const requestToken = this.createRequestToken();

    this.perf.start("queryRoundTrip");
    this.beginSlowLoadWatch();
    this.patch({
      loading: true,
      showSlowLoadHint: false,
      queryError: null,
      statusMessage: options.statusOnStart,
      ...(options.resetSort
        ? { activeSortColumn: null, activeSortDirection: null }
        : {
            activeSortColumn: options.sortColumn ?? null,
            activeSortDirection: options.sortDirection ?? null,
          }),
    });

    try {
      const firstChunk = await this.bridge.executeQuery({
        sql: options.sql,
        limit: this.pageSize,
        offset: 0,
      });

      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      this.perf.end("queryRoundTrip");
      this.perf.record("queryEngine", firstChunk.elapsedMs);
      this.perf.start("renderGrid");

      const initialRows = [...firstChunk.rows];
      const hasRemainingRows = firstChunk.nextOffset !== null;

      this.state.update((current) => ({
        ...current,
        columns: [...firstChunk.columns],
        rows: initialRows,
        loading: hasRemainingRows,
        showSlowLoadHint: hasRemainingRows,
        queryError: null,
        statusMessage: hasRemainingRows
          ? `Loaded ${initialRows.length.toLocaleString()} rows. Loading remaining rows...`
          : options.statusOnFinish(initialRows.length, firstChunk.elapsedMs),
        lastQueryElapsedMs: firstChunk.elapsedMs,
        effectiveSql: options.sql,
      }));

      if (!hasRemainingRows) {
        this.clearSlowLoadTimer();
        return;
      }

      void this.hydrateRemainingRows(
        requestToken,
        options,
        firstChunk.nextOffset ?? 0,
        initialRows,
        firstChunk.elapsedMs,
      );
    } catch (error) {
      this.perf.end("queryRoundTrip");
      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      const parsed = this.parseError(error);
      this.patch({
        loading: false,
        showSlowLoadHint: false,
        queryError: parsed,
        statusMessage: "Query execution failed.",
      });
      this.clearSlowLoadTimer();
      this.logs.error("query", "Query execution failed", {
        error: parsed.rawMessage,
      });
    }
  }

  private async hydrateRemainingRows(
    requestToken: number,
    options: ExecuteSqlOptions,
    startOffset: number,
    initialRows: QueryRow[],
    initialElapsedMs: number,
  ): Promise<void> {
    let nextOffset: number | null = startOffset;
    const allRows = [...initialRows];
    let lastElapsedMs = initialElapsedMs;
    let rowsSinceLastPatch = 0;

    while (nextOffset !== null) {
      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      const payload: ExecuteQueryRequest = {
        sql: options.sql,
        limit: this.pageSize,
        offset: nextOffset,
      };

      const chunk = await this.bridge.executeQuery(payload);
      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      this.perf.record("queryEngine", chunk.elapsedMs);
      this.perf.start("renderGrid");

      allRows.push(...chunk.rows);
      nextOffset = chunk.nextOffset;
      lastElapsedMs = chunk.elapsedMs;
      rowsSinceLastPatch += chunk.rows.length;

      if (nextOffset === null || rowsSinceLastPatch >= this.pageSize * 4) {
        const rowCount = allRows.length;

        this.state.update((current) => ({
          ...current,
          columns: [...chunk.columns],
          rows: [...allRows],
          loading: nextOffset !== null,
          showSlowLoadHint: nextOffset !== null,
          statusMessage:
            nextOffset === null
              ? options.statusOnFinish(rowCount, lastElapsedMs)
              : `Loading rows... ${rowCount.toLocaleString()} loaded`,
          lastQueryElapsedMs: lastElapsedMs,
        }));

        rowsSinceLastPatch = 0;
      }

      await this.yieldToMainThread();
    }

    if (!this.isActiveRequest(requestToken)) {
      return;
    }

    this.patch({
      loading: false,
      showSlowLoadHint: false,
    });
    this.clearSlowLoadTimer();
  }

  private patch(patch: Partial<QueryState>): void {
    const previous = this.state();

    this.state.update((current) => ({
      ...current,
      ...patch,
    }));

    const changedKeys = Object.keys(patch);
    if (changedKeys.length > 0) {
      this.logs.info("signals", "Query state patch", {
        changedKeys,
        loading: previous.loading !== this.state().loading ? this.state().loading : undefined,
        statusMessage:
          previous.statusMessage !== this.state().statusMessage
            ? this.state().statusMessage
            : undefined,
        queryError:
          previous.queryError?.summary !== this.state().queryError?.summary
            ? this.state().queryError?.summary
            : undefined,
      });
    }
  }

  private createRequestToken(): number {
    this.requestToken += 1;
    return this.requestToken;
  }

  private isActiveRequest(requestToken: number): boolean {
    return requestToken === this.requestToken;
  }

  private beginSlowLoadWatch(): void {
    this.clearSlowLoadTimer();
    this.slowLoadTimer = setTimeout(() => {
      if (this.state().loading) {
        this.patch({ showSlowLoadHint: true });
      }
    }, 750);
  }

  private clearSlowLoadTimer(): void {
    if (this.slowLoadTimer !== null) {
      clearTimeout(this.slowLoadTimer);
      this.slowLoadTimer = null;
    }
  }

  private async yieldToMainThread(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  private computeNextHistory(existing: string[], sql: string): string[] {
    const normalized = sql.trim();
    if (!normalized) {
      return existing;
    }

    return [normalized, ...existing.filter((entry) => entry !== normalized)].slice(0, 20);
  }

  private loadHistory(): string[] {
    if (typeof localStorage === "undefined") {
      return [];
    }

    try {
      const parsed = JSON.parse(localStorage.getItem(this.historyStorageKey) ?? "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  private persistHistory(history: string[]): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(this.historyStorageKey, JSON.stringify(history));
    } catch {
      // Ignore storage write failures in restricted environments.
    }
  }

  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private parseError(error: unknown): ParsedQueryError {
    return this.errorParser.parse(error);
  }
}
