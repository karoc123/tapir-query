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

  refresh(context: AnalysisRefreshContext): void {
    const snapshot = this.state();
    if (!snapshot.enabled) {
      return;
    }

    const normalizedSql = this.normalizeSql(context.sql);
    if (!normalizedSql) {
      return;
    }

    const signature = this.buildSignature(context.tableName, normalizedSql, context.columns);
    if (context.columns.length === 0) {
      if (snapshot.activeSignature === signature && snapshot.columns.length === 0 && !snapshot.running) {
        return;
      }

      this.logs.debug("analysis-plugin", "Awaiting column drop before profiling starts", {
        signature,
      });

      this.stopActiveRun();
      this.state.update((current) => ({
        ...current,
        enabled: true,
        running: false,
        activeSignature: signature,
        columns: [],
        totalTasks: 0,
        completedTasks: 0,
      }));
      return;
    }

    if (snapshot.activeSignature === signature && snapshot.columns.length > 0) {
      this.logs.debug("analysis-plugin", "Skipping refresh for unchanged analysis signature", {
        signature,
        running: snapshot.running,
        completedTasks: snapshot.completedTasks,
        totalTasks: snapshot.totalTasks,
      });
      return;
    }

    const tasks = this.buildTasks(context.columns);
    const nextToken = this.createRequestToken();
    const maxConcurrentTasks = this.resolveMaxConcurrentTasks();

    this.logs.info("analysis-plugin", "Scheduling analysis queue", {
      tableName: context.tableName,
      columnCount: context.columns.length,
      taskCount: tasks.length,
      maxConcurrentTasks,
      tauriRuntime: this.tauriRuntime,
    });

    this.perf.start("analysisBatch");
    this.state.set({
      enabled: true,
      running: tasks.length > 0,
      activeSignature: signature,
      columns: this.createLoadingColumns(context.columns),
      totalTasks: tasks.length,
      completedTasks: 0,
    });

    if (tasks.length === 0) {
      this.perf.end("analysisBatch");
      return;
    }

    void this.executeTaskQueue(nextToken, normalizedSql, tasks, maxConcurrentTasks);
  }

  private async executeTaskQueue(requestToken: number, sql: string, tasks: AnalysisTask[], maxConcurrentTasks: number): Promise<void> {
    const workerCount = Math.min(maxConcurrentTasks, tasks.length);
    this.logs.debug("analysis-plugin", "Analysis queue started", {
      workerCount,
      queuedTasks: tasks.length,
      requestToken,
    });
    const workers = Array.from({ length: workerCount }, () => this.runWorker(requestToken, sql, tasks));

    await Promise.all(workers);

    if (!this.isActiveRequest(requestToken)) {
      this.logs.debug("analysis-plugin", "Analysis queue finished for stale token", {
        requestToken,
      });
      return;
    }

    this.perf.end("analysisBatch");
    this.logs.info("analysis-plugin", "Analysis queue completed", {
      requestToken,
      completedTasks: this.state().completedTasks,
      totalTasks: this.state().totalTasks,
    });
    this.state.update((current) => ({
      ...current,
      running: false,
    }));
  }

  private async runWorker(requestToken: number, sql: string, tasks: AnalysisTask[]): Promise<void> {
    this.logs.debug("analysis-plugin", "Worker started", {
      requestToken,
    });

    while (this.isActiveRequest(requestToken)) {
      const task = tasks.shift();
      if (!task) {
        this.logs.debug("analysis-plugin", "Worker completed", {
          requestToken,
        });
        return;
      }

      await this.runTask(requestToken, sql, task);
    }

    this.logs.debug("analysis-plugin", "Worker stopped due to stale token", {
      requestToken,
    });
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
        this.state.update((current) => ({
          ...current,
          completedTasks: Math.min(current.completedTasks + 1, current.totalTasks),
        }));
      }
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
    return columns.map((column) => ({
      columnName: column.name,
      dataType: column.dataType,
      totalRows: null,
      cardinality: this.createLoadingSlot<CardinalityMetricView>(),
      completeness: this.createLoadingSlot<CompletenessAudit>(),
      stringLength: this.createLoadingSlot<StringLengthHistogram>(),
    }));
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
    this.perf.end("analysisBatch");
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

  private buildSignature(tableName: string, sql: string, columns: ColumnSchema[]): string {
    const schemaFingerprint = columns.map((column) => `${column.name}:${column.dataType}`).join("|");
    return `${tableName}::${sql}::${schemaFingerprint}`;
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
