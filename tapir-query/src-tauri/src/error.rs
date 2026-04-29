use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error, Clone)]
pub enum AppError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("sql error: {0}")]
    Sql(String),
    #[error("state error: {0}")]
    State(String),
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}
