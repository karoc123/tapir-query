use crate::engine::ColumnSchema;
use crate::error::AppError;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;
use tracing::{error, info, warn};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileRequest {
    pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileResponse {
    pub table_name: String,
    pub file_path: String,
    pub columns: Vec<ColumnSchema>,
    pub default_query: String,
    pub file_size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub sql: String,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQuerySessionRequest {
    pub sql: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartQuerySessionResponse {
    pub session_id: String,
    pub columns: Vec<String>,
    pub total_rows: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadQuerySessionChunkRequest {
    pub session_id: String,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseQuerySessionRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseQuerySessionResponse {
    pub closed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCsvRequest {
    pub sql: String,
    pub output_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRowsRequest {
    pub output_path: String,
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, Option<String>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCsvResponse {
    pub output_path: String,
    pub rows_written: u64,
}

fn map_error(error: AppError) -> String {
    error!("command failed: {error}");
    error.to_string()
}

#[tauri::command]
pub fn open_file(
    request: OpenFileRequest,
    state: State<'_, AppState>,
) -> Result<OpenFileResponse, String> {
    info!("open_file request received for {}", request.file_path);

    let opened = state
        .csv_service
        .open_file(&request.file_path)
        .map_err(map_error)?;

    info!(
        "open_file success table={} columns={}",
        opened.table_name,
        opened.columns.len()
    );

    Ok(OpenFileResponse {
        table_name: opened.table_name,
        file_path: opened.file_path,
        columns: opened.columns,
        default_query: opened.default_query,
        file_size_bytes: opened.file_size_bytes,
    })
}

#[tauri::command]
pub fn execute_query(
    request: ExecuteQueryRequest,
    state: State<'_, AppState>,
) -> Result<crate::engine::QueryChunk, String> {
    info!(
        "execute_query request received limit={:?} offset={:?}",
        request.limit, request.offset
    );

    state
        .csv_service
        .execute_query(
            &request.sql,
            request.limit.unwrap_or(200),
            request.offset.unwrap_or(0),
        )
        .map_err(map_error)
}

#[tauri::command]
pub fn start_query_session(
    request: StartQuerySessionRequest,
    state: State<'_, AppState>,
) -> Result<StartQuerySessionResponse, String> {
    info!("start_query_session request received");

    state
        .csv_service
        .start_query_session(&request.sql)
        .map(|session| StartQuerySessionResponse {
            session_id: session.session_id,
            columns: session.columns,
            total_rows: session.total_rows,
            elapsed_ms: session.elapsed_ms,
        })
        .map_err(map_error)
}

#[tauri::command]
pub fn read_query_session_chunk(
    request: ReadQuerySessionChunkRequest,
    state: State<'_, AppState>,
) -> Result<crate::engine::QueryChunk, String> {
    info!(
        "read_query_session_chunk request received session={} limit={:?} offset={:?}",
        request.session_id, request.limit, request.offset
    );

    state
        .csv_service
        .read_query_session_chunk(
            &request.session_id,
            request.limit.unwrap_or(200),
            request.offset.unwrap_or(0),
        )
        .map_err(map_error)
}

#[tauri::command]
pub fn close_query_session(
    request: CloseQuerySessionRequest,
    state: State<'_, AppState>,
) -> Result<CloseQuerySessionResponse, String> {
    info!(
        "close_query_session request received session={}",
        request.session_id
    );

    state
        .csv_service
        .close_query_session(&request.session_id)
        .map(|closed| CloseQuerySessionResponse { closed })
        .map_err(map_error)
}

#[tauri::command]
pub fn export_csv(
    request: ExportCsvRequest,
    state: State<'_, AppState>,
) -> Result<ExportCsvResponse, String> {
    info!("export_csv request received output={}", request.output_path);

    state
        .csv_service
        .export_query_to_csv(&request.sql, &request.output_path)
        .map(|result| ExportCsvResponse {
            output_path: result.output_path,
            rows_written: result.rows_written,
        })
        .map_err(map_error)
}

#[tauri::command]
pub fn export_rows(
    request: ExportRowsRequest,
    _state: State<'_, AppState>,
) -> Result<ExportCsvResponse, String> {
    info!(
        "export_rows request received output={} rows={} columns={}",
        request.output_path,
        request.rows.len(),
        request.columns.len()
    );

    if request.columns.is_empty() {
        warn!("export_rows rejected because no columns were provided");
        return Err(String::from(
            "validation error: no columns available to export",
        ));
    }

    let target_path = PathBuf::from(&request.output_path);
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            AppError::Io(format!(
                "failed to create export directory {}: {error}",
                parent.display()
            ))
            .to_string()
        })?;
    }

    let mut writer = csv::Writer::from_path(&target_path)
        .map_err(|error| AppError::Io(format!("failed to open export file: {error}")))
        .map_err(map_error)?;

    writer
        .write_record(&request.columns)
        .map_err(|error| AppError::Io(format!("failed to write CSV header: {error}")))
        .map_err(map_error)?;

    for row in &request.rows {
        let record = request
            .columns
            .iter()
            .map(|column| row.get(column).cloned().flatten().unwrap_or_default())
            .collect::<Vec<_>>();

        writer
            .write_record(record)
            .map_err(|error| AppError::Io(format!("failed to write CSV row: {error}")))
            .map_err(map_error)?;
    }

    writer
        .flush()
        .map_err(|error| AppError::Io(format!("failed to flush CSV writer: {error}")))
        .map_err(map_error)?;

    info!(
        "export_rows success output={} rows_written={}",
        target_path.to_string_lossy(),
        request.rows.len()
    );

    Ok(ExportCsvResponse {
        output_path: target_path.to_string_lossy().to_string(),
        rows_written: request.rows.len() as u64,
    })
}
