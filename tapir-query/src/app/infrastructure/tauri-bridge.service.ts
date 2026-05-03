import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import {
  ColumnProfileMetricResult,
  CloseQuerySessionRequest,
  CloseQuerySessionResponse,
  ExecuteQueryRequest,
  ExportCsvRequest,
  ExportCsvResponse,
  ExportRowsRequest,
  OpenFileResponse,
  QueryHistoryResponse,
  QuerySessionResponse,
  QueryChunk,
  ReadQuerySessionChunkRequest,
  RuntimeLoggingStatusResponse,
  RunColumnProfileMetricRequest,
  SaveQueryHistoryRequest,
  SetRuntimeLoggingRequest,
  StartQuerySessionRequest,
} from "./tauri-contracts";
import { LogService } from "./log.service";
import { PerfService } from "./perf.service";

@Injectable({
  providedIn: "root",
})
export class TauriBridgeService {
  constructor(
    private readonly logs: LogService,
    private readonly perf: PerfService,
  ) {}

  openFile(filePath: string): Promise<OpenFileResponse> {
    return this.invokeWithLogging<OpenFileResponse>("open_file", {
      request: { filePath },
    });
  }

  executeQuery(payload: ExecuteQueryRequest): Promise<QueryChunk> {
    return this.invokeWithLogging<QueryChunk>("execute_query", {
      request: payload,
    });
  }

  runColumnProfileMetric(payload: RunColumnProfileMetricRequest): Promise<ColumnProfileMetricResult> {
    return this.invokeWithLogging<ColumnProfileMetricResult>("run_column_profile_metric", {
      request: payload,
    });
  }

  startQuerySession(payload: StartQuerySessionRequest): Promise<QuerySessionResponse> {
    return this.invokeWithLogging<QuerySessionResponse>("start_query_session", {
      request: payload,
    });
  }

  readQuerySessionChunk(payload: ReadQuerySessionChunkRequest): Promise<QueryChunk> {
    return this.invokeWithLogging<QueryChunk>("read_query_session_chunk", {
      request: payload,
    });
  }

  closeQuerySession(payload: CloseQuerySessionRequest): Promise<CloseQuerySessionResponse> {
    return this.invokeWithLogging<CloseQuerySessionResponse>("close_query_session", {
      request: payload,
    });
  }

  exportCsv(payload: ExportCsvRequest): Promise<ExportCsvResponse> {
    return this.invokeWithLogging<ExportCsvResponse>("export_csv", {
      request: payload,
    });
  }

  exportRows(payload: ExportRowsRequest): Promise<ExportCsvResponse> {
    return this.invokeWithLogging<ExportCsvResponse>("export_rows", {
      request: payload,
    });
  }

  loadQueryHistory(): Promise<QueryHistoryResponse> {
    return this.invokeWithLogging<QueryHistoryResponse>("load_query_history");
  }

  saveQueryHistory(payload: SaveQueryHistoryRequest): Promise<QueryHistoryResponse> {
    return this.invokeWithLogging<QueryHistoryResponse>("save_query_history", {
      request: payload,
    });
  }

  getRuntimeLoggingStatus(): Promise<RuntimeLoggingStatusResponse> {
    return this.invokeWithLogging<RuntimeLoggingStatusResponse>("get_runtime_logging_status");
  }

  setRuntimeLoggingEnabled(payload: SetRuntimeLoggingRequest): Promise<RuntimeLoggingStatusResponse> {
    return this.invokeWithLogging<RuntimeLoggingStatusResponse>("set_runtime_logging_enabled", {
      request: payload,
    });
  }

  private async invokeWithLogging<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
    const timerKey = `ipc:${command}`;
    this.perf.start(timerKey);
    this.logs.info("ipc", `Invoking ${command}`, payload);

    try {
      const result = await invoke<T>(command, payload);
      this.perf.end(timerKey);
      this.logs.info("ipc", `Success ${command}`);
      return result;
    } catch (error) {
      this.perf.end(timerKey);
      this.logs.error("ipc", `Failure ${command}`, {
        payload,
        error: this.extractError(error),
      });
      throw error;
    }
  }

  private extractError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Unknown IPC error";
  }
}
