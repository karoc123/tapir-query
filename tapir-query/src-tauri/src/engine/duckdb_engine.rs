use crate::engine::sql_builder;
use crate::engine::{
    CardinalityValueCount, ColumnProfileMetric, ColumnProfileMetricKind, ColumnSchema,
    CompletenessAudit, CsvQueryEngine, EngineResult, ExportResult, QueryChunk, QuerySession,
    RegisteredCsv, StringLengthBucket, StringLengthHistogram,
};
use crate::error::AppError;
use duckdb::Connection;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tracing::{debug, error, info};

#[derive(Debug, Clone)]
struct QuerySessionState {
    sql: String,
    columns: Vec<String>,
    total_rows: usize,
}

const NULL_SENTINEL: &str = "__tapir_null__";
const EMPTY_SENTINEL: &str = "__tapir_empty__";
const NULL_LABEL: &str = "<NULL>";
const EMPTY_LABEL: &str = "<EMPTY>";

const LENGTH_BUCKETS: [(&str, usize, Option<usize>); 7] = [
    ("1-4", 1, Some(4)),
    ("5-8", 5, Some(8)),
    ("9-16", 9, Some(16)),
    ("17-32", 17, Some(32)),
    ("33-64", 33, Some(64)),
    ("65-128", 65, Some(128)),
    ("129+", 129, None),
];

pub struct DuckDbEngine {
    session_counter: AtomicU64,
    sessions: Mutex<HashMap<String, QuerySessionState>>,
}

impl Default for DuckDbEngine {
    fn default() -> Self {
        // Keep the constructor contract stable for callers while avoiding cross-request
        // connection reuse.
        Self::new(1)
    }
}

impl DuckDbEngine {
    pub fn new(_pool_size: usize) -> Self {
        Self {
            session_counter: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn next_session_id(&self) -> String {
        let next = self.session_counter.fetch_add(1, Ordering::Relaxed);
        format!("session-{next}")
    }

    fn lookup_session(&self, session_id: &str) -> EngineResult<QuerySessionState> {
        self.sessions
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock query sessions")))
            .and_then(|sessions| {
                sessions.get(session_id).cloned().ok_or_else(|| {
                    AppError::Validation(format!("query session not found: {session_id}"))
                })
            })
    }

    fn remove_session(&self, session_id: &str) -> EngineResult<Option<QuerySessionState>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock query sessions")))
            .map(|mut sessions| sessions.remove(session_id))
    }

    fn validate_registered_files(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
    ) -> EngineResult<()> {
        if registered.is_empty() {
            return Err(AppError::Validation(String::from(
                "no CSV files loaded; open a file first",
            )));
        }

        Ok(())
    }

    fn with_connection<T, F>(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        operation: F,
    ) -> EngineResult<T>
    where
        F: FnOnce(&Connection) -> EngineResult<T>,
    {
        let connection = Connection::open_in_memory()
            .map_err(|error| AppError::Sql(format!("failed to open DuckDB: {error}")))?;

        debug!("opened DuckDB connection for operation");

        for table in registered.values() {
            let register_sql =
                sql_builder::build_register_view_sql(&table.table_name, &table.file_path);
            connection.execute_batch(&register_sql).map_err(|error| {
                error!(
                    "failed to register CSV view table={} error={}",
                    table.table_name, error
                );
                AppError::Sql(format!(
                    "failed to register CSV view {}: {error}",
                    table.table_name
                ))
            })?;
        }

        operation(&connection)
    }

    fn derive_table_name(
        &self,
        existing: &HashMap<String, RegisteredCsv>,
        file_path: &Path,
    ) -> EngineResult<String> {
        let file_stem = file_path
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                AppError::Validation(String::from("unable to derive a table name from file path"))
            })?;

        let base = sql_builder::sanitize_identifier(file_stem);
        let mut candidate = base.clone();
        let mut index = 1;

        while existing.contains_key(&candidate) {
            candidate = format!("{base}_{index}");
            index += 1;
        }

        Ok(candidate)
    }

    fn describe_query_schema(
        &self,
        connection: &Connection,
        sql: &str,
    ) -> EngineResult<Vec<ColumnSchema>> {
        let describe_sql = sql_builder::build_describe_query_sql(sql);
        let mut statement = connection
            .prepare(&describe_sql)
            .map_err(|error| AppError::Sql(format!("failed to describe query: {error}")))?;
        let mut rows = statement
            .query([])
            .map_err(|error| AppError::Sql(format!("failed to read query schema: {error}")))?;

        let mut columns = Vec::new();
        while let Some(row) = rows
            .next()
            .map_err(|error| AppError::Sql(format!("failed to iterate schema rows: {error}")))?
        {
            let column_name: String = row
                .get(0)
                .map_err(|error| AppError::Sql(format!("failed to read column name: {error}")))?;
            let column_type: String = row
                .get(1)
                .map_err(|error| AppError::Sql(format!("failed to read column type: {error}")))?;

            columns.push(ColumnSchema {
                name: column_name,
                data_type: column_type,
            });
        }

        if columns.is_empty() {
            return Err(AppError::Validation(String::from(
                "query returned no columns",
            )));
        }

        Ok(columns)
    }

    fn validate_query_sql(&self, connection: &Connection, sql: &str) -> EngineResult<()> {
        connection
            .prepare(sql)
            .map(|_| ())
            .map_err(|error| AppError::Sql(format!("failed to validate query: {error}")))
    }

    /// Pure-Rust SQL syntax check using sqlparser — runs before any DuckDB FFI call.
    /// Catches obviously malformed SQL without touching the DuckDB C library,
    /// preventing crashes in the bundled DuckDB on Windows.
    fn pre_validate_user_sql(sql: &str) -> EngineResult<()> {
        use sqlparser::dialect::DuckDbDialect;
        use sqlparser::parser::Parser;
        Parser::parse_sql(&DuckDbDialect {}, sql)
            .map(|_| ())
            .map_err(|error| AppError::Sql(format!("SQL syntax error: {error}")))
    }

    fn normalize_sql(&self, sql: &str) -> String {
        sql.trim().trim_end_matches(';').trim().to_string()
    }

    fn count_total_rows(&self, connection: &Connection, sql: &str) -> EngineResult<usize> {
        let count_sql = sql_builder::build_count_sql(sql);
        let total_rows: i64 = connection
            .query_row(&count_sql, [], |row| row.get(0))
            .map_err(|error| AppError::Sql(format!("failed to count profile rows: {error}")))?;

        Ok(total_rows.max(0) as usize)
    }

    fn query_cardinality_metric(
        &self,
        connection: &Connection,
        sql: &str,
        column_name: &str,
    ) -> EngineResult<(usize, Vec<CardinalityValueCount>)> {
        let value_scope_sql = sql_builder::build_column_value_scope_sql(sql, column_name);
        let normalized_expression = format!(
            "CASE WHEN tapir_value IS NULL THEN '{}' WHEN LENGTH(TRIM(tapir_value)) = 0 THEN '{}' ELSE tapir_value END",
            NULL_SENTINEL, EMPTY_SENTINEL
        );

        let top_values_sql = format!(
            "WITH normalized AS (SELECT {normalized_expression} AS normalized_value FROM ({value_scope_sql}) AS tapir_values), \
                  grouped AS (\
                      SELECT normalized_value, COUNT(*) AS frequency \
                      FROM normalized \
                      GROUP BY normalized_value\
                  ), \
                  ranked AS (\
                      SELECT normalized_value, frequency, COUNT(*) OVER() AS unique_count \
                      FROM grouped \
                      ORDER BY frequency DESC, normalized_value ASC \
                      LIMIT 10\
                  ) \
             SELECT normalized_value, frequency, unique_count FROM ranked"
        );

        let mut statement = connection.prepare(&top_values_sql).map_err(|error| {
            AppError::Sql(format!("failed to prepare top-value query: {error}"))
        })?;
        let mut cursor = statement.query([]).map_err(|error| {
            AppError::Sql(format!("failed to execute top-value query: {error}"))
        })?;

        let mut top_values = Vec::new();
        let mut unique_value_count: Option<usize> = None;
        while let Some(row) = cursor
            .next()
            .map_err(|error| AppError::Sql(format!("failed to iterate top-value rows: {error}")))?
        {
            let raw_value: String = row.get(0).map_err(|error| {
                AppError::Sql(format!("failed to read top-value label: {error}"))
            })?;
            let frequency: i64 = row.get(1).map_err(|error| {
                AppError::Sql(format!("failed to read top-value frequency: {error}"))
            })?;
            let unique_count: i64 = row.get(2).map_err(|error| {
                AppError::Sql(format!("failed to read unique value count: {error}"))
            })?;

            if unique_value_count.is_none() {
                unique_value_count = Some(unique_count.max(0) as usize);
            }

            let value = match raw_value.as_str() {
                NULL_SENTINEL => String::from(NULL_LABEL),
                EMPTY_SENTINEL => String::from(EMPTY_LABEL),
                _ => raw_value,
            };

            top_values.push(CardinalityValueCount {
                value,
                frequency: frequency.max(0) as usize,
            });
        }

        Ok((unique_value_count.unwrap_or(0), top_values))
    }

    fn query_completeness_metric(
        &self,
        connection: &Connection,
        sql: &str,
        column_name: &str,
    ) -> EngineResult<(CompletenessAudit, usize)> {
        let value_scope_sql = sql_builder::build_column_value_scope_sql(sql, column_name);
        let completeness_sql = format!(
            "SELECT \
                SUM(CASE WHEN tapir_value IS NULL OR LENGTH(TRIM(tapir_value)) = 0 THEN 0 ELSE 1 END) AS populated, \
                SUM(CASE WHEN tapir_value IS NULL OR LENGTH(TRIM(tapir_value)) = 0 THEN 1 ELSE 0 END) AS empty_or_null, \
                COUNT(*) AS total_rows \
             FROM ({value_scope_sql}) AS tapir_values"
        );

        let (populated, empty_or_null, total_rows): (i64, i64, i64) = connection
            .query_row(&completeness_sql, [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|error| {
                AppError::Sql(format!("failed to compute completeness audit: {error}"))
            })?;

        let total_rows = total_rows.max(0) as usize;
        let populated = populated.max(0) as usize;
        let empty_or_null = empty_or_null.max(0) as usize;
        let completeness_ratio = if total_rows == 0 {
            0.0
        } else {
            ((populated as f64 / total_rows as f64) * 1_000_000.0).round() / 1_000_000.0
        };

        Ok((
            CompletenessAudit {
                populated,
                empty_or_null,
                completeness_ratio,
            },
            total_rows,
        ))
    }

    fn query_string_length_histogram(
        &self,
        connection: &Connection,
        sql: &str,
        column_name: &str,
    ) -> EngineResult<StringLengthHistogram> {
        let value_scope_sql = sql_builder::build_column_value_scope_sql(sql, column_name);
        let lengths_cte = format!(
            "WITH lengths AS (\
                SELECT LENGTH(TRIM(tapir_value)) AS tapir_length \
                FROM ({value_scope_sql}) AS tapir_values \
                WHERE tapir_value IS NOT NULL AND LENGTH(TRIM(tapir_value)) > 0\
            )"
        );

        let stats_sql = format!(
            "{lengths_cte} \
             SELECT COUNT(*) AS non_empty_rows, MIN(tapir_length), MAX(tapir_length), AVG(tapir_length) \
             FROM lengths"
        );

        let (non_empty_rows, min_length, max_length, average_length): (
            i64,
            Option<i64>,
            Option<i64>,
            Option<f64>,
        ) = connection
            .query_row(&stats_sql, [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|error| AppError::Sql(format!("failed to compute length stats: {error}")))?;

        let bucket_sql = format!(
            "{lengths_cte} \
             SELECT \
                CASE \
                    WHEN tapir_length BETWEEN 1 AND 4 THEN 1 \
                    WHEN tapir_length BETWEEN 5 AND 8 THEN 2 \
                    WHEN tapir_length BETWEEN 9 AND 16 THEN 3 \
                    WHEN tapir_length BETWEEN 17 AND 32 THEN 4 \
                    WHEN tapir_length BETWEEN 33 AND 64 THEN 5 \
                    WHEN tapir_length BETWEEN 65 AND 128 THEN 6 \
                    ELSE 7 \
                END AS bucket_order, \
                COUNT(*) AS frequency \
             FROM lengths \
             GROUP BY bucket_order \
             ORDER BY bucket_order ASC"
        );

        let mut statement = connection.prepare(&bucket_sql).map_err(|error| {
            AppError::Sql(format!("failed to prepare length bucket query: {error}"))
        })?;
        let mut cursor = statement.query([]).map_err(|error| {
            AppError::Sql(format!("failed to execute length bucket query: {error}"))
        })?;

        let mut frequencies_by_order = HashMap::<i64, usize>::new();
        while let Some(row) = cursor
            .next()
            .map_err(|error| AppError::Sql(format!("failed to iterate length buckets: {error}")))?
        {
            let order: i64 = row
                .get(0)
                .map_err(|error| AppError::Sql(format!("failed to read bucket order: {error}")))?;
            let frequency: i64 = row.get(1).map_err(|error| {
                AppError::Sql(format!("failed to read bucket frequency: {error}"))
            })?;
            frequencies_by_order.insert(order, frequency.max(0) as usize);
        }

        let buckets = LENGTH_BUCKETS
            .iter()
            .enumerate()
            .map(
                |(index, (label, min_inclusive, max_inclusive))| StringLengthBucket {
                    label: String::from(*label),
                    min_inclusive: *min_inclusive,
                    max_inclusive: *max_inclusive,
                    frequency: *frequencies_by_order
                        .get(&((index + 1) as i64))
                        .unwrap_or(&0),
                },
            )
            .collect::<Vec<_>>();

        Ok(StringLengthHistogram {
            non_empty_rows: non_empty_rows.max(0) as usize,
            min_length: min_length.map(|value| value.max(0) as usize),
            max_length: max_length.map(|value| value.max(0) as usize),
            average_length: average_length.map(|value| (value * 100.0).round() / 100.0),
            buckets,
        })
    }
}

impl CsvQueryEngine for DuckDbEngine {
    fn register_csv(
        &self,
        existing: &HashMap<String, RegisteredCsv>,
        file_path: &str,
    ) -> EngineResult<RegisteredCsv> {
        let normalized_path = PathBuf::from(file_path);
        if !normalized_path.exists() {
            return Err(AppError::Validation(format!(
                "CSV file does not exist: {file_path}"
            )));
        }

        info!("register_csv path={}", normalized_path.display());

        let table_name = self.derive_table_name(existing, &normalized_path)?;

        Ok(RegisteredCsv {
            table_name,
            file_path: normalized_path.to_string_lossy().to_string(),
        })
    }

    fn describe_table(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        table_name: &str,
    ) -> EngineResult<Vec<ColumnSchema>> {
        self.validate_registered_files(registered)?;

        self.with_connection(registered, |connection| {
            debug!("describe_table table={}", table_name);
            let schema_sql = format!(
                "SELECT * FROM {} LIMIT 0",
                sql_builder::quote_identifier(table_name)
            );
            self.describe_query_schema(connection, &schema_sql)
        })
    }

    fn execute_query_chunk(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        limit: usize,
        offset: usize,
    ) -> EngineResult<QueryChunk> {
        self.validate_registered_files(registered)?;

        if sql.trim().is_empty() {
            return Err(AppError::Validation(String::from("query cannot be empty")));
        }

        let normalized_sql = self.normalize_sql(sql);
        if normalized_sql.is_empty() {
            return Err(AppError::Validation(String::from("query cannot be empty")));
        }

        Self::pre_validate_user_sql(&normalized_sql)?;

        let bounded_limit = limit.clamp(1, 2_000);
        debug!(
            "execute_query_chunk limit={} offset={} bounded_limit={}",
            limit, offset, bounded_limit
        );

        self.with_connection(registered, |connection| {
            let start = Instant::now();
            // Validate user SQL before wrapping it in DESCRIBE/SELECT helper SQL.
            // On Windows, malformed SQL in the DESCRIBE wrapper has proven less
            // stable than failing fast on the raw user query.
            self.validate_query_sql(connection, &normalized_sql)?;
            debug!("execute_query_chunk describing query schema");
            let columns = self.describe_query_schema(connection, &normalized_sql)?;

            let paged_sql =
                sql_builder::build_paged_select_sql(&normalized_sql, &columns, bounded_limit + 1, offset);
            debug!("execute_query_chunk preparing paged query");
            let mut statement = connection
                .prepare(&paged_sql)
                .map_err(|error| AppError::Sql(format!("failed to prepare query: {error}")))?;
            debug!("execute_query_chunk executing paged query");
            let mut cursor = statement
                .query([])
                .map_err(|error| AppError::Sql(format!("failed to execute query: {error}")))?;

            let mut rows = Vec::<HashMap<String, Value>>::new();
            while let Some(row) = cursor
                .next()
                .map_err(|error| AppError::Sql(format!("failed to fetch query row: {error}")))?
            {
                let mut map = HashMap::new();
                for (index, column) in columns.iter().enumerate() {
                    let value: Option<String> = row.get(index).map_err(|error| {
                        AppError::Sql(format!("failed to read cell value: {error}"))
                    })?;

                    map.insert(
                        column.name.clone(),
                        value.map(Value::String).unwrap_or(Value::Null),
                    );
                }
                rows.push(map);
            }

            let has_more = rows.len() > bounded_limit;
            if has_more {
                rows.truncate(bounded_limit);
            }

            debug!(
                "execute_query_chunk completed rows={} has_more={} elapsed_ms={}",
                rows.len(),
                has_more,
                start.elapsed().as_millis()
            );

            Ok(QueryChunk {
                columns: columns.into_iter().map(|column| column.name).collect(),
                rows,
                limit: bounded_limit,
                offset,
                next_offset: has_more.then_some(offset + bounded_limit),
                elapsed_ms: start.elapsed().as_millis() as u64,
            })
        })
    }

    fn start_query_session(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
    ) -> EngineResult<QuerySession> {
        self.validate_registered_files(registered)?;

        if sql.trim().is_empty() {
            return Err(AppError::Validation(String::from("query cannot be empty")));
        }

        let normalized_sql = sql.trim().trim_end_matches(';').to_string();
        Self::pre_validate_user_sql(&normalized_sql)?;
        let session_id = self.next_session_id();

        let started = Instant::now();
        let (columns, total_rows) = self.with_connection(registered, |connection| {
            self.validate_query_sql(connection, &normalized_sql)?;
            let columns = self.describe_query_schema(connection, &normalized_sql)?;
            let count_sql = sql_builder::build_count_sql(&normalized_sql);
            let total_rows: i64 = connection
                .query_row(&count_sql, [], |row| row.get(0))
                .map_err(|error| {
                    AppError::Sql(format!("failed to count query session rows: {error}"))
                })?;

            Ok((
                columns
                    .into_iter()
                    .map(|column| column.name)
                    .collect::<Vec<_>>(),
                total_rows.max(0) as usize,
            ))
        })?;

        self.sessions
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock query sessions")))?
            .insert(
                session_id.clone(),
                QuerySessionState {
                    sql: normalized_sql,
                    columns: columns.clone(),
                    total_rows,
                },
            );

        Ok(QuerySession {
            session_id,
            columns,
            total_rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    fn read_query_session_chunk(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        session_id: &str,
        limit: usize,
        offset: usize,
    ) -> EngineResult<QueryChunk> {
        let session = self.lookup_session(session_id)?;
        let bounded_limit = limit.clamp(1, 2_000);

        self.with_connection(registered, |connection| {
            let start = Instant::now();
            let projection_schema = session
                .columns
                .iter()
                .map(|name| ColumnSchema {
                    name: name.clone(),
                    data_type: String::from("VARCHAR"),
                })
                .collect::<Vec<_>>();
            let paged_sql = sql_builder::build_paged_select_sql(
                &session.sql,
                &projection_schema,
                bounded_limit + 1,
                offset,
            );

            let mut statement = connection.prepare(&paged_sql).map_err(|error| {
                AppError::Sql(format!("failed to prepare session query: {error}"))
            })?;
            let mut cursor = statement.query([]).map_err(|error| {
                AppError::Sql(format!("failed to execute session query: {error}"))
            })?;

            let mut rows = Vec::<HashMap<String, Value>>::new();
            while let Some(row) = cursor
                .next()
                .map_err(|error| AppError::Sql(format!("failed to fetch session row: {error}")))?
            {
                let mut map = HashMap::new();
                for (index, column) in session.columns.iter().enumerate() {
                    let value: Option<String> = row.get(index).map_err(|error| {
                        AppError::Sql(format!("failed to read cell value: {error}"))
                    })?;

                    map.insert(
                        column.clone(),
                        value.map(Value::String).unwrap_or(Value::Null),
                    );
                }
                rows.push(map);
            }

            let has_more = rows.len() > bounded_limit;
            if has_more {
                rows.truncate(bounded_limit);
            }

            let row_count = rows.len();

            Ok(QueryChunk {
                columns: session.columns.clone(),
                rows,
                limit: bounded_limit,
                offset,
                next_offset: has_more
                    .then_some(offset + row_count)
                    .filter(|next| *next < session.total_rows),
                elapsed_ms: start.elapsed().as_millis() as u64,
            })
        })
    }

    fn close_query_session(
        &self,
        _registered: &HashMap<String, RegisteredCsv>,
        session_id: &str,
    ) -> EngineResult<bool> {
        Ok(self.remove_session(session_id)?.is_some())
    }

    fn clear_query_sessions(
        &self,
        _registered: &HashMap<String, RegisteredCsv>,
    ) -> EngineResult<()> {
        self.sessions
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock query sessions")))?
            .clear();

        Ok(())
    }

    fn export_query_to_csv(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        output_path: &str,
    ) -> EngineResult<ExportResult> {
        self.validate_registered_files(registered)?;

        if sql.trim().is_empty() {
            return Err(AppError::Validation(String::from(
                "query cannot be empty for export",
            )));
        }

        let normalized_sql = self.normalize_sql(sql);
        if normalized_sql.is_empty() {
            return Err(AppError::Validation(String::from(
                "query cannot be empty for export",
            )));
        }

        Self::pre_validate_user_sql(&normalized_sql)?;

        let target_path = PathBuf::from(output_path);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppError::Io(format!(
                    "failed to create export directory {}: {error}",
                    parent.display()
                ))
            })?;
        }

        self.with_connection(registered, |connection| {
            debug!("export_query_to_csv output_path={}", output_path);
            self.validate_query_sql(connection, &normalized_sql)?;
            let count_sql = sql_builder::build_count_sql(&normalized_sql);
            let rows_written: i64 = connection
                .query_row(&count_sql, [], |row| row.get(0))
                .map_err(|error| AppError::Sql(format!("failed to count export rows: {error}")))?;

            let export_sql = sql_builder::build_export_csv_sql(&normalized_sql, output_path);
            connection
                .execute_batch(&export_sql)
                .map_err(|error| AppError::Sql(format!("failed to export CSV: {error}")))?;

            Ok(ExportResult {
                output_path: target_path.to_string_lossy().to_string(),
                rows_written: rows_written.max(0) as u64,
            })
        })
    }

    fn run_column_profile_metric(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        sql: &str,
        column_name: &str,
        metric: ColumnProfileMetricKind,
        total_rows_hint: Option<usize>,
    ) -> EngineResult<ColumnProfileMetric> {
        self.validate_registered_files(registered)?;

        let normalized_sql = self.normalize_sql(sql);
        if normalized_sql.is_empty() {
            return Err(AppError::Validation(String::from(
                "query cannot be empty for profiling",
            )));
        }

        let normalized_column = column_name.trim();
        if normalized_column.is_empty() {
            return Err(AppError::Validation(String::from(
                "column name cannot be empty for profiling",
            )));
        }

        Self::pre_validate_user_sql(&normalized_sql)?;

        self.with_connection(registered, |connection| {
            let started = Instant::now();

            self.validate_query_sql(connection, &normalized_sql)?;

            // Profiling runs in background and may overlap with interactive query commands.
            // Keep a conservative DuckDB thread count per profiling task to reduce contention.
            connection
                .execute_batch("PRAGMA threads=1;")
                .map_err(|error| {
                    AppError::Sql(format!("failed to set profiling thread limit: {error}"))
                })?;

            let mut resolved_total_rows = total_rows_hint.unwrap_or(0);

            let mut result = ColumnProfileMetric {
                column_name: normalized_column.to_string(),
                metric: metric.clone(),
                elapsed_ms: 0,
                total_rows: 0,
                cardinality_top_values: None,
                unique_value_count: None,
                completeness: None,
                string_length_histogram: None,
            };

            match metric {
                ColumnProfileMetricKind::CardinalityTopValues => {
                    if resolved_total_rows == 0 {
                        resolved_total_rows = self.count_total_rows(connection, &normalized_sql)?;
                    }
                    let (unique_value_count, top_values) = self.query_cardinality_metric(
                        connection,
                        &normalized_sql,
                        normalized_column,
                    )?;
                    result.unique_value_count = Some(unique_value_count);
                    result.cardinality_top_values = Some(top_values);
                }
                ColumnProfileMetricKind::CompletenessAudit => {
                    let (completeness, total_rows) = self.query_completeness_metric(
                        connection,
                        &normalized_sql,
                        normalized_column,
                    )?;
                    resolved_total_rows = total_rows;
                    result.completeness = Some(completeness);
                }
                ColumnProfileMetricKind::StringLengthHistogram => {
                    if resolved_total_rows == 0 {
                        resolved_total_rows = self.count_total_rows(connection, &normalized_sql)?;
                    }
                    let histogram = self.query_string_length_histogram(
                        connection,
                        &normalized_sql,
                        normalized_column,
                    )?;
                    result.string_length_histogram = Some(histogram);
                }
            }

            result.total_rows = resolved_total_rows;
            result.elapsed_ms = started.elapsed().as_millis() as u64;
            Ok(result)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_csv(contents: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("valid system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "tapir_query_{unique}_{}_test.csv",
            std::process::id()
        ));

        std::fs::write(&path, contents).expect("write csv fixture");
        path
    }

    #[test]
    fn handles_empty_csv_with_headers() {
        let csv_path = make_temp_csv("id,name\n");
        let engine = DuckDbEngine::new(2);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let chunk = engine
            .execute_query_chunk(
                &registered,
                &format!(
                    "SELECT * FROM {}",
                    sql_builder::quote_identifier(&table.table_name)
                ),
                100,
                0,
            )
            .expect("execute query on empty csv");

        assert_eq!(
            chunk.columns,
            vec![String::from("id"), String::from("name")]
        );
        assert!(chunk.rows.is_empty());

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn supports_special_header_names() {
        let csv_path = make_temp_csv("\"Customer ID\",\"Total Amount($)\"\n\"C-1\",42.5\n");
        let engine = DuckDbEngine::new(2);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let sql = format!(
            "SELECT \"Customer ID\", \"Total Amount($)\" FROM {}",
            sql_builder::quote_identifier(&table.table_name)
        );

        let chunk = engine
            .execute_query_chunk(&registered, &sql, 100, 0)
            .expect("execute query with special headers");

        assert_eq!(
            chunk.columns,
            vec![String::from("Customer ID"), String::from("Total Amount($)")]
        );
        assert_eq!(chunk.rows.len(), 1);
        assert_eq!(
            chunk.rows[0].get("Customer ID"),
            Some(&Value::String(String::from("C-1")))
        );

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn returns_sql_error_for_invalid_query() {
        let csv_path = make_temp_csv("id,name\n1,alice\n");
        let engine = DuckDbEngine::new(2);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table);

        let error = engine
            .execute_query_chunk(&registered, "SELECT FROM", 100, 0)
            .expect_err("invalid sql should fail");

        assert!(matches!(error, AppError::Sql(_)));

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn returns_sql_error_for_nonsense_query_text() {
        let csv_path = make_temp_csv("id,name\n1,alice\n");
        let engine = DuckDbEngine::new(2);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table);

        let error = engine
            .execute_query_chunk(&registered, "asdf", 100, 0)
            .expect_err("nonsense sql should fail");

        assert!(matches!(error, AppError::Sql(_)));
        assert!(error.to_string().contains("asdf"));

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn run_column_profile_metric_returns_sql_error_for_invalid_query() {
        let csv_path = make_temp_csv("id,name\n1,alice\n");
        let engine = DuckDbEngine::new(1);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table);

        let error = engine
            .run_column_profile_metric(
                &registered,
                "asdf",
                "name",
                ColumnProfileMetricKind::CompletenessAudit,
                None,
            )
            .expect_err("invalid profile sql should fail");

        assert!(matches!(error, AppError::Sql(_)));
        assert!(error.to_string().contains("asdf"));

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn reads_real_world_sample_fixture() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/downloads/customers-100.csv");
        if !fixture.exists() {
            eprintln!(
                "skipping real-world fixture test; missing {}",
                fixture.display()
            );
            return;
        }

        let engine = DuckDbEngine::new(2);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, fixture.to_string_lossy().as_ref())
            .expect("register real-world fixture");
        registered.insert(table.table_name.clone(), table.clone());

        let chunk = engine
            .execute_query_chunk(
                &registered,
                &format!(
                    "SELECT * FROM {} ORDER BY 1 LIMIT 25",
                    sql_builder::quote_identifier(&table.table_name)
                ),
                25,
                0,
            )
            .expect("query real-world fixture");

        assert_eq!(chunk.rows.len(), 25);
        assert!(!chunk.columns.is_empty());
    }

    #[test]
    fn execute_query_chunk_succeeds_across_threads_after_describe_table() {
        let csv_path = make_temp_csv("id,name\n1,alice\n");
        let engine = Arc::new(DuckDbEngine::new(1));
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let describe_engine = Arc::clone(&engine);
        let describe_registry = registered.clone();
        let describe_table_name = table.table_name.clone();
        let (describe_tx, describe_rx) = mpsc::channel();
        let describe_worker = thread::spawn(move || {
            let result = describe_engine
                .describe_table(&describe_registry, &describe_table_name)
                .map(|_| ());
            describe_tx.send(result).expect("send describe result");
        });

        describe_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("describe should finish")
            .expect("describe should succeed");
        describe_worker.join().expect("join describe worker");

        let query_engine = Arc::clone(&engine);
        let query_registry = registered.clone();
        let sql = format!(
            "SELECT * FROM {}",
            sql_builder::quote_identifier(&table.table_name)
        );
        let (query_tx, query_rx) = mpsc::channel();
        let query_worker = thread::spawn(move || {
            let result = query_engine.execute_query_chunk(&query_registry, &sql, 100, 0);
            query_tx.send(result).expect("send query result");
        });

        let chunk = query_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("query should finish without hanging")
            .expect("query should succeed");
        query_worker.join().expect("join query worker");

        assert_eq!(chunk.rows.len(), 1);

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn session_chunk_read_succeeds_after_interleaved_direct_query() {
        let csv_path = make_temp_csv("id,name\n1,alice\n2,bob\n");
        let engine = DuckDbEngine::new(1);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let session = engine
            .start_query_session(
                &registered,
                &format!(
                    "SELECT * FROM {}",
                    sql_builder::quote_identifier(&table.table_name)
                ),
            )
            .expect("start query session");

        let direct = engine
            .execute_query_chunk(
                &registered,
                &format!(
                    "SELECT * FROM {} ORDER BY id",
                    sql_builder::quote_identifier(&table.table_name)
                ),
                1,
                0,
            )
            .expect("run direct query between session reads");
        assert_eq!(direct.rows.len(), 1);

        let chunk = engine
            .read_query_session_chunk(&registered, &session.session_id, 10, 0)
            .expect("read query session chunk");

        assert_eq!(chunk.rows.len(), 2);
        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn run_column_profile_metric_returns_exact_cardinality_and_completeness() {
        let csv_path =
            make_temp_csv("partner,iban\nACME,DE123\nACME,DE123\nBETA,DE999\n,DE999\n   ,\n");
        let engine = DuckDbEngine::new(1);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let sql = format!(
            "SELECT partner, iban FROM {}",
            sql_builder::quote_identifier(&table.table_name)
        );

        let cardinality = engine
            .run_column_profile_metric(
                &registered,
                &sql,
                "partner",
                ColumnProfileMetricKind::CardinalityTopValues,
                None,
            )
            .expect("run cardinality metric");

        assert_eq!(cardinality.total_rows, 5);
        assert_eq!(cardinality.unique_value_count, Some(4));
        let top_values = cardinality
            .cardinality_top_values
            .expect("cardinality payload");
        assert!(top_values
            .iter()
            .any(|entry| { entry.value == "ACME" && entry.frequency == 2 }));
        let empty_frequency = top_values
            .iter()
            .filter(|entry| entry.value == "<EMPTY>" || entry.value == "<NULL>")
            .map(|entry| entry.frequency)
            .sum::<usize>();
        assert_eq!(empty_frequency, 2);

        let completeness = engine
            .run_column_profile_metric(
                &registered,
                &sql,
                "partner",
                ColumnProfileMetricKind::CompletenessAudit,
                None,
            )
            .expect("run completeness metric");

        let audit = completeness.completeness.expect("completeness payload");
        assert_eq!(completeness.total_rows, 5);
        assert_eq!(audit.populated, 3);
        assert_eq!(audit.empty_or_null, 2);
        assert!((audit.completeness_ratio - 0.6).abs() < f64::EPSILON);

        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn run_column_profile_metric_returns_exact_string_length_histogram() {
        let csv_path =
            make_temp_csv("partner,iban\nACME,DE123\nACME,DE123\nBETA,DE999\n,DE999\n   ,\n");
        let engine = DuckDbEngine::new(1);
        let mut registered = HashMap::new();

        let table = engine
            .register_csv(&registered, csv_path.to_string_lossy().as_ref())
            .expect("register CSV");
        registered.insert(table.table_name.clone(), table.clone());

        let sql = format!(
            "SELECT partner, iban FROM {}",
            sql_builder::quote_identifier(&table.table_name)
        );

        let histogram = engine
            .run_column_profile_metric(
                &registered,
                &sql,
                "iban",
                ColumnProfileMetricKind::StringLengthHistogram,
                None,
            )
            .expect("run length histogram metric")
            .string_length_histogram
            .expect("histogram payload");

        assert_eq!(histogram.non_empty_rows, 4);
        assert_eq!(histogram.min_length, Some(5));
        assert_eq!(histogram.max_length, Some(5));
        assert_eq!(histogram.average_length, Some(5.0));

        let bucket_5_to_8 = histogram
            .buckets
            .iter()
            .find(|bucket| bucket.label == "5-8")
            .expect("5-8 bucket present");
        assert_eq!(bucket_5_to_8.frequency, 4);

        let _ = std::fs::remove_file(csv_path);
    }
}
