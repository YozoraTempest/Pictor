use std::path::Path;

use rusqlite::Connection;

use crate::error::HostError;

/// Current on-disk schema version. Bump when `SCHEMA_V1` changes shape and add a
/// forward migration step in `migrate`.
pub const SCHEMA_VERSION: i64 = 6;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    path        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    pi_session_id TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_project ON sessions(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS plugins (
    id           TEXT PRIMARY KEY,
    version      TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    source       TEXT NOT NULL,
    installed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

/// v2 makes a session's project optional, adds pinning, project folders and
/// sections (user-defined tags a session can be filed under).
const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS project_folders (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, path)
);

CREATE TABLE IF NOT EXISTS sections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE sessions_v2 (
    id            TEXT PRIMARY KEY,
    project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    pi_session_id TEXT,
    pinned        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

INSERT INTO sessions_v2 (id, project_id, title, pi_session_id, pinned, created_at, updated_at)
    SELECT id, project_id, title, pi_session_id, 0, created_at, updated_at FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_v2 RENAME TO sessions;

CREATE INDEX IF NOT EXISTS sessions_by_project ON sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_by_updated ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS session_sections (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, section_id)
);

CREATE INDEX IF NOT EXISTS session_sections_by_section ON session_sections(section_id);
"#;

/// v3 adds archiving, so a session can be hidden from the working list without
/// being deleted.
const SCHEMA_V3: &str = r#"
ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
"#;

/// v4 lets a project live inside a custom section instead of the default
/// "projects" section.
const SCHEMA_V4: &str = r#"
ALTER TABLE projects ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
"#;

/// v5 gives sessions a manual position so the sidebar can be reordered by hand.
const SCHEMA_V5: &str = r#"
ALTER TABLE sessions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
"#;

/// v6 remembers which conversation a branch was copied from.
///
/// `SET NULL` on delete: removing the parent must not take the branches with it,
/// they are conversations in their own right.
const SCHEMA_V6: &str = r#"
ALTER TABLE sessions ADD COLUMN parent_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
"#;

pub fn open(path: &Path) -> Result<Connection, HostError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&connection)?;
    Ok(connection)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection, HostError> {
    let connection = Connection::open_in_memory()?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), HostError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if version > SCHEMA_VERSION {
        return Err(HostError::Internal(format!(
            "database schema {version} is newer than supported {SCHEMA_VERSION}"
        )));
    }

    if version < 1 {
        connection.execute_batch(SCHEMA_V1)?;
    }

    if version < 2 {
        // Rebuilding `sessions` drops and recreates a table other rows point at;
        // foreign keys are disabled for the duration so nothing cascades away.
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        let result = connection.execute_batch(&format!("BEGIN;\n{SCHEMA_V2}\nCOMMIT;"));
        connection.pragma_update(None, "foreign_keys", "ON")?;
        result?;
    }

    if version < 3 {
        connection.execute_batch(SCHEMA_V3)?;
    }

    if version < 4 {
        connection.execute_batch(SCHEMA_V4)?;
    }

    if version < 5 {
        connection.execute_batch(SCHEMA_V5)?;
    }

    if version < 6 {
        connection.execute_batch(SCHEMA_V6)?;
    }

    connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_current_version() {
        let connection = open_in_memory().unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn migration_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join("pictor.sqlite3");

        let first = open(&path).unwrap();
        drop(first);

        let second = open(&path).unwrap();
        let version: i64 = second
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn rejects_newer_schema() {
        let connection = open_in_memory().unwrap();
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();

        let error = migrate(&connection).unwrap_err();
        assert!(matches!(error, HostError::Internal(_)));
    }

    #[test]
    fn upgrades_a_v1_database_without_losing_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.sqlite3");

        {
            let legacy = Connection::open(&path).unwrap();
            legacy.pragma_update(None, "foreign_keys", "ON").unwrap();
            legacy.execute_batch(SCHEMA_V1).unwrap();
            legacy
                .execute_batch(
                    "INSERT INTO projects (id, path, name, created_at, updated_at)
                        VALUES ('p1', '/tmp/p1', 'Legacy', 1, 1);
                     INSERT INTO sessions (id, project_id, title, pi_session_id, created_at, updated_at)
                        VALUES ('s1', 'p1', 'Old chat', NULL, 1, 1);",
                )
                .unwrap();
            legacy.pragma_update(None, "user_version", 1).unwrap();
        }

        let upgraded = open(&path).unwrap();
        let (project_id, title, pinned): (Option<String>, String, i64) = upgraded
            .query_row(
                "SELECT project_id, title, pinned FROM sessions WHERE id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(project_id.as_deref(), Some("p1"));
        assert_eq!(title, "Old chat");
        assert_eq!(pinned, 0);

        let version: i64 = upgraded
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }
}
