import { computed, inject, Injectable, signal } from "@angular/core";
import { QueryChunk, QueryRow } from "../infrastructure/tauri-contracts";
import { ErrorParsingService, ParsedQueryError } from "../infrastructure/error-parsing.service";
import { LogService } from "../infrastructure/log.service";
import { PerfService } from "../infrastructure/perf.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { FileService } from "./file.service";

export type SortDirection = "asc" | "desc";

type WindowMergeMode = "forward" | "backward" | "jump";

interface QueryState {
  query: string;
  columns: string[];
  rows: QueryRow[];
  totalRows: number;
  windowStartOffset: number;
  activeSessionId: string | null;
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
  statusOnFinish: (totalRows: number, elapsedMs: number, loadedRows: number) => string;
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

  private readonly initialChunkSize = 1_000;
  private readonly streamChunkSize = 1_000;
  private readonly windowSize = 10_000;
  private readonly prefetchThreshold = 300;
  private readonly historyStorageKey = "tapir.queryHistory.v1";

  private requestToken = 0;
  private slowLoadTimer: ReturnType<typeof setTimeout> | null = null;
  private windowFetchInFlight = false;

  private readonly state = signal<QueryState>({
    query: "",
    columns: [],
    rows: [],
    totalRows: 0,
    windowStartOffset: 0,
    activeSessionId: null,
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
  readonly totalRowCount = computed(() => this.state().totalRows);
  readonly windowStartOffset = computed(() => this.state().windowStartOffset);
  readonly loading = computed(() => this.state().loading);
  readonly showSlowLoadHint = computed(() => this.state().showSlowLoadHint);
  readonly queryError = computed(() => this.state().queryError);
  readonly errorMessage = computed(() => this.state().queryError?.summary ?? null);
  readonly statusMessage = computed(() => this.state().statusMessage);
  readonly lastQueryElapsedMs = computed(() => this.state().lastQueryElapsedMs);
  readonly queryHistory = computed(() => this.state().queryHistory);
  readonly visibleRowCount = computed(() => {
    const totalRows = this.state().totalRows;
    return totalRows > 0 ? totalRows : this.state().rows.length;
  });
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
    this.logs.debug("open-file", "register_csv request enqueued", { filePath });
    this.perf.start("fileLoad");
    await this.closeActiveSession();

    this.patch({
      loading: true,
      queryError: null,
      statusMessage: "Registering CSV in DuckDB...",
      showSlowLoadHint: false,
      rows: [],
      totalRows: 0,
      windowStartOffset: 0,
      columns: [],
      activeSortColumn: null,
      activeSortDirection: null,
    });

    await this.yieldToUi();

    try {
      const opened = await this.bridge.openFile(filePath);
      const previewQuery = this.buildPreviewQuery(opened.defaultQuery);
      this.logs.debug("open-file", "describe_table completed", {
        tableName: opened.tableName,
        columns: opened.columns.length,
      });
      this.fileService.setOpenedFile(opened);
      this.perf.end("fileLoad");

      const nextHistory = this.computeNextHistory(this.state().queryHistory, previewQuery);
      this.persistHistory(nextHistory);

      this.patch({
        query: previewQuery,
        queryHistory: nextHistory,
        queryError: null,
        statusMessage: "CSV registered. Preparing initial preview query...",
      });

      this.logs.info("open-file", "open_file success", {
        tableName: opened.tableName,
        columns: opened.columns.length,
      });

      await this.executeSqlWithSessionStreaming({
        sql: previewQuery,
        resetSort: true,
        statusOnStart: "Running initial preview query...",
        statusOnFinish: (_totalRows, elapsedMs, loadedRows) => `Preview ready for ${opened.tableName}: ${loadedRows.toLocaleString()} rows in ${elapsedMs} ms. Remove LIMIT to run a full-table query.`,
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

    if (this.shouldUseDirectExecution(sql)) {
      await this.executeSqlDirect(sql);
      return;
    }

    await this.executeSqlWithSessionStreaming({
      sql,
      resetSort: true,
      statusOnStart: "Running query...",
      statusOnFinish: (totalRows, elapsedMs, loadedRows) => `Query ready: ${totalRows.toLocaleString()} rows in ${elapsedMs} ms (showing ${loadedRows.toLocaleString()}).`,
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

    const sql = `SELECT * FROM ${this.escapeIdentifier(tableName)} ` + `ORDER BY ${this.escapeIdentifier(columnName)} ${direction.toUpperCase()}`;

    this.logs.info("query", "Sorting full dataset by column", {
      columnName,
      direction,
      tableName,
    });

    await this.executeSqlWithSessionStreaming({
      sql,
      resetSort: false,
      sortColumn: columnName,
      sortDirection: direction,
      statusOnStart: `Sorting full dataset by ${columnName} (${direction.toUpperCase()})...`,
      statusOnFinish: (totalRows, elapsedMs, loadedRows) =>
        `Sorted ${totalRows.toLocaleString()} rows by ${columnName} (${direction.toUpperCase()}) in ${elapsedMs} ms (showing ${loadedRows.toLocaleString()}).`,
    });
  }

  onViewportIndexChange(index: number): void {
    if (index < 0) {
      return;
    }

    void this.prefetchWindowAround(index);
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

    await this.yieldToUi();

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

  private async executeSqlWithSessionStreaming(options: ExecuteSqlOptions): Promise<void> {
    const requestToken = this.createRequestToken();
    this.windowFetchInFlight = false;

    this.logs.debug("query-session", "start_query_session request received", {
      sqlLength: options.sql.length,
      resetSort: options.resetSort,
      sortColumn: options.sortColumn ?? null,
      sortDirection: options.sortDirection ?? null,
    });

    const previousSessionId = this.state().activeSessionId;
    if (previousSessionId) {
      await this.closeSessionById(previousSessionId);
    }

    this.perf.start("queryRoundTrip");
    this.beginSlowLoadWatch();
    this.patch({
      loading: true,
      showSlowLoadHint: false,
      queryError: null,
      rows: [],
      totalRows: 0,
      windowStartOffset: 0,
      activeSessionId: null,
      statusMessage: options.statusOnStart,
      ...(options.resetSort
        ? { activeSortColumn: null, activeSortDirection: null }
        : {
            activeSortColumn: options.sortColumn ?? null,
            activeSortDirection: options.sortDirection ?? null,
          }),
    });

    await this.yieldToUi();

    try {
      const session = await this.bridge.startQuerySession({
        sql: options.sql,
      });

      this.logs.info("query-session", "start_query_session success", {
        sessionId: session.sessionId,
        totalRows: session.totalRows,
        elapsedMs: session.elapsedMs,
      });

      if (!this.isActiveRequest(requestToken)) {
        await this.closeSessionById(session.sessionId);
        return;
      }

      this.perf.end("queryRoundTrip");
      this.perf.record("queryEngine", session.elapsedMs);

      this.patch({
        statusMessage: "Query session ready. Fetching first rows...",
      });

      this.logs.debug("query-session", "read_query_session_chunk request received", {
        sessionId: session.sessionId,
        limit: this.initialChunkSize,
        offset: 0,
      });

      this.perf.start("queryRoundTrip");
      const firstChunk = await this.bridge.readQuerySessionChunk({
        sessionId: session.sessionId,
        limit: this.initialChunkSize,
        offset: 0,
      });
      this.perf.end("queryRoundTrip");

      if (!this.isActiveRequest(requestToken)) {
        await this.closeSessionById(session.sessionId);
        return;
      }

      this.perf.record("queryEngine", firstChunk.elapsedMs);
      this.logs.debug("query-session", "read_query_session_chunk success", {
        rows: firstChunk.rows.length,
        offset: firstChunk.offset,
        nextOffset: firstChunk.nextOffset,
        elapsedMs: firstChunk.elapsedMs,
      });
      this.perf.start("renderGrid");

      const initialRows = [...firstChunk.rows];
      const status = `${options.statusOnFinish(session.totalRows, session.elapsedMs, initialRows.length)} ` + this.buildWindowStatus(firstChunk.offset, initialRows.length, session.totalRows);

      this.state.update((current) => ({
        ...current,
        columns: session.columns.length > 0 ? [...session.columns] : [...firstChunk.columns],
        rows: initialRows,
        totalRows: session.totalRows,
        windowStartOffset: firstChunk.offset,
        activeSessionId: session.sessionId,
        loading: false,
        showSlowLoadHint: false,
        queryError: null,
        statusMessage: status,
        lastQueryElapsedMs: session.elapsedMs,
        effectiveSql: options.sql,
      }));

      this.clearSlowLoadTimer();
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

  private async executeSqlDirect(sql: string): Promise<void> {
    const requestToken = this.createRequestToken();
    this.windowFetchInFlight = false;

    const previousSessionId = this.state().activeSessionId;
    if (previousSessionId) {
      await this.closeSessionById(previousSessionId);
    }

    this.perf.start("queryRoundTrip");
    this.beginSlowLoadWatch();
    this.patch({
      loading: true,
      showSlowLoadHint: false,
      queryError: null,
      rows: [],
      totalRows: 0,
      windowStartOffset: 0,
      activeSessionId: null,
      statusMessage: "Running aggregate query...",
      activeSortColumn: null,
      activeSortDirection: null,
    });

    await this.yieldToUi();

    try {
      const chunk = await this.bridge.executeQuery({
        sql,
        limit: this.initialChunkSize,
        offset: 0,
      });

      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      this.perf.end("queryRoundTrip");
      this.perf.record("queryEngine", chunk.elapsedMs);
      this.perf.start("renderGrid");

      const rows = [...chunk.rows];
      const totalRows = chunk.offset + rows.length + (chunk.nextOffset !== null ? 1 : 0);

      this.state.update((current) => ({
        ...current,
        columns: [...chunk.columns],
        rows,
        totalRows: Math.max(rows.length, totalRows),
        windowStartOffset: chunk.offset,
        activeSessionId: null,
        loading: false,
        showSlowLoadHint: false,
        queryError: null,
        statusMessage: `Query ready: ${rows.length.toLocaleString()} rows in ${chunk.elapsedMs} ms (direct mode).`,
        lastQueryElapsedMs: chunk.elapsedMs,
        effectiveSql: sql,
      }));

      this.clearSlowLoadTimer();
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
      this.logs.error("query", "Direct query execution failed", {
        error: parsed.rawMessage,
      });
    }
  }

  private async prefetchWindowAround(viewportIndex: number): Promise<void> {
    const snapshot = this.state();
    if (snapshot.loading || this.windowFetchInFlight) {
      return;
    }

    const sessionId = snapshot.activeSessionId;
    if (!sessionId) {
      return;
    }

    const totalRows = snapshot.totalRows;
    if (totalRows <= snapshot.rows.length) {
      return;
    }

    const loadedStart = snapshot.windowStartOffset;
    const loadedEnd = loadedStart + snapshot.rows.length;

    let mode: WindowMergeMode | null = null;
    let offset: number | null = null;

    if (viewportIndex < loadedStart || viewportIndex >= loadedEnd) {
      mode = "jump";
      offset = this.alignOffset(viewportIndex, this.streamChunkSize, totalRows);
    } else if (viewportIndex + this.prefetchThreshold >= loadedEnd && loadedEnd < totalRows) {
      mode = "forward";
      offset = loadedEnd;
    } else if (viewportIndex <= loadedStart + this.prefetchThreshold && loadedStart > 0) {
      mode = "backward";
      offset = Math.max(0, loadedStart - this.streamChunkSize);
    }

    if (mode === null || offset === null) {
      return;
    }

    this.windowFetchInFlight = true;
    try {
      const chunk = await this.bridge.readQuerySessionChunk({
        sessionId,
        limit: this.streamChunkSize,
        offset,
      });

      if (this.state().activeSessionId !== sessionId) {
        return;
      }

      this.perf.record("queryEngine", chunk.elapsedMs);
      this.perf.start("renderGrid");
      this.applyWindowChunk(chunk, mode);
    } catch (error) {
      const parsed = this.parseError(error);
      this.patch({
        queryError: parsed,
        statusMessage: "Streaming rows failed.",
      });
      this.logs.error("query", "Window prefetch failed", {
        error: parsed.rawMessage,
      });
    } finally {
      this.windowFetchInFlight = false;
    }
  }

  private applyWindowChunk(chunk: QueryChunk, mode: WindowMergeMode): void {
    if (chunk.rows.length === 0) {
      return;
    }

    this.state.update((current) => {
      if (!current.activeSessionId || current.totalRows === 0) {
        return current;
      }

      const loadedStart = current.windowStartOffset;
      const loadedEnd = loadedStart + current.rows.length;
      let effectiveMode = mode;

      if (mode === "forward" && chunk.offset !== loadedEnd) {
        effectiveMode = "jump";
      }
      if (mode === "backward" && chunk.offset + chunk.rows.length !== loadedStart) {
        effectiveMode = "jump";
      }

      const merged = this.mergeWindow(current.rows, loadedStart, chunk, effectiveMode);
      const status = this.buildWindowStatus(merged.windowStartOffset, merged.rows.length, current.totalRows);

      return {
        ...current,
        columns: chunk.columns.length > 0 ? [...chunk.columns] : current.columns,
        rows: merged.rows,
        windowStartOffset: merged.windowStartOffset,
        showSlowLoadHint: false,
        statusMessage: status,
      };
    });
  }

  private mergeWindow(currentRows: QueryRow[], currentStart: number, chunk: QueryChunk, mode: WindowMergeMode): { rows: QueryRow[]; windowStartOffset: number } {
    if (mode === "jump") {
      return {
        rows: [...chunk.rows].slice(0, this.windowSize),
        windowStartOffset: chunk.offset,
      };
    }

    if (mode === "forward") {
      let rows = [...currentRows, ...chunk.rows];
      let windowStartOffset = currentStart;

      if (rows.length > this.windowSize) {
        const trim = rows.length - this.windowSize;
        rows = rows.slice(trim);
        windowStartOffset += trim;
      }

      return {
        rows,
        windowStartOffset,
      };
    }

    let rows = [...chunk.rows, ...currentRows];
    const windowStartOffset = chunk.offset;
    if (rows.length > this.windowSize) {
      rows = rows.slice(0, this.windowSize);
    }

    return {
      rows,
      windowStartOffset,
    };
  }

  private buildWindowStatus(windowStart: number, rowCount: number, totalRows: number): string {
    if (totalRows === 0 || rowCount === 0) {
      return "Query returned 0 rows.";
    }

    const from = windowStart + 1;
    const to = Math.min(windowStart + rowCount, totalRows);
    return `Showing rows ${from.toLocaleString()}-${to.toLocaleString()} of ${totalRows.toLocaleString()}.`;
  }

  private alignOffset(index: number, chunkSize: number, totalRows: number): number {
    if (totalRows <= 0) {
      return 0;
    }

    const clampedIndex = Math.max(0, Math.min(index, totalRows - 1));
    return Math.floor(clampedIndex / chunkSize) * chunkSize;
  }

  private async closeActiveSession(): Promise<void> {
    const sessionId = this.state().activeSessionId;
    if (!sessionId) {
      return;
    }

    await this.closeSessionById(sessionId);
    if (this.state().activeSessionId === sessionId) {
      this.patch({ activeSessionId: null });
    }
  }

  private async closeSessionById(sessionId: string): Promise<void> {
    try {
      await this.bridge.closeQuerySession({ sessionId });
    } catch (error) {
      this.logs.warn("query", "Failed to close query session", {
        sessionId,
        error: this.parseError(error).rawMessage,
      });
    }
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
        statusMessage: previous.statusMessage !== this.state().statusMessage ? this.state().statusMessage : undefined,
        queryError: previous.queryError?.summary !== this.state().queryError?.summary ? this.state().queryError?.summary : undefined,
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

      return parsed.filter((item): item is string => typeof item === "string").slice(0, 20);
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

  private shouldUseDirectExecution(sql: string): boolean {
    const normalized = sql.trim().replace(/;+\s*$/, "");
    if (!/^select\s+count\s*\(\s*(\*|1)\s*\)\s+from\s+/i.test(normalized)) {
      return false;
    }

    return !/\b(group\s+by|having|union|intersect|except)\b|\bover\s*\(/i.test(normalized);
  }

  private buildPreviewQuery(sql: string): string {
    const normalized = sql.trim().replace(/;+\s*$/, "");
    if (/\blimit\s+\d+\b/i.test(normalized)) {
      return normalized;
    }

    return `${normalized} LIMIT ${this.initialChunkSize}`;
  }

  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private parseError(error: unknown): ParsedQueryError {
    return this.errorParser.parse(error);
  }

  private async yieldToUi(): Promise<void> {
    if (typeof requestAnimationFrame !== "function") {
      return;
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}
