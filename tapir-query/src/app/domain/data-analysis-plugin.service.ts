import { computed, inject, Injectable, signal } from "@angular/core";
import { CardinalityTopValue, ColumnProfileMetricKind, ColumnProfileMetricResult, ColumnSchema, CompletenessAudit, StringLengthHistogram } from "../infrastructure/tauri-contracts";
import { LogService } from "../infrastructure/log.service";
import { PerfService } from "../infrastructure/perf.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";

type MetricStatus = "idle" | "loading" | "ready" | "error";

interface AnalysisRefreshContext {
  tableName: string;
  sql: string;
  columns: ColumnSchema[];
}

interface AnalysisTask {
  columnName: string;
  metric: ColumnProfileMetricKind;
}

export interface AnalysisMetricSlot<T> {
  status: MetricStatus;
  value: T | null;
  error: string | null;
  elapsedMs: number | null;
}

export interface CardinalityMetricView {
  uniqueValueCount: number;
  topValues: CardinalityTopValue[];
}

export interface ColumnAnalysisProfile {
  columnName: string;
  dataType: string;
  totalRows: number | null;
  cardinality: AnalysisMetricSlot<CardinalityMetricView>;
  completeness: AnalysisMetricSlot<CompletenessAudit>;
  stringLength: AnalysisMetricSlot<StringLengthHistogram>;
}

interface DataAnalysisState {
  enabled: boolean;
  running: boolean;
  activeSignature: string | null;
  columns: ColumnAnalysisProfile[];
  totalTasks: number;
  completedTasks: number;
}

@Injectable({
  providedIn: "root",
})
export class DataAnalysisPluginService {
  private readonly bridge = inject(TauriBridgeService);
  private readonly logs = inject(LogService);
  private readonly perf = inject(PerfService);

  private readonly defaultMaxConcurrentTasks = 3;
  private readonly tauriMaxConcurrentTasks = 1;
  private readonly tauriRuntime = this.detectTauriRuntime();
  private readonly metricOrder: ColumnProfileMetricKind[] = ["completenessAudit", "cardinalityTopValues", "stringLengthHistogram"];

  private requestToken = 0;
  private activeSql: string | null = null;
  private readonly queuedTasks: AnalysisTask[] = [];
  private readonly queuedTaskKeys = new Set<string>();
  private activeWorkers = 0;
  private analysisBatchActive = false;

  private readonly state = signal<DataAnalysisState>({
    enabled: false,
    running: false,
    activeSignature: null,
    columns: [],
    totalTasks: 0,
    completedTasks: 0,
  });

  readonly enabled = computed(() => this.state().enabled);
  readonly running = computed(() => this.state().running);
  readonly activeSignature = computed(() => this.state().activeSignature);
  readonly columnProfiles = computed(() => this.state().columns);
  readonly totalTasks = computed(() => this.state().totalTasks);
  readonly completedTasks = computed(() => this.state().completedTasks);
  readonly completionRatio = computed(() => {
    const snapshot = this.state();
    if (snapshot.totalTasks === 0) {
      return 0;
    }

    return snapshot.completedTasks / snapshot.totalTasks;
  });
  readonly progressLabel = computed(() => {
    const snapshot = this.state();
    if (!snapshot.enabled) {
      return "Plugin disabled";
    }

    if (snapshot.totalTasks === 0) {
      if (snapshot.running) {
        return "Preparing analysis";
      }

      return snapshot.activeSignature ? "Drop a column to start analysis" : "Waiting for query result";
    }

    return `${snapshot.completedTasks} / ${snapshot.totalTasks} metrics`;
  });

  enable(): void {
    if (this.state().enabled) {
      return;
    }

    this.logs.info("analysis-plugin", "Analysis plugin enabled", {
      tauriRuntime: this.tauriRuntime,
      maxConcurrentTasks: this.resolveMaxConcurrentTasks(),
    });

    this.state.update((current) => ({
      ...current,
      enabled: true,
    }));
  }

  disable(): void {
    this.logs.info("analysis-plugin", "Analysis plugin disabled");
    this.stopActiveRun();
    this.state.set({
      enabled: false,
      running: false,
      activeSignature: null,
      columns: [],
      totalTasks: 0,
      completedTasks: 0,
    });
  }

  suspend(): void {
    if (!this.state().enabled) {
      return;
    }

    this.logs.debug("analysis-plugin", "Suspending analysis plugin until query stabilizes");
    this.stopActiveRun();
    this.state.update((current) => ({
      ...current,
      running: false,
      activeSignature: null,
      columns: [],
      totalTasks: 0,
      completedTasks: 0,
    }));
  }

  refresh(context: AnalysisRefreshContext): void {
    const snapshot = this.state();
    if (!snapshot.enabled) {
      return;
    }

    const normalizedSql = this.normalizeSql(context.sql);
    if (!normalizedSql) {
      return;
    }

    const signature = this.buildSignature(context.tableName, normalizedSql);
    if (context.columns.length === 0) {
      if (snapshot.activeSignature === signature && snapshot.columns.length === 0 && !snapshot.running) {
        return;
      }

      this.logs.debug("analysis-plugin", "Awaiting column drop before profiling starts", {
        signature,
      });

      this.stopActiveRun();
      this.state.set({
        enabled: true,
        running: false,
        activeSignature: signature,
        columns: [],
        totalTasks: 0,
        completedTasks: 0,
      });
      return;
    }

    const contextChanged = snapshot.activeSignature !== signature;
    if (contextChanged) {
      this.stopActiveRun();
      this.activeSql = normalizedSql;

      const loadingColumns = this.createLoadingColumns(context.columns);
      const progress = this.calculateProgress(loadingColumns);
      const visibleColumnNames = new Set(loadingColumns.map((column) => column.columnName));

      this.state.set({
        enabled: true,
        running: loadingColumns.length > 0,
        activeSignature: signature,
        columns: loadingColumns,
        totalTasks: progress.totalTasks,
        completedTasks: progress.completedTasks,
      });

      const tasks = this.buildTasks(context.columns);
      this.enqueueTasks(tasks, visibleColumnNames);
      this.logs.info("analysis-plugin", "Scheduling analysis queue", {
        tableName: context.tableName,
        columnCount: context.columns.length,
        taskCount: tasks.length,
        maxConcurrentTasks: this.resolveMaxConcurrentTasks(),
        tauriRuntime: this.tauriRuntime,
      });

      this.startWorkers(this.requestToken);
      return;
    }

    this.activeSql = normalizedSql;

    const mergeResult = this.mergeColumnsForSelection(snapshot.columns, context.columns);
    const visibleColumnNames = new Set(mergeResult.columns.map((column) => column.columnName));
    this.pruneQueuedTasks(visibleColumnNames);

    const tasks = this.buildTasks(mergeResult.newColumns);
    this.enqueueTasks(tasks, visibleColumnNames);

    const progress = this.calculateProgress(mergeResult.columns);
    this.state.update((current) => ({
      ...current,
      enabled: true,
      running: this.hasLoadingMetrics(mergeResult.columns) && this.isVisibleWorkPending(visibleColumnNames),
      activeSignature: signature,
      columns: mergeResult.columns,
      totalTasks: progress.totalTasks,
      completedTasks: progress.completedTasks,
    }));

    if (tasks.length > 0) {
      this.logs.info("analysis-plugin", "Scheduling analysis tasks for newly dropped columns", {
        addedColumns: mergeResult.newColumns.map((column) => column.name),
        taskCount: tasks.length,
      });
    }

    this.startWorkers(this.requestToken);
  }

  private async runTask(requestToken: number, sql: string, task: AnalysisTask): Promise<void> {
    const startedAt = performance.now();
    const totalRowsHint = this.currentTotalRowsForColumn(task.columnName);
    this.logs.debug("analysis-plugin", "Metric task started", {
      requestToken,
      columnName: task.columnName,
      metric: task.metric,
      totalRowsHint,
    });

    try {
      const result = await this.bridge.runColumnProfileMetric({
        sql,
        columnName: task.columnName,
        metric: task.metric,
        totalRowsHint,
      });

      if (!this.isActiveRequest(requestToken)) {
        this.logs.debug("analysis-plugin", "Metric result ignored due to stale token", {
          requestToken,
          columnName: task.columnName,
          metric: task.metric,
        });
        return;
      }

      this.perf.record("analysisProfile", result.elapsedMs);
      this.perf.record("analysisRoundTrip", performance.now() - startedAt);
      this.logs.info("analysis-plugin", "Metric task completed", {
        requestToken,
        columnName: task.columnName,
        metric: task.metric,
        elapsedMs: result.elapsedMs,
        totalRows: result.totalRows,
      });
      this.applyMetricResult(task, result);
    } catch (error) {
      if (!this.isActiveRequest(requestToken)) {
        this.logs.debug("analysis-plugin", "Metric error ignored due to stale token", {
          requestToken,
          columnName: task.columnName,
          metric: task.metric,
        });
        return;
      }

      this.logs.warn("analysis-plugin", "Profile metric failed", {
        columnName: task.columnName,
        metric: task.metric,
        error: this.extractError(error),
      });
      this.markMetricError(task, this.extractError(error), performance.now() - startedAt);
    } finally {
      if (this.isActiveRequest(requestToken)) {
        this.updateProgressAndRunning();
      }
    }
  }

  private startWorkers(requestToken: number): void {
    const maxConcurrentTasks = this.resolveMaxConcurrentTasks();

    while (this.isActiveRequest(requestToken) && this.activeWorkers < maxConcurrentTasks && this.queuedTasks.length > 0) {
      this.activeWorkers += 1;
      void this.runWorkerFromQueue(requestToken);
    }

    this.finishBatchIfIdle();
    this.updateProgressAndRunning();
  }

  private async runWorkerFromQueue(requestToken: number): Promise<void> {
    this.logs.debug("analysis-plugin", "Worker started", {
      requestToken,
    });

    try {
      while (this.isActiveRequest(requestToken)) {
        const task = this.queuedTasks.shift();
        if (!task) {
          this.logs.debug("analysis-plugin", "Worker completed", {
            requestToken,
          });
          return;
        }

        this.queuedTaskKeys.delete(this.taskKey(task));
        const sql = this.activeSql;
        if (!sql) {
          continue;
        }

        await this.runTask(requestToken, sql, task);
      }

      this.logs.debug("analysis-plugin", "Worker stopped due to stale token", {
        requestToken,
      });
    } finally {
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.startWorkers(this.requestToken);
    }
  }

  private applyMetricResult(task: AnalysisTask, result: ColumnProfileMetricResult): void {
    this.state.update((current) => {
      const columns = current.columns.map((column) => {
        if (column.columnName !== task.columnName) {
          return column;
        }

        const mergedTotalRows = column.totalRows === null ? result.totalRows : Math.max(column.totalRows, result.totalRows);

        if (task.metric === "cardinalityTopValues") {
          if (result.cardinalityTopValues === null || result.uniqueValueCount === null) {
            return {
              ...column,
              totalRows: mergedTotalRows,
              cardinality: this.createErrorSlot<CardinalityMetricView>("Missing cardinality payload", result.elapsedMs),
            };
          }

          return {
            ...column,
            totalRows: mergedTotalRows,
            cardinality: this.createReadySlot<CardinalityMetricView>(
              {
                uniqueValueCount: result.uniqueValueCount,
                topValues: [...result.cardinalityTopValues],
              },
              result.elapsedMs,
            ),
          };
        }

        if (task.metric === "completenessAudit") {
          if (result.completeness === null) {
            return {
              ...column,
              totalRows: mergedTotalRows,
              completeness: this.createErrorSlot<CompletenessAudit>("Missing completeness payload", result.elapsedMs),
            };
          }

          return {
            ...column,
            totalRows: mergedTotalRows,
            completeness: this.createReadySlot<CompletenessAudit>(result.completeness, result.elapsedMs),
          };
        }

        if (result.stringLengthHistogram === null) {
          return {
            ...column,
            totalRows: mergedTotalRows,
            stringLength: this.createErrorSlot<StringLengthHistogram>("Missing histogram payload", result.elapsedMs),
          };
        }

        return {
          ...column,
          totalRows: mergedTotalRows,
          stringLength: this.createReadySlot<StringLengthHistogram>(result.stringLengthHistogram, result.elapsedMs),
        };
      });

      return {
        ...current,
        columns,
      };
    });
  }

  private markMetricError(task: AnalysisTask, errorMessage: string, elapsedMs: number): void {
    this.state.update((current) => {
      const columns = current.columns.map((column) => {
        if (column.columnName !== task.columnName) {
          return column;
        }

        if (task.metric === "cardinalityTopValues") {
          return {
            ...column,
            cardinality: this.createErrorSlot<CardinalityMetricView>(errorMessage, elapsedMs),
          };
        }

        if (task.metric === "completenessAudit") {
          return {
            ...column,
            completeness: this.createErrorSlot<CompletenessAudit>(errorMessage, elapsedMs),
          };
        }

        return {
          ...column,
          stringLength: this.createErrorSlot<StringLengthHistogram>(errorMessage, elapsedMs),
        };
      });

      return {
        ...current,
        columns,
      };
    });
  }

  private createLoadingColumns(columns: ColumnSchema[]): ColumnAnalysisProfile[] {
    return columns.map((column) => this.createLoadingColumn(column));
  }

  private createLoadingColumn(column: ColumnSchema): ColumnAnalysisProfile {
    return {
      columnName: column.name,
      dataType: column.dataType,
      totalRows: null,
      cardinality: this.createLoadingSlot<CardinalityMetricView>(),
      completeness: this.createLoadingSlot<CompletenessAudit>(),
      stringLength: this.createLoadingSlot<StringLengthHistogram>(),
    };
  }

  private buildTasks(columns: ColumnSchema[]): AnalysisTask[] {
    const tasks: AnalysisTask[] = [];

    for (const column of columns) {
      for (const metric of this.metricOrder) {
        tasks.push({
          columnName: column.name,
          metric,
        });
      }
    }

    return tasks;
  }

  private createLoadingSlot<T>(): AnalysisMetricSlot<T> {
    return {
      status: "loading",
      value: null,
      error: null,
      elapsedMs: null,
    };
  }

  private createReadySlot<T>(value: T, elapsedMs: number): AnalysisMetricSlot<T> {
    return {
      status: "ready",
      value,
      error: null,
      elapsedMs: Number.isFinite(elapsedMs) ? Number(elapsedMs.toFixed(2)) : null,
    };
  }

  private createErrorSlot<T>(error: string, elapsedMs: number): AnalysisMetricSlot<T> {
    return {
      status: "error",
      value: null,
      error,
      elapsedMs: Number.isFinite(elapsedMs) ? Number(elapsedMs.toFixed(2)) : null,
    };
  }

  private stopActiveRun(): void {
    this.logs.debug("analysis-plugin", "Cancelling active analysis run", {
      requestToken: this.requestToken,
    });
    this.createRequestToken();
    this.activeSql = null;
    this.queuedTasks.length = 0;
    this.queuedTaskKeys.clear();
    if (this.analysisBatchActive) {
      this.perf.end("analysisBatch");
      this.analysisBatchActive = false;
    }
  }

  private resolveMaxConcurrentTasks(): number {
    if (this.tauriRuntime) {
      return this.tauriMaxConcurrentTasks;
    }

    return this.defaultMaxConcurrentTasks;
  }

  private detectTauriRuntime(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
  }

  private normalizeSql(sql: string): string {
    return sql
      .trim()
      .replace(/;+\s*$/, "")
      .trim();
  }

  private currentTotalRowsForColumn(columnName: string): number | null {
    const column = this.state().columns.find((entry) => entry.columnName === columnName);
    return column?.totalRows ?? null;
  }

  private buildSignature(tableName: string, sql: string): string {
    return `${tableName}::${sql}`;
  }

  private mergeColumnsForSelection(existing: ColumnAnalysisProfile[], selected: ColumnSchema[]): { columns: ColumnAnalysisProfile[]; newColumns: ColumnSchema[] } {
    const existingByName = new Map(existing.map((column) => [column.columnName, column]));
    const newColumns: ColumnSchema[] = [];

    const columns = selected.map((selectedColumn) => {
      const existingColumn = existingByName.get(selectedColumn.name);
      if (!existingColumn) {
        newColumns.push(selectedColumn);
        return this.createLoadingColumn(selectedColumn);
      }

      if (existingColumn.dataType !== selectedColumn.dataType) {
        return {
          ...existingColumn,
          dataType: selectedColumn.dataType,
        };
      }

      return existingColumn;
    });

    return {
      columns,
      newColumns,
    };
  }

  private calculateProgress(columns: ColumnAnalysisProfile[]): { totalTasks: number; completedTasks: number } {
    let completedTasks = 0;

    for (const column of columns) {
      if (column.completeness.status === "ready" || column.completeness.status === "error") {
        completedTasks += 1;
      }
      if (column.cardinality.status === "ready" || column.cardinality.status === "error") {
        completedTasks += 1;
      }
      if (column.stringLength.status === "ready" || column.stringLength.status === "error") {
        completedTasks += 1;
      }
    }

    return {
      totalTasks: columns.length * this.metricOrder.length,
      completedTasks,
    };
  }

  private hasLoadingMetrics(columns: ColumnAnalysisProfile[]): boolean {
    return columns.some((column) => column.completeness.status === "loading" || column.cardinality.status === "loading" || column.stringLength.status === "loading");
  }

  private isVisibleWorkPending(visibleColumnNames: Set<string>): boolean {
    if (this.activeWorkers > 0) {
      return true;
    }

    return this.queuedTasks.some((task) => visibleColumnNames.has(task.columnName));
  }

  private enqueueTasks(tasks: AnalysisTask[], visibleColumnNames: Set<string>): number {
    let enqueuedTasks = 0;

    for (const task of tasks) {
      if (!visibleColumnNames.has(task.columnName)) {
        continue;
      }

      const key = this.taskKey(task);
      if (this.queuedTaskKeys.has(key)) {
        continue;
      }

      this.queuedTaskKeys.add(key);
      this.queuedTasks.push(task);
      enqueuedTasks += 1;
    }

    if (enqueuedTasks > 0 && !this.analysisBatchActive) {
      this.perf.start("analysisBatch");
      this.analysisBatchActive = true;
    }

    return enqueuedTasks;
  }

  private pruneQueuedTasks(visibleColumnNames: Set<string>): void {
    if (this.queuedTasks.length === 0) {
      return;
    }

    const remainingTasks = this.queuedTasks.filter((task) => visibleColumnNames.has(task.columnName));
    if (remainingTasks.length === this.queuedTasks.length) {
      return;
    }

    this.queuedTasks.length = 0;
    this.queuedTasks.push(...remainingTasks);

    this.queuedTaskKeys.clear();
    for (const task of remainingTasks) {
      this.queuedTaskKeys.add(this.taskKey(task));
    }

    this.finishBatchIfIdle();
  }

  private finishBatchIfIdle(): void {
    if (this.activeWorkers === 0 && this.queuedTasks.length === 0 && this.analysisBatchActive) {
      this.perf.end("analysisBatch");
      this.analysisBatchActive = false;
    }
  }

  private updateProgressAndRunning(): void {
    this.state.update((current) => {
      const progress = this.calculateProgress(current.columns);
      const visibleColumnNames = new Set(current.columns.map((column) => column.columnName));

      return {
        ...current,
        running: this.hasLoadingMetrics(current.columns) && this.isVisibleWorkPending(visibleColumnNames),
        totalTasks: progress.totalTasks,
        completedTasks: progress.completedTasks,
      };
    });
  }

  private taskKey(task: AnalysisTask): string {
    return `${task.columnName}::${task.metric}`;
  }

  private createRequestToken(): number {
    this.requestToken += 1;
    return this.requestToken;
  }

  private isActiveRequest(token: number): boolean {
    return token === this.requestToken;
  }

  private extractError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown profiling runtime error";
  }
}
