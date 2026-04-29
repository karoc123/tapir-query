use crate::engine::sql_builder;
use crate::engine::{
    ColumnSchema, CsvQueryEngine, EngineResult, ExportResult, QueryChunk, QuerySession,
    RegisteredCsv,
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
    table_name: String,
    columns: Vec<String>,
    total_rows: usize,
}

pub struct DuckDbEngine {
    pool: DuckDbPool,
    session_counter: AtomicU64,
    sessions: Mutex<HashMap<String, QuerySessionState>>,
}

impl Default for DuckDbEngine {
    fn default() -> Self {
        // Materialized query sessions are stored in temp tables and require a stable
        // in-memory connection across requests.
        Self::new(1)
    }
}

impl DuckDbEngine {
    pub fn new(pool_size: usize) -> Self {
        Self {
            pool: DuckDbPool::new(pool_size.max(1)),
            session_counter: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn next_session_id(&self) -> String {
        let next = self.session_counter.fetch_add(1, Ordering::Relaxed);
        format!("session-{next}")
    }

    fn session_table_name(session_id: &str) -> String {
        let sanitized = session_id
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect::<String>();
        format!("tapir_result_{sanitized}")
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
        let pooled_connection = self.pool.acquire()?;
        let connection = pooled_connection.as_ref();

        debug!("acquired pooled DuckDB connection");

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

        operation(connection)
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

        let bounded_limit = limit.clamp(1, 2_000);
        debug!(
            "execute_query_chunk limit={} offset={} bounded_limit={}",
            limit, offset, bounded_limit
        );

        self.with_connection(registered, |connection| {
            let start = Instant::now();
            let columns = self.describe_query_schema(connection, sql)?;

            let paged_sql =
                sql_builder::build_paged_select_sql(sql, &columns, bounded_limit + 1, offset);
            let mut statement = connection
                .prepare(&paged_sql)
                .map_err(|error| AppError::Sql(format!("failed to prepare query: {error}")))?;
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

        let session_id = self.next_session_id();
        let session_table_name = Self::session_table_name(&session_id);

        let started = Instant::now();
        let (columns, total_rows) = self.with_connection(registered, |connection| {
            let columns = self.describe_query_schema(connection, sql)?;
            let create_sql = sql_builder::build_materialized_session_sql(sql, &session_table_name);
            connection.execute_batch(&create_sql).map_err(|error| {
                AppError::Sql(format!("failed to materialize query session: {error}"))
            })?;

            let count_sql = sql_builder::build_count_table_sql(&session_table_name);
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
                    table_name: session_table_name,
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
            let paged_sql = sql_builder::build_paged_session_sql(
                &session.table_name,
                &session.columns,
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

            if rows.len() > bounded_limit {
                rows.truncate(bounded_limit);
            }

            let row_count = rows.len();
            let has_more = offset + row_count < session.total_rows;

            Ok(QueryChunk {
                columns: session.columns.clone(),
                rows,
                limit: bounded_limit,
                offset,
                next_offset: has_more.then_some(offset + row_count),
                elapsed_ms: start.elapsed().as_millis() as u64,
            })
        })
    }

    fn close_query_session(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
        session_id: &str,
    ) -> EngineResult<bool> {
        let Some(session) = self.remove_session(session_id)? else {
            return Ok(false);
        };

        self.with_connection(registered, |connection| {
            let drop_sql = sql_builder::build_drop_table_sql(&session.table_name);
            connection.execute_batch(&drop_sql).map_err(|error| {
                AppError::Sql(format!("failed to close query session: {error}"))
            })?;
            Ok(())
        })?;

        Ok(true)
    }

    fn clear_query_sessions(
        &self,
        registered: &HashMap<String, RegisteredCsv>,
    ) -> EngineResult<()> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock query sessions")))?
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>();

        if sessions.is_empty() {
            return Ok(());
        }

        self.with_connection(registered, move |connection| {
            for session in &sessions {
                let drop_sql = sql_builder::build_drop_table_sql(&session.table_name);
                connection.execute_batch(&drop_sql).map_err(|error| {
                    AppError::Sql(format!("failed to clear query sessions: {error}"))
                })?;
            }
            Ok(())
        })
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
            let count_sql = sql_builder::build_count_sql(sql);
            let rows_written: i64 = connection
                .query_row(&count_sql, [], |row| row.get(0))
                .map_err(|error| AppError::Sql(format!("failed to count export rows: {error}")))?;

            let export_sql = sql_builder::build_export_csv_sql(sql, output_path);
            connection
                .execute_batch(&export_sql)
                .map_err(|error| AppError::Sql(format!("failed to export CSV: {error}")))?;

            Ok(ExportResult {
                output_path: target_path.to_string_lossy().to_string(),
                rows_written: rows_written.max(0) as u64,
            })
        })
    }
}

struct DuckDbPool {
    max_size: usize,
    available: Mutex<Vec<Connection>>,
}

impl DuckDbPool {
    fn new(max_size: usize) -> Self {
        Self {
            max_size,
            available: Mutex::new(Vec::new()),
        }
    }

    fn acquire(&self) -> EngineResult<PooledConnection<'_>> {
        if let Some(connection) = self
            .available
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock connection pool")))?
            .pop()
        {
            return Ok(PooledConnection::new(self, connection));
        }

        let connection = Connection::open_in_memory()
            .map_err(|error| AppError::Sql(format!("failed to open DuckDB: {error}")))?;

        Ok(PooledConnection::new(self, connection))
    }

    fn release(&self, connection: Connection) {
        if let Ok(mut available) = self.available.lock() {
            if available.len() < self.max_size {
                available.push(connection);
            }
        }
    }
}

struct PooledConnection<'a> {
    pool: &'a DuckDbPool,
    connection: Option<Connection>,
}

impl<'a> PooledConnection<'a> {
    fn new(pool: &'a DuckDbPool, connection: Connection) -> Self {
        Self {
            pool,
            connection: Some(connection),
        }
    }

    fn as_ref(&self) -> &Connection {
        self.connection
            .as_ref()
            .expect("pooled connection should always be present while borrowed")
    }
}

impl<'a> Drop for PooledConnection<'a> {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.take() {
            self.pool.release(connection);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
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
}
