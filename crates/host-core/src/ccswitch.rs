use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::HostError;

/// One model entry inside a cc-switch `pi` provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchModel {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub reasoning: Option<bool>,
    /// Levels the model accepts; cc-switch never records them, so this is always
    /// null on import and the settings page fills it in.
    #[serde(default)]
    pub efforts: Option<Vec<String>>,
    #[serde(default)]
    pub input: Option<Vec<String>>,
    #[serde(default)]
    pub context_window: Option<i64>,
    #[serde(default)]
    pub max_tokens: Option<i64>,
}

/// `settings_config` payload stored by cc-switch for `app_type = 'pi'`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcSwitchSettings {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    api: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    models: Vec<CcSwitchModel>,
}

/// Summary handed to the application layer. The API key is never included.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProviderSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: Option<String>,
    pub models: Vec<CcSwitchModel>,
    pub has_api_key: bool,
}

/// Detail returned only after the user explicitly imports one provider.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchProviderDetail {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: Option<String>,
    pub models: Vec<CcSwitchModel>,
    pub api_key: Option<String>,
}

fn open_read_only(path: &str) -> Result<Connection, HostError> {
    let candidate = Path::new(path);
    if !candidate.is_file() {
        return Err(HostError::NotFound(format!("cc-switch database: {path}")));
    }

    let connection = Connection::open_with_flags(candidate, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    Ok(connection)
}

/// Lists every `pi` provider in a cc-switch database.
///
/// Rows whose `settings_config` is not valid JSON are skipped: cc-switch itself
/// tolerates partial records and one bad row must not break the import list.
pub fn scan(path: &str) -> Result<Vec<CcSwitchProviderSummary>, HostError> {
    let connection = open_read_only(path)?;
    let mut statement = connection.prepare(
        "SELECT id, name, settings_config FROM providers WHERE app_type = 'pi' \
         ORDER BY sort_index, name",
    )?;

    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut providers = Vec::new();
    for row in rows {
        let (id, fallback_name, raw) = row?;
        let settings: CcSwitchSettings = match serde_json::from_str(&raw) {
            Ok(settings) => settings,
            Err(_) => continue,
        };

        let base_url = settings.base_url.unwrap_or_default();
        if base_url.trim().is_empty() {
            continue;
        }

        providers.push(CcSwitchProviderSummary {
            id,
            name: settings.name.unwrap_or(fallback_name),
            base_url,
            api: settings.api,
            models: settings.models,
            has_api_key: settings
                .api_key
                .as_deref()
                .is_some_and(|key| !key.trim().is_empty()),
        });
    }

    Ok(providers)
}

/// Reads one provider, including its API key.
///
/// Only the application main process calls this, and it writes the key to the
/// profile auth file without ever forwarding it to the renderer.
pub fn read(path: &str, id: &str) -> Result<CcSwitchProviderDetail, HostError> {
    let connection = open_read_only(path)?;

    let row = connection
        .query_row(
            "SELECT id, name, settings_config FROM providers \
             WHERE app_type = 'pi' AND id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| HostError::NotFound(format!("cc-switch provider: {id}")))?;

    let (id, fallback_name, raw) = row;
    let settings: CcSwitchSettings = serde_json::from_str(&raw)
        .map_err(|error| HostError::Internal(format!("invalid cc-switch provider JSON: {error}")))?;

    let base_url = settings
        .base_url
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| HostError::InvalidParams("provider has no baseUrl".into()))?;

    Ok(CcSwitchProviderDetail {
        id,
        name: settings.name.unwrap_or(fallback_name),
        base_url,
        api: settings.api,
        models: settings.models,
        api_key: settings.api_key.filter(|key| !key.trim().is_empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> (tempfile::TempDir, String) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cc-switch.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE providers (
                    id TEXT NOT NULL,
                    app_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    settings_config TEXT NOT NULL,
                    sort_index INTEGER,
                    PRIMARY KEY (id, app_type)
                );",
            )
            .unwrap();

        let good = r#"{"name":"Neko","api":"openai-completions","baseUrl":"https://api.example.com","apiKey":"test-key","models":[{"id":"demo-1","name":"Demo One","reasoning":true,"contextWindow":1000,"maxTokens":200}]}"#;
        connection
            .execute(
                "INSERT INTO providers (id, app_type, name, settings_config, sort_index) VALUES (?1, 'pi', ?2, ?3, 0)",
                rusqlite::params!["neko", "Neko", good],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO providers (id, app_type, name, settings_config, sort_index) VALUES (?1, 'pi', ?2, ?3, 1)",
                rusqlite::params!["broken", "Broken", "{not json"],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO providers (id, app_type, name, settings_config, sort_index) VALUES (?1, 'claude', ?2, ?3, 2)",
                rusqlite::params!["other", "Other", good],
            )
            .unwrap();

        let path_string = path.to_string_lossy().to_string();
        (directory, path_string)
    }

    #[test]
    fn scans_valid_pi_providers_and_skips_broken_rows() {
        let (_directory, path) = fixture();
        let providers = scan(&path).unwrap();

        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "neko");
        assert_eq!(providers[0].name, "Neko");
        assert_eq!(providers[0].models.len(), 1);
        assert_eq!(providers[0].models[0].max_tokens, Some(200));
        assert!(providers[0].has_api_key);
    }

    #[test]
    fn summary_never_serialises_the_key() {
        let (_directory, path) = fixture();
        let providers = scan(&path).unwrap();
        let json = serde_json::to_string(&providers).unwrap();

        assert!(!json.contains("test-key"));
        assert!(!json.contains("apiKey"));
    }

    #[test]
    fn reads_one_provider_with_its_key() {
        let (_directory, path) = fixture();
        let provider = read(&path, "neko").unwrap();

        assert_eq!(provider.base_url, "https://api.example.com");
        assert_eq!(provider.api_key.as_deref(), Some("test-key"));
    }

    #[test]
    fn rejects_unknown_provider() {
        let (_directory, path) = fixture();
        let error = read(&path, "missing").unwrap_err();
        assert!(matches!(error, HostError::NotFound(_)));
    }

    #[test]
    fn rejects_a_missing_database() {
        let error = scan("/definitely/not/cc-switch.db").unwrap_err();
        assert!(matches!(error, HostError::NotFound(_)));
    }

    #[test]
    fn does_not_modify_the_source_database() {
        let (_directory, path) = fixture();
        let before = fs::metadata(&path).unwrap().len();
        let _ = scan(&path).unwrap();
        let after = fs::metadata(&path).unwrap().len();
        assert_eq!(before, after);
    }
}
