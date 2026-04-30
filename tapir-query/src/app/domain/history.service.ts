import { computed, effect, inject, Injectable, signal, untracked } from "@angular/core";
import { QueryHistoryEntry } from "../infrastructure/tauri-contracts";
import { LogService } from "../infrastructure/log.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { QueryExecutionEventsService } from "./query-execution-events.service";

interface HistoryState {
  entries: QueryHistoryEntry[];
  loaded: boolean;
}

@Injectable({
  providedIn: "root",
})
export class HistoryService {
  private readonly bridge = inject(TauriBridgeService);
  private readonly logs = inject(LogService);
  private readonly queryExecutionEvents = inject(QueryExecutionEventsService);

  private readonly entryLimit = 50;
  private lastProcessedExecutionSequence = 0;
  private persistQueue: Promise<void> = Promise.resolve();

  private readonly state = signal<HistoryState>({
    entries: [],
    loaded: false,
  });

  readonly entries = computed(() => this.state().entries);
  readonly loaded = computed(() => this.state().loaded);

  private readonly captureSuccessfulQueryEffect = effect(() => {
    const executions = this.queryExecutionEvents.successfulExecutions();
    const pendingExecutions = executions.filter((execution) => execution.sequence > this.lastProcessedExecutionSequence);
    if (pendingExecutions.length === 0) {
      return;
    }

    untracked(() => {
      for (const execution of pendingExecutions) {
        this.recordSuccessfulQuery(execution.sql, execution.executedAtUnixMs);
      }

      this.lastProcessedExecutionSequence = pendingExecutions[pendingExecutions.length - 1]!.sequence;
    });
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await this.bridge.loadQueryHistory();
      const sanitizedEntries = this.sanitizeEntries(response.entries);
      const mergedEntries = this.mergeEntries(this.state().entries, sanitizedEntries);

      this.state.set({
        entries: mergedEntries,
        loaded: true,
      });

      if (!this.areEntriesEqual(mergedEntries, sanitizedEntries)) {
        this.queuePersist(mergedEntries);
      }
    } catch (error) {
      this.logs.warn("history", "Failed to load query history", {
        error: this.extractError(error),
      });

      this.state.set({
        entries: [],
        loaded: true,
      });
    }
  }

  private recordSuccessfulQuery(sql: string, executedAtUnixMs: number): void {
    const normalizedSql = sql.trim();
    if (!normalizedSql) {
      return;
    }

    const nextEntries = this.computeNextEntries(this.state().entries, {
      sql: normalizedSql,
      executedAtUnixMs: this.normalizeTimestamp(executedAtUnixMs),
    });

    this.state.update((current) => ({
      ...current,
      entries: nextEntries,
    }));

    this.queuePersist(nextEntries);
  }

  private computeNextEntries(existing: QueryHistoryEntry[], next: QueryHistoryEntry): QueryHistoryEntry[] {
    return [next, ...existing.filter((entry) => entry.sql !== next.sql)].slice(0, this.entryLimit);
  }

  private sanitizeEntries(entries: QueryHistoryEntry[]): QueryHistoryEntry[] {
    const deduplicated: QueryHistoryEntry[] = [];
    const seenSql = new Set<string>();

    for (const entry of entries) {
      const normalizedSql = (entry.sql ?? "").trim();
      if (!normalizedSql || seenSql.has(normalizedSql)) {
        continue;
      }

      deduplicated.push({
        sql: normalizedSql,
        executedAtUnixMs: this.normalizeTimestamp(entry.executedAtUnixMs),
      });
      seenSql.add(normalizedSql);

      if (deduplicated.length >= this.entryLimit) {
        break;
      }
    }

    return deduplicated;
  }

  private mergeEntries(primary: QueryHistoryEntry[], secondary: QueryHistoryEntry[]): QueryHistoryEntry[] {
    const merged: QueryHistoryEntry[] = [];
    const seenSql = new Set<string>();

    for (const source of [primary, secondary]) {
      for (const entry of source) {
        if (seenSql.has(entry.sql)) {
          continue;
        }

        merged.push({
          sql: entry.sql,
          executedAtUnixMs: this.normalizeTimestamp(entry.executedAtUnixMs),
        });
        seenSql.add(entry.sql);

        if (merged.length >= this.entryLimit) {
          return merged;
        }
      }
    }

    return merged;
  }

  private areEntriesEqual(left: QueryHistoryEntry[], right: QueryHistoryEntry[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index]?.sql !== right[index]?.sql) {
        return false;
      }

      if (left[index]?.executedAtUnixMs !== right[index]?.executedAtUnixMs) {
        return false;
      }
    }

    return true;
  }

  private queuePersist(entries: QueryHistoryEntry[]): void {
    const entriesSnapshot = entries.map((entry) => ({
      sql: entry.sql,
      executedAtUnixMs: entry.executedAtUnixMs,
    }));

    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        await this.bridge.saveQueryHistory({
          entries: entriesSnapshot,
        });
      })
      .catch((error) => {
        this.logs.warn("history", "Failed to persist query history", {
          error: this.extractError(error),
        });
      });
  }

  private normalizeTimestamp(value: number): number {
    if (!Number.isFinite(value)) {
      return Date.now();
    }

    return Math.max(0, Math.trunc(value));
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
