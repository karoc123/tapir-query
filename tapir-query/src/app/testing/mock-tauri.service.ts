import {
  ExecuteQueryRequest,
  ExportCsvRequest,
  ExportCsvResponse,
  ExportRowsRequest,
  OpenFileResponse,
  QueryChunk,
} from "../infrastructure/tauri-contracts";

export class MockTauriService {
  openFileCalls: string[] = [];
  executeQueryCalls: ExecuteQueryRequest[] = [];
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
    return this.queryResult;
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
    this.exportCsvCalls = [];
    this.exportRowsCalls = [];
  }
}
