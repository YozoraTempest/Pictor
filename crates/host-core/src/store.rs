use std::collections::{HashMap, HashSet};
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
    /// Custom section the project is filed under; `None` means the built-in
    /// "projects" section.
    pub section_id: Option<String>,
    /// Extra folders the agent may work in, beyond the primary `path`.
    pub folders: Vec<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub pi_session_id: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    /// Sections (user-defined tags) this session is filed under.
    pub section_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
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

fn load_folders(connection: &Connection) -> Result<HashMap<String, Vec<String>>, HostError> {
    let mut statement = connection.prepare(
        "SELECT project_id, path FROM project_folders ORDER BY project_id, position, path",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut folders: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (project_id, path) = row?;
        folders.entry(project_id).or_default().push(path);
    }
    Ok(folders)
}

fn load_session_sections(connection: &Connection) -> Result<HashMap<String, Vec<String>>, HostError> {
    let mut statement =
        connection.prepare("SELECT session_id, section_id FROM session_sections")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut sections: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (session_id, section_id) = row?;
        sections.entry(session_id).or_default().push(section_id);
    }
    Ok(sections)
}

pub fn list_projects(connection: &Connection) -> Result<Vec<Project>, HostError> {
    let mut folders = load_folders(connection)?;
    let mut statement = connection.prepare(
        "SELECT id, path, name, section_id, position, created_at, updated_at
         FROM projects ORDER BY position, name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            section_id: row.get(3)?,
            folders: Vec::new(),
            position: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    let mut projects = Vec::new();
    for row in rows {
        let mut project = row?;
        project.folders = folders.remove(&project.id).unwrap_or_default();
        projects.push(project);
    }
    Ok(projects)
}

pub fn add_project(
    connection: &Connection,
    path: &str,
    name: Option<&str>,
) -> Result<Project, HostError> {
    let canonical = canonical_directory(path, "project")?;
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
    let next_position: i64 =
        connection.query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM projects", [], |row| {
            row.get(0)
        })?;

    let project = Project {
        id: uuid::Uuid::new_v4().to_string(),
        path: canonical_path,
        name: resolved_name,
        section_id: None,
        folders: Vec::new(),
        position: next_position,
        created_at: now,
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project.id, project.path, project.name, project.created_at, project.updated_at],
    )?;

    Ok(project)
}

pub fn set_project_section(
    connection: &Connection,
    id: &str,
    section_id: Option<&str>,
) -> Result<Project, HostError> {
    if let Some(section_id) = section_id {
        let found: Option<String> = connection
            .query_row(
                "SELECT id FROM sections WHERE id = ?1",
                params![section_id],
                |row| row.get(0),
            )
            .optional()?;
        let builtin = matches!(section_id, "pinned" | "projects" | "recent");
        if found.is_none() && !builtin {
            return Err(HostError::NotFound(format!("section {section_id}")));
        }
    }

    let updated = connection.execute(
        "UPDATE projects SET section_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, section_id, now_millis()],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("project {id}")));
    }

    list_projects(connection)?
        .into_iter()
        .find(|project| project.id == id)
        .ok_or_else(|| HostError::NotFound(format!("project {id}")))
}

/// Applies a new order to custom sections; the index becomes the position.
pub fn reorder_sections(connection: &Connection, ids: &[String]) -> Result<Vec<Section>, HostError> {
    for (index, id) in ids.iter().enumerate() {
        connection.execute(
            "UPDATE sections SET position = ?2 WHERE id = ?1",
            params![id, index as i64],
        )?;
    }
    list_sections(connection)
}

pub fn remove_project(connection: &Connection, id: &str) -> Result<(), HostError> {
    let affected = connection.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("project {id}")));
    }
    Ok(())
}

fn canonical_directory(raw: &str, what: &str) -> Result<std::path::PathBuf, HostError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams(format!("{what} path must not be empty")));
    }

    let candidate = Path::new(trimmed);
    if !candidate.is_dir() {
        return Err(HostError::InvalidParams(format!(
            "{what} path is not a directory: {trimmed}"
        )));
    }

    Ok(candidate.canonicalize()?)
}

fn require_project(connection: &Connection, project_id: &str) -> Result<(), HostError> {
    let exists: Option<String> = connection
        .query_row("SELECT id FROM projects WHERE id = ?1", params![project_id], |row| {
            row.get(0)
        })
        .optional()?;
    if exists.is_none() {
        return Err(HostError::NotFound(format!("project {project_id}")));
    }
    Ok(())
}

pub fn list_project_folders(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<String>, HostError> {
    require_project(connection, project_id)?;
    let mut statement = connection.prepare(
        "SELECT path FROM project_folders WHERE project_id = ?1 ORDER BY position, path",
    )?;
    let rows = statement.query_map(params![project_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn add_project_folder(
    connection: &Connection,
    project_id: &str,
    path: &str,
) -> Result<Vec<String>, HostError> {
    require_project(connection, project_id)?;
    let canonical = canonical_directory(path, "folder")?;
    let canonical_path = canonical.to_string_lossy().to_string();

    let next_position: i64 = connection.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM project_folders WHERE project_id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    connection.execute(
        "INSERT INTO project_folders (project_id, path, position) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id, path) DO NOTHING",
        params![project_id, canonical_path, next_position],
    )?;

    list_project_folders(connection, project_id)
}

pub fn remove_project_folder(
    connection: &Connection,
    project_id: &str,
    path: &str,
) -> Result<Vec<String>, HostError> {
    require_project(connection, project_id)?;
    connection.execute(
        "DELETE FROM project_folders WHERE project_id = ?1 AND path = ?2",
        params![project_id, path],
    )?;
    list_project_folders(connection, project_id)
}

pub fn list_sections(connection: &Connection) -> Result<Vec<Section>, HostError> {
    let mut statement = connection.prepare(
        "SELECT id, name, position, created_at FROM sections ORDER BY position, name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Section {
            id: row.get(0)?,
            name: row.get(1)?,
            position: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create_section(connection: &Connection, name: &str) -> Result<Section, HostError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("section name must not be empty".into()));
    }

    let duplicate: Option<String> = connection
        .query_row("SELECT id FROM sections WHERE name = ?1", params![trimmed], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(id) = duplicate {
        return Err(HostError::Conflict(format!("section already exists: {id}")));
    }

    let next_position: i64 =
        connection.query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM sections", [], |row| {
            row.get(0)
        })?;

    let section = Section {
        id: uuid::Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        position: next_position,
        created_at: now_millis(),
    };

    connection.execute(
        "INSERT INTO sections (id, name, position, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![section.id, section.name, section.position, section.created_at],
    )?;

    Ok(section)
}

pub fn rename_section(connection: &Connection, id: &str, name: &str) -> Result<Section, HostError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("section name must not be empty".into()));
    }

    let duplicate: Option<String> = connection
        .query_row(
            "SELECT id FROM sections WHERE name = ?1 AND id <> ?2",
            params![trimmed, id],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some() {
        return Err(HostError::Conflict(format!("section name already used: {trimmed}")));
    }

    let affected = connection.execute(
        "UPDATE sections SET name = ?2 WHERE id = ?1",
        params![id, trimmed],
    )?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("section {id}")));
    }

    get_section(connection, id)?.ok_or_else(|| HostError::NotFound(format!("section {id}")))
}

fn get_section(connection: &Connection, id: &str) -> Result<Option<Section>, HostError> {
    let section = connection
        .query_row(
            "SELECT id, name, position, created_at FROM sections WHERE id = ?1",
            params![id],
            |row| {
                Ok(Section {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    position: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .optional()?;
    Ok(section)
}

pub fn remove_section(connection: &Connection, id: &str) -> Result<(), HostError> {
    let affected = connection.execute("DELETE FROM sections WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(HostError::NotFound(format!("section {id}")));
    }
    Ok(())
}

pub fn list_sessions(connection: &Connection, project_id: Option<&str>) -> Result<Vec<Session>, HostError> {
    let mut sections = load_session_sections(connection)?;
    let mut sessions = Vec::new();

    match project_id {
        Some(project_id) => {
            let mut statement = connection.prepare(
                "SELECT id, project_id, title, pi_session_id, pinned, archived, created_at, updated_at
                 FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map(params![project_id], map_session)?;
            for row in rows {
                let mut session = row?;
                session.section_ids = sections.remove(&session.id).unwrap_or_default();
                sessions.push(session);
            }
        }
        None => {
            let mut statement = connection.prepare(
                "SELECT id, project_id, title, pi_session_id, pinned, archived, created_at, updated_at
                 FROM sessions ORDER BY updated_at DESC",
            )?;
            let rows = statement.query_map([], map_session)?;
            for row in rows {
                let mut session = row?;
                session.section_ids = sections.remove(&session.id).unwrap_or_default();
                sessions.push(session);
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
        pinned: row.get::<_, i64>(4)? != 0,
        archived: row.get::<_, i64>(5)? != 0,
        section_ids: Vec::new(),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn create_session(
    connection: &Connection,
    project_id: Option<&str>,
    title: &str,
) -> Result<Session, HostError> {
    if let Some(project_id) = project_id {
        require_project(connection, project_id)?;
    }

    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(HostError::InvalidParams("session title must not be empty".into()));
    }

    let now = now_millis();
    let session = Session {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: project_id.map(str::to_string),
        title: trimmed.to_string(),
        pi_session_id: None,
        pinned: false,
        archived: false,
        section_ids: Vec::new(),
        created_at: now,
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO sessions (id, project_id, title, pi_session_id, pinned, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, 0, ?4, ?5)",
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
    let mut sections = load_session_sections(connection)?;
    let mut session = connection
        .query_row(
            "SELECT id, project_id, title, pi_session_id, pinned, archived, created_at, updated_at
             FROM sessions WHERE id = ?1",
            params![id],
            map_session,
        )
        .optional()?;

    if let Some(session) = session.as_mut() {
        session.section_ids = sections.remove(&session.id).unwrap_or_default();
    }

    Ok(session)
}

pub fn bind_pi_session(
    connection: &Connection,
    id: &str,
    pi_session_id: Option<&str>,
) -> Result<Session, HostError> {
    let updated = connection.execute(
        "UPDATE sessions SET pi_session_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, pi_session_id, now_millis()],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
}

pub fn set_session_pinned(
    connection: &Connection,
    id: &str,
    pinned: bool,
) -> Result<Session, HostError> {
    let updated = connection.execute(
        "UPDATE sessions SET pinned = ?2 WHERE id = ?1",
        params![id, i64::from(pinned)],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
}

pub fn set_session_archived(
    connection: &Connection,
    id: &str,
    archived: bool,
) -> Result<Session, HostError> {
    let updated = connection.execute(
        "UPDATE sessions SET archived = ?2 WHERE id = ?1",
        params![id, i64::from(archived)],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
}

/// Archives every session in `ids`; used by "archive this section".
pub fn archive_sessions(connection: &Connection, ids: &[String]) -> Result<usize, HostError> {
    let mut archived = 0;
    for id in ids {
        archived += connection.execute(
            "UPDATE sessions SET archived = 1 WHERE id = ?1",
            params![id],
        )?;
    }
    Ok(archived)
}

pub fn set_session_project(
    connection: &Connection,
    id: &str,
    project_id: Option<&str>,
) -> Result<Session, HostError> {
    if let Some(project_id) = project_id {
        require_project(connection, project_id)?;
    }

    let updated = connection.execute(
        "UPDATE sessions SET project_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, project_id, now_millis()],
    )?;
    if updated == 0 {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
}

pub fn set_session_sections(
    connection: &Connection,
    id: &str,
    section_ids: &[String],
) -> Result<Session, HostError> {
    let exists: Option<String> = connection
        .query_row("SELECT id FROM sessions WHERE id = ?1", params![id], |row| row.get(0))
        .optional()?;
    if exists.is_none() {
        return Err(HostError::NotFound(format!("session {id}")));
    }

    let unique: HashSet<&String> = section_ids.iter().collect();
    for section_id in &unique {
        let found: Option<String> = connection
            .query_row(
                "SELECT id FROM sections WHERE id = ?1",
                params![section_id],
                |row| row.get(0),
            )
            .optional()?;
        if found.is_none() {
            return Err(HostError::NotFound(format!("section {section_id}")));
        }
    }

    connection.execute("DELETE FROM session_sections WHERE session_id = ?1", params![id])?;
    for section_id in unique {
        connection.execute(
            "INSERT INTO session_sections (session_id, section_id) VALUES (?1, ?2)",
            params![id, section_id],
        )?;
    }

    get_session(connection, id)?.ok_or_else(|| HostError::NotFound(format!("session {id}")))
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
        assert!(projects[0].folders.is_empty());
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
    fn adds_and_removes_project_folders() {
        let directory = tempfile::tempdir().unwrap();
        let extra = directory.path().join("extra");
        std::fs::create_dir(&extra).unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();

        let folders = add_project_folder(&connection, &project.id, extra.to_str().unwrap()).unwrap();
        assert_eq!(folders.len(), 1);

        // Adding the same folder twice must not duplicate the row.
        let folders = add_project_folder(&connection, &project.id, extra.to_str().unwrap()).unwrap();
        assert_eq!(folders.len(), 1);

        let listed = list_projects(&connection).unwrap();
        assert_eq!(listed[0].folders.len(), 1);

        let folders = remove_project_folder(&connection, &project.id, &folders[0]).unwrap();
        assert!(folders.is_empty());
    }

    #[test]
    fn removing_project_cascades_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();
        create_session(&connection, Some(&project.id), "First").unwrap();

        remove_project(&connection, &project.id).unwrap();

        assert!(list_sessions(&connection, None).unwrap().is_empty());
    }

    #[test]
    fn creates_and_renames_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();
        let session = create_session(&connection, Some(&project.id), "  Draft  ").unwrap();

        assert_eq!(session.title, "Draft");

        let renamed = rename_session(&connection, &session.id, "Final").unwrap();
        assert_eq!(renamed.title, "Final");
        assert_eq!(renamed.created_at, session.created_at);
    }

    #[test]
    fn sessions_can_live_outside_a_project() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();

        assert_eq!(session.project_id, None);

        let listed = list_sessions(&connection, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].project_id, None);
    }

    #[test]
    fn moves_a_session_between_projects() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let connection = connection();
        let project_a = add_project(&connection, first.path().to_str().unwrap(), Some("A")).unwrap();
        let project_b = add_project(&connection, second.path().to_str().unwrap(), Some("B")).unwrap();
        let session = create_session(&connection, Some(&project_a.id), "Draft").unwrap();

        let moved = set_session_project(&connection, &session.id, Some(&project_b.id)).unwrap();
        assert_eq!(moved.project_id.as_deref(), Some(project_b.id.as_str()));

        let detached = set_session_project(&connection, &session.id, None).unwrap();
        assert_eq!(detached.project_id, None);
    }

    #[test]
    fn pins_and_unpins_a_session() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();
        assert!(!session.pinned);

        let pinned = set_session_pinned(&connection, &session.id, true).unwrap();
        assert!(pinned.pinned);

        let unpinned = set_session_pinned(&connection, &session.id, false).unwrap();
        assert!(!unpinned.pinned);
    }

    #[test]
    fn files_a_session_under_multiple_sections() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();
        let design = create_section(&connection, "Design").unwrap();
        let research = create_section(&connection, "Research").unwrap();

        let updated = set_session_sections(
            &connection,
            &session.id,
            &[design.id.clone(), research.id.clone(), design.id.clone()],
        )
        .unwrap();
        assert_eq!(updated.section_ids.len(), 2);

        let listed = list_sessions(&connection, None).unwrap();
        assert_eq!(listed[0].section_ids.len(), 2);

        let cleared = set_session_sections(&connection, &session.id, &[]).unwrap();
        assert!(cleared.section_ids.is_empty());
    }

    #[test]
    fn removes_sections_and_their_links() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();
        let section = create_section(&connection, "Design").unwrap();
        set_session_sections(&connection, &session.id, &[section.id.clone()]).unwrap();

        remove_section(&connection, &section.id).unwrap();

        let listed = list_sessions(&connection, None).unwrap();
        assert!(listed[0].section_ids.is_empty());
    }

    #[test]
    fn rejects_duplicate_section_names() {
        let connection = connection();
        create_section(&connection, "Design").unwrap();
        let error = create_section(&connection, "  Design  ").unwrap_err();
        assert!(matches!(error, HostError::Conflict(_)));
    }

    #[test]
    fn rejects_unknown_section_when_filing_a_session() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();
        let error = set_session_sections(&connection, &session.id, &["missing".to_string()]).unwrap_err();
        assert!(matches!(error, HostError::NotFound(_)));
    }

    #[test]
    fn archives_and_restores_sessions() {
        let connection = connection();
        let session = create_session(&connection, None, "Loose").unwrap();
        assert!(!session.archived);

        let archived = set_session_archived(&connection, &session.id, true).unwrap();
        assert!(archived.archived);

        let restored = set_session_archived(&connection, &session.id, false).unwrap();
        assert!(!restored.archived);
    }

    #[test]
    fn archives_many_sessions_at_once() {
        let connection = connection();
        let first = create_session(&connection, None, "One").unwrap();
        let second = create_session(&connection, None, "Two").unwrap();

        let count = archive_sessions(&connection, &[first.id.clone(), second.id.clone()]).unwrap();
        assert_eq!(count, 2);

        let listed = list_sessions(&connection, None).unwrap();
        assert!(listed.iter().all(|entry| entry.archived));
    }

    #[test]
    fn binds_a_pi_session_path() {
        let directory = tempfile::tempdir().unwrap();
        let connection = connection();
        let project = add_project(&connection, directory.path().to_str().unwrap(), None).unwrap();
        let session = create_session(&connection, Some(&project.id), "Draft").unwrap();

        let bound = bind_pi_session(&connection, &session.id, Some("/tmp/pi/session.jsonl")).unwrap();
        assert_eq!(bound.pi_session_id.as_deref(), Some("/tmp/pi/session.jsonl"));

        let cleared = bind_pi_session(&connection, &session.id, None).unwrap();
        assert_eq!(cleared.pi_session_id, None);
    }

    #[test]
    fn rejects_session_for_unknown_project() {
        let connection = connection();
        let error = create_session(&connection, Some("missing"), "Draft").unwrap_err();
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
