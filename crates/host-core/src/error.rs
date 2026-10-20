use serde::Serialize;

/// Errors that can cross the sidecar boundary.
///
/// Every variant maps to a stable JSON-RPC error code so the TypeScript side can
/// branch on the code instead of matching message text.
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("invalid params: {0}")]
    InvalidParams(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("storage failure: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("io failure: {0}")]
    Io(#[from] std::io::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

impl HostError {
    pub fn code(&self) -> i64 {
        match self {
            HostError::InvalidParams(_) => -32602,
            HostError::NotFound(_) => -32004,
            HostError::Conflict(_) => -32009,
            HostError::Storage(_) | HostError::Io(_) => -32010,
            HostError::Internal(_) => -32603,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RpcErrorBody {
    pub code: i64,
    pub message: String,
}

impl From<&HostError> for RpcErrorBody {
    fn from(error: &HostError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}
