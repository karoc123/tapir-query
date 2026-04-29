export interface ColumnSchema {
  name: string;
  dataType: string;
}

export type QueryRow = Record<string, string | null>;

export interface OpenFileResponse {
  tableName: string;
  filePath: string;
  columns: ColumnSchema[];
  defaultQuery: string;
  fileSizeBytes: number | null;
}

export interface ExecuteQueryRequest {
  sql: string;
  limit?: number;
  offset?: number;
}

export interface StartQuerySessionRequest {
  sql: string;
}

export interface QuerySessionResponse {
  sessionId: string;
  columns: string[];
  totalRows: number;
  elapsedMs: number;
}

export interface ReadQuerySessionChunkRequest {
  sessionId: string;
  limit?: number;
  offset?: number;
}

export interface CloseQuerySessionRequest {
  sessionId: string;
}

export interface CloseQuerySessionResponse {
  closed: boolean;
}

export interface QueryChunk {
  columns: string[];
  rows: QueryRow[];
  limit: number;
  offset: number;
  nextOffset: number | null;
  elapsedMs: number;
}

export interface ExportCsvRequest {
  sql: string;
  outputPath: string;
}

export interface ExportRowsRequest {
  outputPath: string;
  columns: string[];
  rows: QueryRow[];
}

export interface ExportCsvResponse {
  outputPath: string;
  rowsWritten: number;
}