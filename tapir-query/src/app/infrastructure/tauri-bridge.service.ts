import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import {
  CloseQuerySessionRequest,
  CloseQuerySessionResponse,
  ExecuteQueryRequest,
  ExportCsvRequest,
  ExportCsvResponse,
  ExportRowsRequest,
  OpenFileResponse,
  QuerySessionResponse,
  QueryChunk,
  ReadQuerySessionChunkRequest,
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

  private async invokeWithLogging<T>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
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