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
pub struct ExportResult {
    pub output_path: String,
    pub rows_written: u64,
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

    fn export_query_to_csv(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        output_path: &str,
    ) -> EngineResult<ExportResult>;
}