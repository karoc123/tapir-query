mod commands;
mod domain;
mod engine;
mod error;

use crate::domain::csv_query_service::CsvQueryService;
use crate::engine::duckdb_engine::DuckDbEngine;
use std::backtrace::Backtrace;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once, OnceLock};
use tauri::{AppHandle, Manager};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::prelude::*;
use tracing_subscriber::EnvFilter;

static TRACING_INIT: Once = Once::new();
static PANIC_HOOK_INIT: Once = Once::new();
static RUNTIME_LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();
static RUNTIME_FILE_LOGGING_ENABLED: AtomicBool = AtomicBool::new(false);

const RUNTIME_LOG_FILE_NAME: &str = "tapir-query.log";

pub struct AppState {
    pub csv_service: Arc<CsvQueryService>,
}

pub(crate) fn runtime_file_logging_enabled() -> bool {
    RUNTIME_FILE_LOGGING_ENABLED.load(Ordering::Relaxed)
}

pub(crate) fn set_runtime_file_logging_enabled(enabled: bool) {
    RUNTIME_FILE_LOGGING_ENABLED.store(enabled, Ordering::Relaxed);
}

impl Default for AppState {
    fn default() -> Self {
        let engine = Arc::new(DuckDbEngine::default());

        Self {
            csv_service: Arc::new(CsvQueryService::new(engine)),
        }
    }
}

fn init_tracing(app_handle: &AppHandle) {
    TRACING_INIT.call_once(|| {
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("tapir_query_lib=debug,tapir_query=debug,info"));

        let stdout_layer = tracing_subscriber::fmt::layer()
            .with_target(false)
            .compact();

        let mut runtime_log_path: Option<PathBuf> = None;
        let mut runtime_log_guard: Option<WorkerGuard> = None;
        let mut runtime_log_warning: Option<String> = None;

        let file_layer = match create_runtime_log_writer(app_handle) {
            Ok((writer, guard, path)) => {
                runtime_log_path = Some(path);
                runtime_log_guard = Some(guard);
                Some(
                    tracing_subscriber::fmt::layer()
                        .with_ansi(false)
                        .with_target(false)
                        .compact()
                        .with_writer(writer.with_filter(|_| runtime_file_logging_enabled())),
                )
            }
            Err(error) => {
                runtime_log_warning = Some(error);
                None
            }
        };

        let subscriber = tracing_subscriber::registry()
            .with(env_filter)
            .with(stdout_layer)
            .with(file_layer);

        match subscriber.try_init() {
            Ok(()) => {
                if let Some(warning) = runtime_log_warning {
                    tracing::warn!("{warning}");
                }

                if let Some(path) = runtime_log_path {
                    tracing::debug!("runtime file logging ready path={}", path.display());
                }

                if let Some(guard) = runtime_log_guard {
                    let _ = RUNTIME_LOG_GUARD.set(guard);
                }
            }
            Err(error) => {
                eprintln!("failed to initialize tracing subscriber: {error}");
            }
        }
    });
}

fn create_runtime_log_writer(
    app_handle: &AppHandle,
) -> Result<(tracing_appender::non_blocking::NonBlocking, WorkerGuard, PathBuf), String> {
    let log_path = resolve_runtime_log_path(app_handle)?;
    let log_directory = log_path.parent().ok_or_else(|| {
        format!(
            "failed to resolve runtime log directory for {}",
            log_path.display()
        )
    })?;

    fs::create_dir_all(log_directory).map_err(|error| {
        format!(
            "failed to create runtime log directory {}: {error}",
            log_directory.display()
        )
    })?;

    let file_appender = tracing_appender::rolling::never(log_directory, RUNTIME_LOG_FILE_NAME);
    let (writer, guard) = tracing_appender::non_blocking(file_appender);
    Ok((writer, guard, log_path))
}

pub(crate) fn resolve_runtime_log_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .or_else(|_| app_handle.path().app_data_dir().map(|directory| directory.join("logs")))
        .map_err(|error| format!("failed to resolve runtime log directory: {error}"))?;

    Ok(log_dir.join(RUNTIME_LOG_FILE_NAME))
}

fn install_panic_hook() {
    PANIC_HOOK_INIT.call_once(|| {
        let previous_hook = std::panic::take_hook();

        std::panic::set_hook(Box::new(move |panic_info| {
            let location = panic_info
                .location()
                .map(|location| format!("{}:{}:{}", location.file(), location.line(), location.column()))
                .unwrap_or_else(|| String::from("unknown"));
            let payload = if let Some(message) = panic_info.payload().downcast_ref::<&str>() {
                (*message).to_string()
            } else if let Some(message) = panic_info.payload().downcast_ref::<String>() {
                message.clone()
            } else {
                String::from("non-string panic payload")
            };
            let backtrace = Backtrace::force_capture();

            tracing::error!(
                "application panic captured location={} payload={} backtrace=\n{}",
                location,
                payload,
                backtrace
            );

            previous_hook(panic_info);
        }));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            init_tracing(app.handle());
            install_panic_hook();
            tracing::info!("tauri application setup completed");
            Ok(())
        })
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
            commands::csv_commands::export_rows,
            commands::csv_commands::get_runtime_logging_status,
            commands::csv_commands::set_runtime_logging_enabled
        ]);

    if let Err(error) = builder.run(tauri::generate_context!()) {
        eprintln!("error while running tauri application: {error}");
        tracing::error!("error while running tauri application: {error}");
    }
}
