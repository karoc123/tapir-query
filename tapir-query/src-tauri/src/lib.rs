mod commands;
mod domain;
mod engine;
mod error;

use crate::domain::csv_query_service::CsvQueryService;
use crate::engine::duckdb_engine::DuckDbEngine;
use std::sync::{Arc, Once};
use tracing_subscriber::EnvFilter;

static TRACING_INIT: Once = Once::new();

pub struct AppState {
    pub csv_service: Arc<CsvQueryService>,
}

impl Default for AppState {
    fn default() -> Self {
        let engine = Arc::new(DuckDbEngine::default());

        Self {
            csv_service: Arc::new(CsvQueryService::new(engine)),
        }
    }
}

fn init_tracing() {
    TRACING_INIT.call_once(|| {
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("tapir_query=debug,info"));

        let _ = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .compact()
            .try_init();
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::csv_commands::open_file,
            commands::csv_commands::execute_query,
            commands::csv_commands::run_column_profile_metric,
            commands::csv_commands::start_query_session,
            commands::csv_commands::read_query_session_chunk,
            commands::csv_commands::close_query_session,
            commands::csv_commands::load_query_history,
            commands::csv_commands::save_query_history,
            commands::csv_commands::export_csv,
            commands::csv_commands::export_rows
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
