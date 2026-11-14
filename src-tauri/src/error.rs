use serde::Serialize;

/// 唯一错误源：所有 IPC 错误都以 `{ code, message }` 返回，前端统一映射中文文案
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("E_INVALID_INPUT", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("E_NOT_FOUND", message)
    }

    pub fn internal(context: &str, err: impl std::fmt::Display) -> Self {
        Self::new("E_INTERNAL", format!("{context}：{err}"))
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::new("E_DB_OPEN", format!("数据库操作失败：{err}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::new("E_BACKUP_IO", format!("文件读写失败：{err}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::new("E_INVALID_INPUT", format!("数据格式错误：{err}"))
    }
}

/// 每个错误码都必须在前端 errorText.ts 有对应中文文案
pub const ERROR_CODES: &[&str] = &[
    "E_DB_OPEN", "E_DB_MIGRATE", "E_CRYPTO_KEY", "E_IMPORT_FORMAT", "E_IMPORT_UID",
    "E_IMPORT_LEVEL", "E_BACKUP_DIR", "E_BACKUP_IO", "E_RESTORE_VERIFY", "E_RESTORE_MARKER",
    "E_SYNC_COOKIE", "E_SYNC_NETWORK", "E_SYNC_API", "E_NOT_FOUND", "E_INVALID_INPUT", "E_INTERNAL",
];
