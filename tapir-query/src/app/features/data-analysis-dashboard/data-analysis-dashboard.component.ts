import { CommonModule } from "@angular/common";
import { Component, input, output, signal } from "@angular/core";
import { CardinalityMetricView, ColumnAnalysisProfile } from "../../domain/data-analysis-plugin.service";
import { CompletenessAudit, StringLengthHistogram } from "../../infrastructure/tauri-contracts";

interface AnalysisColumnDropPayload {
  columnName: string;
  dataType: string | null;
}

@Component({
  selector: "app-data-analysis-dashboard",
  imports: [CommonModule],
  templateUrl: "./data-analysis-dashboard.component.html",
  styleUrl: "./data-analysis-dashboard.component.css",
})
export class DataAnalysisDashboardComponent {
  private readonly acceptedTransferTypes = ["application/x-tapir-column-name", "text/x-tapir-column-name", "text/plain", "Text"];

  readonly columns = input.required<ColumnAnalysisProfile[]>();
  readonly running = input(false);
  readonly progressLabel = input("Waiting for query result");
  readonly completionRatio = input(0);
  readonly columnDropped = output<AnalysisColumnDropPayload>();
  readonly columnRemoved = output<string>();

  private readonly dragActive = signal(false);
  private dragDepth = 0;

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

  onDropZoneDragEnter(event: DragEvent): void {
    if (!this.hasSupportedColumnTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    this.dragDepth += 1;
    this.dragActive.set(true);
  }

  onDropZoneDragOver(event: DragEvent): void {
    if (!this.hasSupportedColumnTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    this.dragActive.set(true);
  }

  onDropZoneDragLeave(event: DragEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (target && relatedTarget && target.contains(relatedTarget)) {
      return;
    }

    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.dragActive.set(false);
    }
  }

  onDropZoneDrop(event: DragEvent): void {
    event.preventDefault();
    this.resetDragState();

    const transfer = event.dataTransfer;
    if (!transfer || transfer.files.length > 0) {
      return;
    }

    const columnName = this.readTransferData(transfer, this.acceptedTransferTypes);
    if (!columnName) {
      return;
    }

    const dataType = this.readTransferData(transfer, ["application/x-tapir-column-type", "text/x-tapir-column-type"]);
    this.columnDropped.emit({
      columnName,
      dataType: dataType || null,
    });
  }

  removeColumn(columnName: string): void {
    this.columnRemoved.emit(columnName);
  }

  private hasSupportedColumnTransfer(transfer: DataTransfer | null): boolean {
    if (!transfer) {
      return false;
    }

    const transferTypes = transfer.types;
    if (!transferTypes || transferTypes.length === 0) {
      return true;
    }

    for (let index = 0; index < transferTypes.length; index += 1) {
      if (this.acceptedTransferTypes.includes(transferTypes[index])) {
        return true;
      }
    }

    return false;
  }

  private resetDragState(): void {
    this.dragDepth = 0;
    this.dragActive.set(false);
  }

  private readTransferData(transfer: DataTransfer, types: string[]): string {
    for (const type of types) {
      const value = transfer.getData(type).trim();
      if (value) {
        return value;
      }
    }

    return "";
  }
}
