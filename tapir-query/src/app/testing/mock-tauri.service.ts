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
} from "../infrastructure/tauri-contracts";

export class MockTauriService {
  openFileCalls: string[] = [];
  executeQueryCalls: ExecuteQueryRequest[] = [];
  executeQueryResults: QueryChunk[] = [];
  startQuerySessionCalls: StartQuerySessionRequest[] = [];
  readQuerySessionChunkCalls: ReadQuerySessionChunkRequest[] = [];
  closeQuerySessionCalls: CloseQuerySessionRequest[] = [];
  exportCsvCalls: ExportCsvRequest[] = [];
  exportRowsCalls: ExportRowsRequest[] = [];
  saveQueryHistoryCalls: SaveQueryHistoryRequest[] = [];
  setRuntimeLoggingEnabledCalls: SetRuntimeLoggingRequest[] = [];
  runColumnProfileMetricCalls: RunColumnProfileMetricRequest[] = [];
  runColumnProfileMetricResults: ColumnProfileMetricResult[] = [];
  getRuntimeLoggingStatusCalls = 0;

  openFileResult: OpenFileResponse = {
    tableName: "transactions",
    filePath: "/tmp/transactions.csv",
    columns: [
      { name: "amount", dataType: "DOUBLE" },
      { name: "currency", dataType: "VARCHAR" },
    ],
    defaultQuery: "SELECT * FROM transactions",
    fileSizeBytes: 1_048_576,
  };

  queryResult: QueryChunk = {
    columns: ["amount", "currency"],
    rows: [{ amount: "1400", currency: "EUR" }],
    limit: 300,
    offset: 0,
    nextOffset: null,
    elapsedMs: 4,
  };

  sessionResult: QuerySessionResponse = {
    sessionId: "session-1",
    columns: ["amount", "currency"],
    totalRows: 1,
    elapsedMs: 4,
  };

  closeSessionResult: CloseQuerySessionResponse = {
    closed: true,
  };

  exportResult: ExportCsvResponse = {
    outputPath: "exports/query-results.csv",
    rowsWritten: 1,
  };

  queryHistoryResult: QueryHistoryResponse = {
    entries: [],
  };

  runtimeLoggingStatusResult: RuntimeLoggingStatusResponse = {
    enabled: false,
    logPath: "C:/Users/test/AppData/Local/com.zink.tapirquery/logs/tapir-query.log",
  };

  runColumnProfileMetricResult: ColumnProfileMetricResult = {
    columnName: "currency",
    metric: "completenessAudit",
    elapsedMs: 4,
    totalRows: 1,
    cardinalityTopValues: null,
    uniqueValueCount: null,
    completeness: {
      populated: 1,
      emptyOrNull: 0,
      completenessRatio: 1,
    },
    stringLengthHistogram: null,
  };

  executeQueryImpl: ((payload: ExecuteQueryRequest) => Promise<QueryChunk>) | null = null;
  runColumnProfileMetricImpl: ((payload: RunColumnProfileMetricRequest) => Promise<ColumnProfileMetricResult>) | null = null;

  async openFile(filePath: string): Promise<OpenFileResponse> {
    this.openFileCalls.push(filePath);
    return this.openFileResult;
  }

  async executeQuery(payload: ExecuteQueryRequest): Promise<QueryChunk> {
    this.executeQueryCalls.push(payload);

    if (this.executeQueryImpl !== null) {
      return await this.executeQueryImpl(payload);
    }

    const nextResult = this.executeQueryResults.shift();
    if (nextResult) {
      return nextResult;
    }

    return this.queryResult;
  }

  async startQuerySession(payload: StartQuerySessionRequest): Promise<QuerySessionResponse> {
    this.startQuerySessionCalls.push(payload);
    return this.sessionResult;
  }

  async readQuerySessionChunk(payload: ReadQuerySessionChunkRequest): Promise<QueryChunk> {
    this.readQuerySessionChunkCalls.push(payload);
    return this.queryResult;
  }

  async closeQuerySession(payload: CloseQuerySessionRequest): Promise<CloseQuerySessionResponse> {
    this.closeQuerySessionCalls.push(payload);
    return this.closeSessionResult;
  }

  async exportCsv(payload: ExportCsvRequest): Promise<ExportCsvResponse> {
    this.exportCsvCalls.push(payload);
    return this.exportResult;
  }

  async exportRows(payload: ExportRowsRequest): Promise<ExportCsvResponse> {
    this.exportRowsCalls.push(payload);
    return this.exportResult;
  }

  async loadQueryHistory(): Promise<QueryHistoryResponse> {
    return this.queryHistoryResult;
  }

  async saveQueryHistory(payload: SaveQueryHistoryRequest): Promise<QueryHistoryResponse> {
    this.saveQueryHistoryCalls.push(payload);
    this.queryHistoryResult = {
      entries: payload.entries,
    };
    return this.queryHistoryResult;
  }

  async getRuntimeLoggingStatus(): Promise<RuntimeLoggingStatusResponse> {
    this.getRuntimeLoggingStatusCalls += 1;
    return this.runtimeLoggingStatusResult;
  }

  async setRuntimeLoggingEnabled(payload: SetRuntimeLoggingRequest): Promise<RuntimeLoggingStatusResponse> {
    this.setRuntimeLoggingEnabledCalls.push(payload);
    this.runtimeLoggingStatusResult = {
      ...this.runtimeLoggingStatusResult,
      enabled: payload.enabled,
    };
    return this.runtimeLoggingStatusResult;
  }

  async runColumnProfileMetric(payload: RunColumnProfileMetricRequest): Promise<ColumnProfileMetricResult> {
    this.runColumnProfileMetricCalls.push(payload);

    if (this.runColumnProfileMetricImpl !== null) {
      return await this.runColumnProfileMetricImpl(payload);
    }

    const nextResult = this.runColumnProfileMetricResults.shift();
    if (nextResult) {
      return nextResult;
    }

    return this.runColumnProfileMetricResult;
  }

  reset(): void {
    this.openFileCalls = [];
    this.executeQueryCalls = [];
    this.executeQueryResults = [];
    this.startQuerySessionCalls = [];
    this.readQuerySessionChunkCalls = [];
    this.closeQuerySessionCalls = [];
    this.exportCsvCalls = [];
    this.exportRowsCalls = [];
    this.saveQueryHistoryCalls = [];
    this.setRuntimeLoggingEnabledCalls = [];
    this.runColumnProfileMetricCalls = [];
    this.runColumnProfileMetricResults = [];
    this.getRuntimeLoggingStatusCalls = 0;
    this.executeQueryImpl = null;
    this.runColumnProfileMetricImpl = null;
    this.queryHistoryResult = {
      entries: [],
    };
    this.runtimeLoggingStatusResult = {
      enabled: false,
      logPath: "C:/Users/test/AppData/Local/com.zink.tapirquery/logs/tapir-query.log",
    };
  }
}
