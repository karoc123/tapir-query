use crate::engine::sql_builder;
use crate::engine::{ColumnSchema, CsvQueryEngine, ExportResult, QueryChunk, RegisteredCsv};
use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{debug, info};

#[derive(Debug, Clone)]
pub struct OpenedFile {
    pub table_name: String,
    pub file_path: String,
    pub columns: Vec<ColumnSchema>,
    pub default_query: String,
    pub file_size_bytes: Option<u64>,
}

pub struct CsvQueryService {
    engine: Arc<dyn CsvQueryEngine>,
    registry: Mutex<HashMap<String, RegisteredCsv>>,
}

impl CsvQueryService {
    pub fn new(engine: Arc<dyn CsvQueryEngine>) -> Self {
        Self {
            engine,
            registry: Mutex::new(HashMap::new()),
        }
    }

    pub fn open_file(&self, file_path: &str) -> AppResult<OpenedFile> {
        info!("csv_query_service open_file path={file_path}");

        let mut registry = self
            .registry
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock file registry")))?;

        let registered = self.engine.register_csv(&registry, file_path)?;

        registry.insert(registered.table_name.clone(), registered.clone());
        let current_registry = registry.clone();
        drop(registry);

        let columns = self
            .engine
            .describe_table(&current_registry, &registered.table_name)?;

        let file_size_bytes = std::fs::metadata(&registered.file_path)
            .ok()
            .map(|metadata| metadata.len());

        info!(
            "csv_query_service open_file success table={} columns={}",
            registered.table_name,
            columns.len()
        );

        Ok(OpenedFile {
            table_name: registered.table_name.clone(),
            file_path: registered.file_path,
            columns,
            default_query: sql_builder::build_default_query(&registered.table_name),
            file_size_bytes,
        })
    }

    pub fn execute_query(
        &self,
        sql: &str,
        limit: usize,
        offset: usize,
    ) -> AppResult<QueryChunk> {
        let registry = self.snapshot_registry()?;
        debug!("csv_query_service execute_query registry_size={}", registry.len());
        self.engine.execute_query_chunk(&registry, sql, limit, offset)
    }

    pub fn export_query_to_csv(&self, sql: &str, output_path: &str) -> AppResult<ExportResult> {
        let registry = self.snapshot_registry()?;
        debug!("csv_query_service export_query registry_size={}", registry.len());
        self.engine.export_query_to_csv(&registry, sql, output_path)
    }

    fn snapshot_registry(&self) -> AppResult<HashMap<String, RegisteredCsv>> {
        self.registry
            .lock()
            .map_err(|_| AppError::State(String::from("failed to lock file registry")))
            .map(|guard| guard.clone())
    }
}
