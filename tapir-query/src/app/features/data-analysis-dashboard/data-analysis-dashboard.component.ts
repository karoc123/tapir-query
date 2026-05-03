import { DragDropModule } from "@angular/cdk/drag-drop";
import { CommonModule } from "@angular/common";
import { Component, input, output, signal } from "@angular/core";
import { CardinalityMetricView, ColumnAnalysisProfile } from "../../domain/data-analysis-plugin.service";
import { ColumnSchema, CompletenessAudit, StringLengthHistogram } from "../../infrastructure/tauri-contracts";

interface AnalysisColumnDropPayload {
  columnName: string;
  dataType: string | null;
}

@Component({
  selector: "app-data-analysis-dashboard",
  imports: [CommonModule, DragDropModule],
  templateUrl: "./data-analysis-dashboard.component.html",
  styleUrl: "./data-analysis-dashboard.component.css",
})
export class DataAnalysisDashboardComponent {
  readonly analysisColumnSourceDropListId = "tapir-analysis-column-source";
  readonly connectedDropListIds = [this.analysisColumnSourceDropListId];

  readonly columns = input.required<ColumnAnalysisProfile[]>();
  readonly running = input(false);
  readonly progressLabel = input("Waiting for query result");
  readonly completionRatio = input(0);
  readonly columnDropped = output<AnalysisColumnDropPayload>();
  readonly columnRemoved = output<string>();

  private readonly dragActive = signal(false);

  readonly dropActive = this.dragActive.asReadonly();

  trackByColumn(_index: number, column: ColumnAnalysisProfile): string {
    return column.columnName;
  }

  maxCardinalityFrequency(metric: CardinalityMetricView | null): number {
    if (!metric || metric.topValues.length === 0) {
      return 1;
    }

    return Math.max(...metric.topValues.map((entry) => entry.frequency), 1);
  }

  maxHistogramFrequency(histogram: StringLengthHistogram | null): number {
    if (!histogram || histogram.buckets.length === 0) {
      return 1;
    }

    return Math.max(...histogram.buckets.map((bucket) => bucket.frequency), 1);
  }

  completionPercentage(audit: CompletenessAudit | null): number {
    if (!audit) {
      return 0;
    }

    return Number((audit.completenessRatio * 100).toFixed(1));
  }

  toPercent(value: number, maxValue: number): string {
    if (maxValue <= 0) {
      return "0%";
    }

    return `${Math.max(0, Math.min(100, (value / maxValue) * 100)).toFixed(1)}%`;
  }

  onDropZoneDragEnter(data: unknown): void {
    if (this.toDroppedColumn(data) === null) {
      return;
    }

    this.dragActive.set(true);
  }

  onDropZoneDragLeave(data: unknown): void {
    if (this.toDroppedColumn(data) === null) {
      return;
    }

    this.dragActive.set(false);
  }

  onDropZoneDrop(data: unknown): void {
    this.dragActive.set(false);

    const column = this.toDroppedColumn(data);
    if (column === null) {
      return;
    }

    this.columnDropped.emit({
      columnName: column.columnName,
      dataType: column.dataType,
    });
  }

  removeColumn(columnName: string): void {
    this.columnRemoved.emit(columnName);
  }

  private toDroppedColumn(data: unknown): AnalysisColumnDropPayload | null {
    if (!this.isColumnSchema(data)) {
      return null;
    }

    const columnName = data.name.trim();
    if (!columnName) {
      return null;
    }

    return {
      columnName,
      dataType: data.dataType,
    };
  }

  private isColumnSchema(data: unknown): data is ColumnSchema {
    if (typeof data !== "object" || data === null) {
      return false;
    }

    const record = data as Record<string, unknown>;
    return typeof record["name"] === "string" && typeof record["dataType"] === "string";
  }
}
