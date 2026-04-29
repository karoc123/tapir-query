import { Injectable, computed, inject, signal } from "@angular/core";
import { ColumnSchema, OpenFileResponse } from "../infrastructure/tauri-contracts";
import { LogService } from "../infrastructure/log.service";

interface FileState {
  currentFilePath: string | null;
  currentTable: string | null;
  schemaColumns: ColumnSchema[];
  fileSizeBytes: number | null;
}

@Injectable({
  providedIn: "root",
})
export class FileService {
  private readonly logs = inject(LogService);

  private readonly state = signal<FileState>({
    currentFilePath: null,
    currentTable: null,
    schemaColumns: [],
    fileSizeBytes: null,
  });

  readonly currentFilePath = computed(() => this.state().currentFilePath);
  readonly currentTable = computed(() => this.state().currentTable);
  readonly schemaColumns = computed(() => this.state().schemaColumns);
  readonly fileSizeBytes = computed(() => this.state().fileSizeBytes);
  readonly currentFileName = computed(() => {
    const path = this.state().currentFilePath;
    if (!path) {
      return null;
    }

    const segments = path.split(/[/\\]/);
    return segments[segments.length - 1] ?? path;
  });
  readonly currentFileSizeLabel = computed(() => this.formatBytes(this.state().fileSizeBytes));

  setOpenedFile(opened: OpenFileResponse): void {
    this.logs.info("file", "Registered opened file", {
      tableName: opened.tableName,
      filePath: opened.filePath,
      columns: opened.columns.length,
      fileSizeBytes: opened.fileSizeBytes,
    });

    this.state.set({
      currentFilePath: opened.filePath,
      currentTable: opened.tableName,
      schemaColumns: [...opened.columns],
      fileSizeBytes: opened.fileSizeBytes,
    });
  }

  clear(): void {
    this.logs.info("file", "Cleared active file state");

    this.state.set({
      currentFilePath: null,
      currentTable: null,
      schemaColumns: [],
      fileSizeBytes: null,
    });
  }

  private formatBytes(bytes: number | null): string {
    if (bytes === null || !Number.isFinite(bytes)) {
      return "Size unavailable";
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    }

    const mb = kb / 1024;
    if (mb < 1024) {
      return `${mb.toFixed(1)} MB`;
    }

    return `${(mb / 1024).toFixed(2)} GB`;
  }
}
