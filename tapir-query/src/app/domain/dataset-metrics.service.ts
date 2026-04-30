import { computed, inject, Injectable, signal } from "@angular/core";
import { QueryChunk } from "../infrastructure/tauri-contracts";
import { LogService } from "../infrastructure/log.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";

interface DatasetMetricsState {
  signature: string | null;
  filteredCount: number | null;
  filteredOverflow: boolean;
  totalCount: number | null;
  totalOverflow: boolean;
  filteredPending: boolean;
  totalPending: boolean;
}

interface ParsedCount {
  value: number;
  overflow: boolean;
}

@Injectable({
  providedIn: "root",
})
export class DatasetMetricsService {
  private readonly bridge = inject(TauriBridgeService);
  private readonly logs = inject(LogService);

  private requestToken = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly state = signal<DatasetMetricsState>({
    signature: null,
    filteredCount: null,
    filteredOverflow: false,
    totalCount: null,
    totalOverflow: false,
    filteredPending: false,
    totalPending: false,
  });

  readonly filteredCount = computed(() => this.state().filteredCount);
  readonly totalCount = computed(() => this.state().totalCount);
  readonly filteredPending = computed(() => this.state().filteredPending);
  readonly totalPending = computed(() => this.state().totalPending);
  readonly hasActiveSignature = computed(() => this.state().signature !== null);

  readonly rowStatusLabel = computed(() => {
    const snapshot = this.state();
    if (snapshot.signature === null) {
      return "0 of 0 Rows";
    }

    const filtered = this.formatCount(snapshot.filteredCount, snapshot.filteredOverflow, snapshot.filteredPending);

    if (snapshot.totalPending || snapshot.totalCount === null) {
      return `${filtered} of Loading... Rows`;
    }

    const total = this.formatCount(snapshot.totalCount, snapshot.totalOverflow, false);

    return `${filtered} of ${total} Rows`;
  });

  refresh(sql: string, tableName: string): void {
    const normalizedSql = this.normalizeSql(sql);
    const normalizedTable = tableName.trim();

    if (!normalizedSql || !normalizedTable) {
      this.clear();
      return;
    }

    // Incident mitigation: on desktop runtime we avoid background COUNT scans
    // because they correlate with query-time WebKit watchdog crashes.
    if (this.shouldDisableBackgroundCounts()) {
      this.clear();
      return;
    }

    // Preview SQL uses LIMIT and should avoid background COUNT scans to keep
    // initial file-open interaction responsive on constrained runtimes.
    if (this.shouldSkipBackgroundCounts(normalizedSql)) {
      this.clear();
      return;
    }

    const signature = `${normalizedTable}::${normalizedSql}`;
    const current = this.state();

    const alreadyResolved = current.signature === signature && !current.filteredPending && !current.totalPending && current.filteredCount !== null && current.totalCount !== null;

    if (alreadyResolved) {
      return;
    }

    const requestToken = this.createRequestToken();

    this.state.set({
      signature,
      filteredCount: null,
      filteredOverflow: false,
      totalCount: null,
      totalOverflow: false,
      filteredPending: true,
      totalPending: true,
    });

    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
    }

    // Schedule counts after the main query render path so query UX stays responsive.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.resolveCountsInBackground(requestToken, normalizedSql, normalizedTable);
    }, 0);
  }

  clear(): void {
    this.createRequestToken();

    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.state.set({
      signature: null,
      filteredCount: null,
      filteredOverflow: false,
      totalCount: null,
      totalOverflow: false,
      filteredPending: false,
      totalPending: false,
    });
  }

  private async resolveCountsInBackground(requestToken: number, sql: string, tableName: string): Promise<void> {
    try {
      const filteredChunk = await this.bridge.executeQuery({
        sql: this.buildFilteredCountSql(sql),
        limit: 1,
        offset: 0,
      });

      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      const filtered = this.parseCount(filteredChunk);
      this.state.update((current) => ({
        ...current,
        filteredCount: filtered?.value ?? null,
        filteredOverflow: filtered?.overflow ?? false,
        filteredPending: false,
      }));
    } catch (error) {
      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      this.logs.warn("dataset-metrics", "Filtered row count query failed.", {
        error: this.extractError(error),
      });

      this.state.update((current) => ({
        ...current,
        filteredCount: null,
        filteredOverflow: false,
        filteredPending: false,
      }));
    }

    try {
      const totalChunk = await this.bridge.executeQuery({
        sql: this.buildTotalCountSql(tableName),
        limit: 1,
        offset: 0,
      });

      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      const total = this.parseCount(totalChunk);
      this.state.update((current) => ({
        ...current,
        totalCount: total?.value ?? null,
        totalOverflow: total?.overflow ?? false,
        totalPending: false,
      }));
    } catch (error) {
      if (!this.isActiveRequest(requestToken)) {
        return;
      }

      this.logs.warn("dataset-metrics", "Total row count query failed.", {
        error: this.extractError(error),
      });

      this.state.update((current) => ({
        ...current,
        totalCount: null,
        totalOverflow: false,
        totalPending: false,
      }));
    }
  }

  private buildFilteredCountSql(sql: string): string {
    return `SELECT COUNT(*) AS "tapir_count" FROM (${sql}) AS tapir_filtered`;
  }

  private buildTotalCountSql(tableName: string): string {
    return `SELECT COUNT(*) AS "tapir_count" FROM ${this.quoteIdentifier(tableName)}`;
  }

  private normalizeSql(sql: string): string {
    return sql
      .trim()
      .replace(/;+\s*$/, "")
      .trim();
  }

  private shouldSkipBackgroundCounts(sql: string): boolean {
    return /\blimit\s+\d+\b/i.test(sql);
  }

  private shouldDisableBackgroundCounts(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
  }

  private parseCount(chunk: QueryChunk): ParsedCount | null {
    const row = chunk.rows[0];
    if (!row) {
      return {
        value: 0,
        overflow: false,
      };
    }

    const rawCount = row["tapir_count"] ?? row["tapirCount"] ?? row["COUNT(*)"] ?? Object.values(row)[0] ?? null;

    if (rawCount === null) {
      return null;
    }

    const rawText = String(rawCount).trim();
    if (!/^-?\d+$/.test(rawText)) {
      return null;
    }

    let parsed = BigInt(rawText);
    if (parsed < 0n) {
      parsed = 0n;
    }

    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (parsed > maxSafe) {
      return {
        value: Number.MAX_SAFE_INTEGER,
        overflow: true,
      };
    }

    return {
      value: Number(parsed),
      overflow: false,
    };
  }

  private formatCount(value: number | null, overflow: boolean, pending: boolean): string {
    if (value === null) {
      return pending ? "Loading..." : "0";
    }

    return `${value.toLocaleString()}${overflow ? "+" : ""}`;
  }

  private quoteIdentifier(identifier: string): string {
    return identifier
      .split(".")
      .map((segment) => `"${segment.replace(/"/g, '""')}"`)
      .join(".");
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

    return "Unknown runtime error";
  }
}
