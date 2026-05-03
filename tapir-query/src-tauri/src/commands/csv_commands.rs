use crate::engine::ColumnSchema;
use crate::error::AppError;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::{async_runtime, Manager, State};
use tokio::fs;
use tracing::{error, info, warn};

const SQL_PREVIEW_LIMIT: usize = 240;

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
pub struct RunColumnProfileMetricRequest {
    pub sql: String,
    pub column_name: String,
    pub metric: crate::engine::ColumnProfileMetricKind,
    pub total_rows_hint: Option<usize>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub sql: String,
    pub executed_at_unix_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryResponse {
    pub entries: Vec<QueryHistoryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryHistoryRequest {
    pub entries: Vec<QueryHistoryEntry>,
}

fn map_error(error: AppError) -> String {
    error!("command failed: {error}");
    error.to_string()
}

fn map_join_error(context: &str, error: impl std::fmt::Display) -> String {
    map_error(AppError::State(format!(
        "{context} task join failed: {error}"
    )))
}

fn resolve_query_history_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join("query-history.json"))
        .map_err(|error| {
            map_error(AppError::State(format!(
                "failed to resolve app data directory: {error}"
            )))
        })
}

fn sanitize_query_history(entries: Vec<QueryHistoryEntry>) -> Vec<QueryHistoryEntry> {
    entries
        .into_iter()
        .filter_map(|entry| {
            let normalized_sql = entry.sql.trim();
            if normalized_sql.is_empty() {
                return None;
            }

            Some(QueryHistoryEntry {
                sql: normalized_sql.to_string(),
                executed_at_unix_ms: entry.executed_at_unix_ms.max(0),
            })
        })
        .take(50)
        .collect()
}

fn summarize_sql(sql: &str) -> String {
    let compact = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview = compact.chars().take(SQL_PREVIEW_LIMIT).collect::<String>();

    if compact.chars().count() > SQL_PREVIEW_LIMIT {
        preview.push_str("...");
    }

    preview
}

#[tauri::command]
pub async fn open_file(
    request: OpenFileRequest,
    state: State<'_, AppState>,
) -> Result<OpenFileResponse, String> {
    info!("open_file request received for {}", request.file_path);

    let csv_service = state.csv_service.clone();
    let file_path = request.file_path;

    let opened = async_runtime::spawn_blocking(move || csv_service.open_file(&file_path))
        .await
        .map_err(|error| map_join_error("open_file", error))?
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
pub async fn load_query_history(
    app_handle: tauri::AppHandle,
) -> Result<QueryHistoryResponse, String> {
    let history_path = resolve_query_history_path(&app_handle)?;
    info!(
        "load_query_history request received path={}",
        history_path.display()
    );

    let content = match fs::read_to_string(&history_path).await {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            info!("load_query_history file not found, returning empty history");
            return Ok(QueryHistoryResponse {
                entries: Vec::new(),
            });
        }
        Err(error) => {
            return Err(map_error(AppError::Io(format!(
                "failed to read query history file {}: {error}",
                history_path.display()
            ))));
        }
    };

    if content.trim().is_empty() {
        return Ok(QueryHistoryResponse {
            entries: Vec::new(),
        });
    }

    let parsed: Vec<QueryHistoryEntry> = serde_json::from_str(&content).map_err(|error| {
        map_error(AppError::State(format!(
            "failed to parse query history JSON: {error}"
        )))
    })?;

    let entries = sanitize_query_history(parsed);

    info!("load_query_history success entries={}", entries.len());

    Ok(QueryHistoryResponse { entries })
}

#[tauri::command]
pub async fn save_query_history(
    request: SaveQueryHistoryRequest,
    app_handle: tauri::AppHandle,
) -> Result<QueryHistoryResponse, String> {
    let history_path = resolve_query_history_path(&app_handle)?;
    let entries = sanitize_query_history(request.entries);

    if let Some(parent) = history_path.parent() {
        fs::create_dir_all(parent).await.map_err(|error| {
            map_error(AppError::Io(format!(
                "failed to create query history directory {}: {error}",
                parent.display()
            )))
        })?;
    }

    let serialized = serde_json::to_string_pretty(&entries).map_err(|error| {
        map_error(AppError::State(format!(
            "failed to serialize query history: {error}"
        )))
    })?;

    fs::write(&history_path, serialized)
        .await
        .map_err(|error| {
            map_error(AppError::Io(format!(
                "failed to write query history file {}: {error}",
                history_path.display()
            )))
        })?;

    info!(
        "save_query_history success path={} entries={}",
        history_path.display(),
        entries.len()
    );

    Ok(QueryHistoryResponse { entries })
}

#[tauri::command]
pub async fn execute_query(
    request: ExecuteQueryRequest,
    state: State<'_, AppState>,
) -> Result<crate::engine::QueryChunk, String> {
    info!(
        "execute_query request received sql_len={} sql_preview={} limit={:?} offset={:?}",
        request.sql.len(),
        summarize_sql(&request.sql),
        request.limit,
        request.offset
    );

    let csv_service = state.csv_service.clone();
    let sql = request.sql;
    let limit = request.limit.unwrap_or(200);
    let offset = request.offset.unwrap_or(0);

    let chunk =
        async_runtime::spawn_blocking(move || csv_service.execute_query(&sql, limit, offset))
            .await
            .map_err(|error| map_join_error("execute_query", error))?
            .map_err(map_error)?;

    info!(
        "execute_query success rows={} columns={} next_offset={:?} elapsed_ms={}",
        chunk.rows.len(),
        chunk.columns.len(),
        chunk.next_offset,
        chunk.elapsed_ms
    );

    Ok(chunk)
}

#[tauri::command]
pub async fn run_column_profile_metric(
    request: RunColumnProfileMetricRequest,
    state: State<'_, AppState>,
) -> Result<crate::engine::ColumnProfileMetric, String> {
    info!(
        "run_column_profile_metric request received column={} metric={:?} sql_len={} sql_preview={} total_rows_hint={:?}",
        request.column_name,
        request.metric,
        request.sql.len(),
        summarize_sql(&request.sql),
        request.total_rows_hint
    );

    let csv_service = state.csv_service.clone();
    let sql = request.sql;
    let column_name = request.column_name;
    let metric = request.metric;
    let total_rows_hint = request.total_rows_hint;

    info!(
        "run_column_profile_metric task dispatched column={} metric={:?}",
        column_name, metric
    );

    let profile = async_runtime::spawn_blocking(move || {
        csv_service.run_column_profile_metric(&sql, &column_name, metric, total_rows_hint)
    })
    .await
    .map_err(|error| map_join_error("run_column_profile_metric", error))?
    .map_err(map_error)?;

    info!(
        "run_column_profile_metric success column={} metric={:?} elapsed_ms={}",
        profile.column_name, profile.metric, profile.elapsed_ms
    );

    Ok(profile)
}

#[tauri::command]
pub async fn start_query_session(
    request: StartQuerySessionRequest,
    state: State<'_, AppState>,
) -> Result<StartQuerySessionResponse, String> {
    info!(
        "start_query_session request received sql_len={} sql_preview={}",
        request.sql.len(),
        summarize_sql(&request.sql)
    );

    let csv_service = state.csv_service.clone();
    let sql = request.sql;

    let session = async_runtime::spawn_blocking(move || csv_service.start_query_session(&sql))
        .await
        .map_err(|error| map_join_error("start_query_session", error))?
        .map_err(map_error)?;

    Ok(StartQuerySessionResponse {
        session_id: session.session_id,
        columns: session.columns,
        total_rows: session.total_rows,
        elapsed_ms: session.elapsed_ms,
    })
}

#[tauri::command]
pub async fn read_query_session_chunk(
    request: ReadQuerySessionChunkRequest,
    state: State<'_, AppState>,
) -> Result<crate::engine::QueryChunk, String> {
    info!(
        "read_query_session_chunk request received session={} limit={:?} offset={:?}",
        request.session_id, request.limit, request.offset
    );

    let csv_service = state.csv_service.clone();
    let session_id = request.session_id;
    let limit = request.limit.unwrap_or(200);
    let offset = request.offset.unwrap_or(0);

    async_runtime::spawn_blocking(move || {
        csv_service.read_query_session_chunk(&session_id, limit, offset)
    })
    .await
    .map_err(|error| map_join_error("read_query_session_chunk", error))?
    .map_err(map_error)
}

#[tauri::command]
pub async fn close_query_session(
    request: CloseQuerySessionRequest,
    state: State<'_, AppState>,
) -> Result<CloseQuerySessionResponse, String> {
    info!(
        "close_query_session request received session={}",
        request.session_id
    );

    let csv_service = state.csv_service.clone();
    let session_id = request.session_id;

    async_runtime::spawn_blocking(move || csv_service.close_query_session(&session_id))
        .await
        .map_err(|error| map_join_error("close_query_session", error))?
        .map(|closed| CloseQuerySessionResponse { closed })
        .map_err(map_error)
}

#[tauri::command]
pub async fn export_csv(
    request: ExportCsvRequest,
    state: State<'_, AppState>,
) -> Result<ExportCsvResponse, String> {
    info!(
        "export_csv request received sql_len={} sql_preview={} output={}",
        request.sql.len(),
        summarize_sql(&request.sql),
        request.output_path
    );

    let csv_service = state.csv_service.clone();
    let sql = request.sql;
    let output_path = request.output_path;

    async_runtime::spawn_blocking(move || csv_service.export_query_to_csv(&sql, &output_path))
        .await
        .map_err(|error| map_join_error("export_csv", error))?
        .map(|result| ExportCsvResponse {
            output_path: result.output_path,
            rows_written: result.rows_written,
        })
        .map_err(map_error)
}

#[tauri::command]
pub async fn export_rows(request: ExportRowsRequest) -> Result<ExportCsvResponse, String> {
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

    async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| map_join_error("export_rows", error))?
}
