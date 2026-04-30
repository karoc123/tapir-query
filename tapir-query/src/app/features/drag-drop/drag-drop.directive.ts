import { Directive, HostBinding, HostListener, inject, output, signal } from "@angular/core";
import { LogService } from "../../infrastructure/log.service";

@Directive({
  selector: "[tapirDragDrop]",
  standalone: true,
})
export class DragDropDirective {
  private readonly logs = inject(LogService);

  readonly fileDropped = output<string>();
  readonly dropError = output<string>();

  private readonly dragActive = signal(false);

  @HostBinding("class.drag-active")
  get isDragActive(): boolean {
    return this.dragActive();
  }

  @HostListener("dragover", ["$event"])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    this.dragActive.set(true);
  }

  @HostListener("dragleave", ["$event"])
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  @HostListener("drop", ["$event"])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);

    this.logs.info("drag-drop", "Drop event received");

    const filePath = this.extractPath(event);
    if (filePath) {
      if (!this.looksLikeCsv(filePath)) {
        const message = "Only CSV files are supported. Drop a .csv file.";
        this.logs.warn("drag-drop", message, { filePath });
        this.dropError.emit(message);
        return;
      }

      this.logs.info("drag-drop", "Resolved dropped file path", { filePath });
      this.fileDropped.emit(filePath);
      return;
    }

    const message = "Unable to resolve file path from drop event. Drop the file directly from your file manager.";
    this.logs.error("drag-drop", message);
    this.dropError.emit(message);
  }

  private extractPath(event: DragEvent): string | null {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return null;
    }

    const uriList = transfer.getData("text/uri-list");
    if (uriList) {
      const firstUri = uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("file://"));

      if (firstUri) {
        return this.normalizeFilePath(firstUri);
      }
    }

    const droppedFile = transfer.files.item(0) as (File & { path?: string }) | null;
    if (droppedFile?.path) {
      return this.normalizeFilePath(droppedFile.path);
    }

    const textPath = transfer.getData("text/plain").trim();
    if (textPath) {
      return this.normalizeFilePath(textPath);
    }

    return null;
  }

  private normalizeFilePath(path: string): string {
    const trimmed = path.trim();
    if (trimmed.startsWith("file://")) {
      try {
        const parsed = new URL(trimmed);
        return this.stripWindowsDrivePrefix(decodeURIComponent(parsed.pathname));
      } catch {
        return this.stripWindowsDrivePrefix(decodeURIComponent(trimmed.replace(/^file:\/\//, "")));
      }
    }

    return this.stripWindowsDrivePrefix(trimmed);
  }

  private stripWindowsDrivePrefix(path: string): string {
    if (/^\/[A-Za-z]:[\\/]/.test(path)) {
      return path.slice(1);
    }

    return path;
  }

  private looksLikeCsv(filePath: string): boolean {
    return /\.csv$/i.test(filePath);
  }
}
