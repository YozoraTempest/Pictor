use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::error::HostError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub pi_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecord {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub source: String,
    pub installed_at: i64,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn list_projects(connection: &Connection) -> Result<Vec<Project>, HostError> {
    let mut statement = connection.prepare(
        "SELECT id, path, name, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn add_project(
    connection: &Connection,
    path: &str,
    name: Option<&str>,
) -> Result<Project, HostError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("project path must not be empty".into()));
    }

    let candidate = Path::new(trimmed);
    if !candidate.is_dir() {
        return Err(HostError::InvalidParams(format!(
            "project path is not a directory: {trimmed}"
        )));
    }

    let canonical = candidate.canonicalize()?;
    let canonical_path = canonical.to_string_lossy().to_string();

    let existing: Option<String> = connection
        .query_row("SELECT id FROM projects WHERE path = ?1", params![canonical_path], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(id) = existing {
        return Err(HostError::Conflict(format!("project already registered: {id}")));
    }

    let fallback_name = canonical
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical_path.clone());
    let resolved_name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_name)
        .to_string();

    let now = now_millis();
    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        path: canonical_path,
        name: resolved_name,
        created_at: now,
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project.id, project.path, project.name, project.created_at, project.updated_at],
    )?;

    Ok(project)
}

pub fn remove_project(connection: &Connection, id: &str) -> Result<(), HostError> {
    let affected = connection.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("project {id}")));
    }
    Ok(())
}

pub fn list_sessions(connection: &Connection, project_id: Option<&str>) -> Result<Vec<Session>, HostError> {
    let mut sessions = Vec::new();

    match project_id {
        Some(project_id) => {
            let mut statement = connection.prepare(
                "SELECT id, project_id, title, pi_session_id, created_at, updated_at
                 FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map(params![project_id], map_session)?;
            for row in rows {
                sessions.push(row?);
            }
        }
        None => {
            let mut statement = connection.prepare(
                "SELECT id, project_id, title, pi_session_id, created_at, updated_at
                 FROM sessions ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map([], map_session)?;
            for row in rows {
                sessions.push(row?);
            }
        }
    }

    Ok(sessions)
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        pi_session_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn create_session(connection: &Connection, project_id: &str, title: &str) -> Result<Session, HostError> {
    let project_exists: Option<String> = connection
        .query_row("SELECT id FROM projects WHERE id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .optional()?;
    if project_exists.is_none() {
        return Err(HostError::NotFound(format!("project {project_id}")));
    }

    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("session title must not be empty".into()));
    }

    let now = now_millis();
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.to_string(),
        title: trimmed.to_string(),
        pi_session_id: None,
        created_at: now,
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO sessions (id, project_id, title, pi_session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
        params![session.id, session.project_id, session.title, session.created_at, session.updated_at],
    )?;

    Ok(session)
}

pub fn rename_session(connection: &Connection, id: &str, title: &str) -> Result<Session, HostError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("session title must not be empty".into()));
    }

    let updated = connection.execute(
        "UPDATE sessions SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, trimmed, now_millis()],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
}

pub fn get_session(connection: &Connection, id: &str) -> Result<Option<Session>, HostError> {
    let session = connection
        .query_row(
            "SELECT id, project_id, title, pi_session_id, created_at, updated_at
             FROM sessions WHERE id = ?1",
            params![id],
            map_session,
        )
        .optional()?;
    Ok(session)
}

pub fn delete_session(connection: &Connection, id: &str) -> Result<(), HostError> {
    let affected = connection.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }
    Ok(())
}

pub fn list_settings(connection: &Connection) -> Result<Vec<(String, Value)>, HostError> {
    let mut statement = connection.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = statement.query_map([], |row| {
        let key: String = row.get(0)?;
        let raw: String = row.get(1)?;
        Ok((key, raw))
    })?;

    let mut settings = Vec::new();
    for row in rows {
        let (key, raw) = row?;
        let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
        settings.push((key, value));
    }
    Ok(settings)
}

pub fn put_setting(connection: &Connection, key: &str, value: &Value) -> Result<(), HostError> {
    if key.trim().is_empty() {
        return Err(HostError::InvalidParams("setting key must not be empty".into()));
    }
    let encoded = serde_json::to_string(value)
        .map_err(|error| HostError::Internal(format!("cannot encode setting: {error}")))?;
    connection.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, encoded, now_millis()],
    )?;
    Ok(())
}

pub fn list_plugins(connection: &Connection) -> Result<Vec<PluginRecord>, HostError> {
    let mut statement = connection.prepare(
        "SELECT id, version, enabled, source, installed_at FROM plugins ORDER BY id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PluginRecord {
            id: row.get(0)?,
            version: row.get(1)?,
            enabled: row.get::<_, i64>(2)? != 0,
            source: row.get(3)?,
            installed_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn upsert_plugin(
    connection: &Connection,
    id: &str,
    version: &str,
    enabled: bool,
    source: &str,
) -> Result<PluginRecord, HostError> {
    let installed_at = now_millis();
    connection.execute(
        "INSERT INTO plugins (id, version, enabled, source, installed_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, enabled = excluded.enabled,
             source = excluded.source",
        params![id, version, i64::from(enabled), source, installed_at],
    )?;

    let record = connection.query_row(
        "SELECT id, version, enabled, source, installed_at FROM plugins WHERE id = ?1",
        params![id],
        |row| {
            Ok(PluginRecord {
                id: row.get(0)?,
                version: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
                source: row.get(3)?,
                installed_at: row.get(4)?,
            })
        },
    )?;
    Ok(record)
}

pub fn set_plugin_enabled(connection: &Connection, id: &str, enabled: bool) -> Result<PluginRecord, HostError> {
    let affected = connection.execute(
        "UPDATE plugins SET enabled = ?2 WHERE id = ?1",
        params![id, i64::from(enabled)],
    )?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("plugin {id}")));
    }

    let record = connection.query_row(
        "SELECT id, version, enabled, source, installed_at FROM plugins WHERE id = ?1",
        params![id],
        |row| {
            Ok(PluginRecord {
                id: row.get(0)?,
                version: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
                source: row.get(3)?,
                installed_at: row.get(4)?,
            })
        },
    )?;
    Ok(record)
}

pub fn remove_plugin(connection: &Connection, id: &str) -> Result<(), HostError> {
    let affected = connection.execute("DELETE FROM plugins WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("plugin {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn connection() -> Connection {
        db::open_in_memory().unwrap()
    }

    #[test]
    fn registers_and_lists_projects() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();

        let project = add_project(&connection, directory.path().to_str().unwrap(), Some("Demo")).unwrap();
        let projects = list_projects(&connection).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, project.id);
        assert_eq!(projects[0].name, "Demo");
    }

    #[test]
    fn rejects_duplicate_project_path() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let path = directory.path().to_str().unwrap();

        add_project(&connection, path, None).unwrap();
        let error = add_project(&connection, path, None).unwrap_err();

        assert!(matches!(error, HostError::Conflict(_)));
    }

    #[test]
    fn rejects_missing_project_directory() {
        let connection = connection();
        let error = add_project(&connection, "/definitely/not/here", None).unwrap_err();
        assert!(matches!(error, HostError::InvalidParams(_)));
    }

    #[test]
    fn removing_project_cascades_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();
        create_session(&connection, &project.id, "First").unwrap();

        remove_project(&connection, &project.id).unwrap();

        assert!(list_sessions(&connection, None).unwrap().is_empty());
    }

    #[test]
    fn creates_and_renames_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();
        let session = create_session(&connection, &project.id, "  Draft  ").unwrap();

        assert_eq!(session.title, "Draft");

        let renamed = rename_session(&connection, &session.id, "Final").unwrap();
        assert_eq!(renamed.title, "Final");
        assert_eq!(renamed.created_at, session.created_at);
    }

    #[test]
    fn rejects_session_for_unknown_project() {
        let connection = connection();
        let error = create_session(&connection, "missing", "Draft").unwrap_err();
        assert!(matches!(error, HostError::NotFound(_)));
    }

    #[test]
    fn round_trips_settings() {
        let connection = connection();
        put_setting(&connection, "model.id", &json!("demo-model")).unwrap();
        put_setting(&connection, "model.id", &json!("next-model")).unwrap();

        let settings = list_settings(&connection).unwrap();
        assert_eq!(settings.len(), 1);
        assert_eq!(settings[0].0, "model.id");
        assert_eq!(settings[0].1, json!("next-model"));
    }

    #[test]
    fn tracks_plugin_enabled_state() {
        let connection = connection();
        upsert_plugin(&connection, "pictor.hello", "0.0.0", true, "bundled").unwrap();

        let record = set_plugin_enabled(&connection, "pictor.hello", false).unwrap();
        assert!(!record.enabled);

        let listed = list_plugins(&connection).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].enabled);
    }
}
