import { Injectable, computed, signal } from "@angular/core";

interface PerfMetric {
  key: string;
  label: string;
  latestMs: number;
  averageMs: number;
  samples: number;
}

@Injectable({
  providedIn: "root",
})
export class PerfService {
  private readonly starts = new Map<string, number>();

  private readonly metricsState = signal<Record<string, PerfMetric>>({
    bootup: this.createMetric("bootup", "Bootup"),
    fileLoad: this.createMetric("fileLoad", "File Load"),
    queryEngine: this.createMetric("queryEngine", "Query Engine"),
    queryRoundTrip: this.createMetric("queryRoundTrip", "Query Roundtrip"),
    renderGrid: this.createMetric("renderGrid", "Grid Render"),
    analysisBatch: this.createMetric("analysisBatch", "Analysis Batch"),
    analysisProfile: this.createMetric("analysisProfile", "Analysis Profile"),
    analysisRoundTrip: this.createMetric("analysisRoundTrip", "Analysis Roundtrip"),
  });
  private readonly dashboardOpenState = signal(false);

  readonly metrics = computed(() => Object.values(this.metricsState()));
  readonly dashboardOpen = computed(() => this.dashboardOpenState());

  constructor() {
    this.start("bootup");
  }

  start(key: string): void {
    this.starts.set(key, performance.now());
  }

  end(key: string): void {
    const startedAt = this.starts.get(key);
    if (startedAt === undefined) {
      return;
    }

    this.starts.delete(key);
    this.record(key, performance.now() - startedAt);
  }

  record(key: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    const rounded = Number(durationMs.toFixed(2));

    this.metricsState.update((current) => {
      const existing = current[key] ?? this.createMetric(key, this.toTitle(key));
      const samples = existing.samples + 1;
      const averageMs = Number(((existing.averageMs * existing.samples + rounded) / samples).toFixed(2));

      return {
        ...current,
        [key]: {
          ...existing,
          latestMs: rounded,
          averageMs,
          samples,
        },
      };
    });
  }

  markBootReady(): void {
    this.end("bootup");
  }

  openDashboard(): void {
    this.dashboardOpenState.set(true);
  }

  closeDashboard(): void {
    this.dashboardOpenState.set(false);
  }

  toggleDashboard(): void {
    this.dashboardOpenState.update((open) => !open);
  }

  private createMetric(key: string, label: string): PerfMetric {
    return {
      key,
      label,
      latestMs: 0,
      averageMs: 0,
      samples: 0,
    };
  }

  private toTitle(key: string): string {
    return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
  }
}
