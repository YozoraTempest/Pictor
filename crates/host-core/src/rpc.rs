use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{HostError, RpcErrorBody};

/// A JSON-RPC 2.0 request frame. Frames are newline delimited (NDJSON).
#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub jsonrpc: Option<String>,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcErrorBody>,
}

impl Response {
    pub fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: Value, error: &HostError) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcErrorBody::from(error)),
        }
    }
}

/// Decode one NDJSON frame. Blank lines are ignored by the caller.
pub fn parse_request(line: &str) -> Result<Request, HostError> {
    let request: Request = serde_json::from_str(line)
        .map_err(|error| HostError::InvalidParams(format!("malformed request: {error}")))?;
    if let Some(version) = request.jsonrpc.as_deref() {
        if version != "2.0" {
            return Err(HostError::InvalidParams(format!(
                "unsupported jsonrpc version: {version}"
            )));
        }
    }

    if request.method.trim().is_empty() {
        return Err(HostError::InvalidParams("method must not be empty".into()));
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_request_without_params() {
        let request = parse_request(r#"{"jsonrpc":"2.0","id":1,"method":"system.ping"}"#).unwrap();
        assert_eq!(request.method, "system.ping");
        assert_eq!(request.id, Some(json!(1)));
        assert!(request.params.is_null());
    }

    #[test]
    fn rejects_malformed_json() {
        let error = parse_request("{").unwrap_err();
        assert!(matches!(error, HostError::InvalidParams(_)));
    }

    #[test]
    fn rejects_unsupported_version() {
        let error = parse_request(r#"{"jsonrpc":"1.0","id":1,"method":"system.ping"}"#).unwrap_err();
        assert!(matches!(error, HostError::InvalidParams(_)));
    }

    #[test]
    fn rejects_empty_method() {
        let error = parse_request(r#"{"id":1,"method":"  "}"#).unwrap_err();
        assert!(matches!(error, HostError::InvalidParams(_)));
    }
}
