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

export type ColumnProfileMetricKind = "cardinalityTopValues" | "completenessAudit" | "stringLengthHistogram";

export interface RunColumnProfileMetricRequest {
  sql: string;
  columnName: string;
  metric: ColumnProfileMetricKind;
  totalRowsHint?: number | null;
}

export interface CardinalityTopValue {
  value: string;
  frequency: number;
}

export interface CompletenessAudit {
  populated: number;
  emptyOrNull: number;
  completenessRatio: number;
}

export interface StringLengthBucket {
  label: string;
  minInclusive: number;
  maxInclusive: number | null;
  frequency: number;
}

export interface StringLengthHistogram {
  nonEmptyRows: number;
  minLength: number | null;
  maxLength: number | null;
  averageLength: number | null;
  buckets: StringLengthBucket[];
}

export interface ColumnProfileMetricResult {
  columnName: string;
  metric: ColumnProfileMetricKind;
  elapsedMs: number;
  totalRows: number;
  cardinalityTopValues: CardinalityTopValue[] | null;
  uniqueValueCount: number | null;
  completeness: CompletenessAudit | null;
  stringLengthHistogram: StringLengthHistogram | null;
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

export interface QueryHistoryEntry {
  sql: string;
  executedAtUnixMs: number;
}

export interface QueryHistoryResponse {
  entries: QueryHistoryEntry[];
}

export interface SaveQueryHistoryRequest {
  entries: QueryHistoryEntry[];
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
