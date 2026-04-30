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

  async openFile(filePath: string): Promise<OpenFileResponse> {
    this.openFileCalls.push(filePath);
    return this.openFileResult;
  }

  async executeQuery(payload: ExecuteQueryRequest): Promise<QueryChunk> {
    this.executeQueryCalls.push(payload);
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

  reset(): void {
    this.openFileCalls = [];
    this.executeQueryCalls = [];
    this.executeQueryResults = [];
    this.startQuerySessionCalls = [];
    this.readQuerySessionChunkCalls = [];
    this.closeQuerySessionCalls = [];
    this.exportCsvCalls = [];
    this.exportRowsCalls = [];
  }
}
