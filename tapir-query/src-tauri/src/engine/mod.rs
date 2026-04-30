pub mod duckdb_engine;
pub mod sql_builder;

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredCsv {
    pub table_name: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryChunk {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub limit: usize,
    pub offset: usize,
    pub next_offset: Option<usize>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySession {
    pub session_id: String,
    pub columns: Vec<String>,
    pub total_rows: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output_path: String,
    pub rows_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ColumnProfileMetricKind {
    CardinalityTopValues,
    CompletenessAudit,
    StringLengthHistogram,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardinalityValueCount {
    pub value: String,
    pub frequency: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessAudit {
    pub populated: usize,
    pub empty_or_null: usize,
    pub completeness_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StringLengthBucket {
    pub label: String,
    pub min_inclusive: usize,
    pub max_inclusive: Option<usize>,
    pub frequency: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StringLengthHistogram {
    pub non_empty_rows: usize,
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    pub average_length: Option<f64>,
    pub buckets: Vec<StringLengthBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnProfileMetric {
    pub column_name: String,
    pub metric: ColumnProfileMetricKind,
    pub elapsed_ms: u64,
    pub total_rows: usize,
    pub cardinality_top_values: Option<Vec<CardinalityValueCount>>,
    pub unique_value_count: Option<usize>,
    pub completeness: Option<CompletenessAudit>,
    pub string_length_histogram: Option<StringLengthHistogram>,
}

pub type EngineResult<T> = Result<T, AppError>;

pub trait CsvQueryEngine: Send + Sync {
    fn register_csv(
        &self,
        existing: &HashMap<String, RegisteredCsv>,
        file_path: &str,
    ) -> EngineResult<RegisteredCsv>;

    fn describe_table(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        table_name: &str,
    ) -> EngineResult<Vec<ColumnSchema>>;

    fn execute_query_chunk(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        limit: usize,
        offset: usize,
    ) -> EngineResult<QueryChunk>;

    fn start_query_session(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
    ) -> EngineResult<QuerySession>;

    fn read_query_session_chunk(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        session_id: &str,
        limit: usize,
        offset: usize,
    ) -> EngineResult<QueryChunk>;

    fn close_query_session(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        session_id: &str,
    ) -> EngineResult<bool>;

    fn clear_query_sessions(&self, registered: &HashMap<String, RegisteredCsv>)
        -> EngineResult<()>;

    fn export_query_to_csv(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        output_path: &str,
    ) -> EngineResult<ExportResult>;

    fn run_column_profile_metric(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        column_name: &str,
        metric: ColumnProfileMetricKind,
        total_rows_hint: Option<usize>,
    ) -> EngineResult<ColumnProfileMetric>;
}
