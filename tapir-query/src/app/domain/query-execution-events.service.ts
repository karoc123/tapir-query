import { computed, Injectable, signal } from "@angular/core";

export interface SuccessfulQueryExecutionEvent {
  sql: string;
  executedAtUnixMs: number;
  sequence: number;
}

@Injectable({
  providedIn: "root",
})
export class QueryExecutionEventsService {
  private sequence = 0;
  private readonly maxEvents = 512;

  private readonly successfulExecutionsState = signal<SuccessfulQueryExecutionEvent[]>([]);

  readonly successfulExecutions = computed(() => this.successfulExecutionsState());

  emitSuccessfulExecution(sql: string, executedAtUnixMs: number = Date.now()): void {
    const normalizedSql = sql.trim();
    if (!normalizedSql) {
      return;
    }

    this.sequence += 1;
    const event: SuccessfulQueryExecutionEvent = {
      sql: normalizedSql,
      executedAtUnixMs: Math.max(0, Math.trunc(executedAtUnixMs)),
      sequence: this.sequence,
    };

    this.successfulExecutionsState.update((events) => {
      const next = [...events, event];
      if (next.length > this.maxEvents) {
        return next.slice(next.length - this.maxEvents);
      }

      return next;
    });
  }
}
