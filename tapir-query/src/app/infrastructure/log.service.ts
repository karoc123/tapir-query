import { Injectable, computed, signal } from "@angular/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  details?: unknown;
}

@Injectable({
  providedIn: "root",
})
export class LogService {
  private readonly maxEntries = 500;
  private nextId = 1;

  private readonly entriesState = signal<LogEntry[]>([]);

  readonly entries = computed(() => this.entriesState());

  info(source: string, message: string, details?: unknown): void {
    this.push("info", source, message, details);
  }

  debug(source: string, message: string, details?: unknown): void {
    this.push("debug", source, message, details);
  }

  warn(source: string, message: string, details?: unknown): void {
    this.push("warn", source, message, details);
  }

  error(source: string, message: string, details?: unknown): void {
    this.push("error", source, message, details);
  }

  clear(): void {
    this.entriesState.set([]);
  }

  private push(level: LogLevel, source: string, message: string, details?: unknown): void {
    const entry: LogEntry = {
      id: this.nextId,
      timestamp: performance.now(),
      level,
      source,
      message,
      details,
    };

    this.nextId += 1;

    this.entriesState.update((entries) => {
      const next = [...entries, entry];
      if (next.length <= this.maxEntries) {
        return next;
      }
      return next.slice(next.length - this.maxEntries);
    });
  }
}
