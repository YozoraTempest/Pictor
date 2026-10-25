mod ccswitch;
mod db;
mod error;
mod rpc;
mod store;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{json, Map, Value};

use crate::error::HostError;
use crate::rpc::{parse_request, Response};

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let options = match Options::parse(std::env::args().skip(1)) {
        Ok(Some(options)) => options,
        Ok(None) => return,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    let connection = match db::open(&options.database) {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("pictor-host-core: cannot open database: {error}");
            std::process::exit(1);
        }
    };

    if let Err(error) = serve(&connection, &options.database) {
        eprintln!("pictor-host-core: {error}");
        std::process::exit(1);
    }
}

struct Options {
    database: PathBuf,
}

impl Options {
    fn parse(args: impl Iterator<Item = String>) -> Result<Option<Self>, String> {
        let mut database: Option<PathBuf> = None;
        let mut args = args.peekable();

        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--database" => {
                    let value = args.next().ok_or("--database requires a path")?;
                    database = Some(PathBuf::from(value));
                }
                "--version" => {
                    println!("pictor-host-core {VERSION}");
                    return Ok(None);
                }
                "--help" => {
                    println!(
                        "pictor-host-core {VERSION}\n\n\
                         Usage: pictor-host-core --database <path>\n\n\
                         Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout.\n\
                         Logs go to stderr only."
                    );
                    return Ok(None);
                }
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        let database = database
            .or_else(|| std::env::var_os("PICTOR_DATABASE").map(PathBuf::from))
            .unwrap_or_else(default_database_path);

        Ok(Some(Self { database }))
    }
}

fn default_database_path() -> PathBuf {
    if let Some(root) = std::env::var_os("PICTOR_DATA_DIR") {
        return PathBuf::from(root).join("metadata.sqlite3");
    }

    #[cfg(windows)]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            return PathBuf::from(app_data).join("pictor").join("metadata.sqlite3");
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("pictor")
            .join("metadata.sqlite3");
    }

    PathBuf::from("metadata.sqlite3")
}

fn serve(connection: &Connection, database: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match parse_request(&line) {
            Ok(request) => {
                let id = request.id.unwrap_or(Value::Null);
                match dispatch(connection, database, &request.method, request.params) {
                    Ok(result) => Response::success(id, result),
                    Err(error) => Response::failure(id, &error),
                }
            }
            Err(error) => Response::failure(Value::Null, &error),
        };

        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }

    Ok(())
}

fn dispatch(
    connection: &Connection,
    database: &Path,
    method: &str,
    params: Value,
) -> Result<Value, HostError> {
    match method {
        "system.ping" => Ok(json!({ "ok": true })),
        "system.info" => Ok(json!({
            "version": VERSION,
            "schemaVersion": db::SCHEMA_VERSION,
            "database": database.to_string_lossy(),
        })),
        "project.list" => Ok(serde_json::to_value(store::list_projects(connection)?)
            .map_err(to_internal)?),
        "project.add" => {
            let path = required_str(&params, "path")?;
            let name = optional_str(&params, "name");
            Ok(serde_json::to_value(store::add_project(
                connection,
                &path,
                name.as_deref(),
            )?)
            .map_err(to_internal)?)
        }
        "project.remove" => {
            let id = required_str(&params, "id")?;
            store::remove_project(connection, &id)?;
            Ok(json!({ "removed": id }))
        }
        "session.list" => {
            let project_id = optional_str(&params, "projectId");
            Ok(serde_json::to_value(store::list_sessions(
                connection,
                project_id.as_deref(),
            )?)
            .map_err(to_internal)?)
        }
        "session.create" => {
            let project_id = optional_str(&params, "projectId");
            let title = required_str(&params, "title")?;
            // Only branches name a parent; a plain conversation starts at the root.
            let parent_id = optional_str(&params, "parentId");
            // The kernel is chosen when the conversation is created: switching one
            // later is a branch on the target kernel, not a field to edit.
            let kernel_id = optional_str(&params, "kernelId").unwrap_or_else(|| "dsh".to_string());
            Ok(serde_json::to_value(store::create_session(
                connection,
                project_id.as_deref(),
                &title,
                parent_id.as_deref(),
                &kernel_id,
            )?)
            .map_err(to_internal)?)
        }
        "session.rename" => {
            let id = required_str(&params, "id")?;
            let title = required_str(&params, "title")?;
            Ok(serde_json::to_value(store::rename_session(connection, &id, &title)?)
                .map_err(to_internal)?)
        }
        "session.delete" => {
            let id = required_str(&params, "id")?;
            store::delete_session(connection, &id)?;
            Ok(json!({ "deleted": id }))
        }
        "session.setPinned" => {
            let id = required_str(&params, "id")?;
            let pinned = params
                .get("pinned")
                .and_then(Value::as_bool)
                .ok_or_else(|| HostError::InvalidParams("missing param: pinned".into()))?;
            Ok(serde_json::to_value(store::set_session_pinned(
                connection, &id, pinned,
            )?)
            .map_err(to_internal)?)
        }
        "session.setProject" => {
            let id = required_str(&params, "id")?;
            let project_id = optional_str(&params, "projectId");
            Ok(serde_json::to_value(store::set_session_project(
                connection,
                &id,
                project_id.as_deref(),
            )?)
            .map_err(to_internal)?)
        }
        "session.setSections" => {
            let id = required_str(&params, "id")?;
            let section_ids: Vec<String> = params
                .get("sectionIds")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            Ok(serde_json::to_value(store::set_session_sections(
                connection,
                &id,
                &section_ids,
            )?)
            .map_err(to_internal)?)
        }
        "project.setSection" => {
            let id = required_str(&params, "id")?;
            let section_id = optional_str(&params, "sectionId");
            Ok(serde_json::to_value(store::set_project_section(
                connection,
                &id,
                section_id.as_deref(),
            )?)
            .map_err(to_internal)?)
        }
        "session.setArchived" => {
            let id = required_str(&params, "id")?;
            let archived = params
                .get("archived")
                .and_then(Value::as_bool)
                .ok_or_else(|| HostError::InvalidParams("missing param: archived".into()))?;
            Ok(serde_json::to_value(store::set_session_archived(
                connection, &id, archived,
            )?)
            .map_err(to_internal)?)
        }
        "session.reorder" => {
            let ids: Vec<String> = params
                .get("ids")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let reordered = store::reorder_sessions(connection, &ids)?;
            Ok(json!({ "reordered": reordered }))
        }
        "session.archiveMany" => {
            let ids: Vec<String> = params
                .get("ids")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let archived = store::archive_sessions(connection, &ids)?;
            Ok(json!({ "archived": archived }))
        }
        "section.list" => {
            Ok(serde_json::to_value(store::list_sections(connection)?).map_err(to_internal)?)
        }
        "section.create" => {
            let name = required_str(&params, "name")?;
            Ok(serde_json::to_value(store::create_section(connection, &name)?)
                .map_err(to_internal)?)
        }
        "section.rename" => {
            let id = required_str(&params, "id")?;
            let name = required_str(&params, "name")?;
            Ok(serde_json::to_value(store::rename_section(connection, &id, &name)?)
                .map_err(to_internal)?)
        }
        "section.reorder" => {
            let ids: Vec<String> = params
                .get("ids")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            Ok(serde_json::to_value(store::reorder_sections(connection, &ids)?)
                .map_err(to_internal)?)
        }
        "section.remove" => {
            let id = required_str(&params, "id")?;
            store::remove_section(connection, &id)?;
            Ok(json!({ "removed": id }))
        }
        "project.folders" => {
            let id = required_str(&params, "id")?;
            Ok(serde_json::to_value(store::list_project_folders(connection, &id)?)
                .map_err(to_internal)?)
        }
        "project.addFolder" => {
            let id = required_str(&params, "id")?;
            let path = required_str(&params, "path")?;
            Ok(serde_json::to_value(store::add_project_folder(
                connection, &id, &path,
            )?)
            .map_err(to_internal)?)
        }
        "project.removeFolder" => {
            let id = required_str(&params, "id")?;
            let path = required_str(&params, "path")?;
            Ok(serde_json::to_value(store::remove_project_folder(
                connection, &id, &path,
            )?)
            .map_err(to_internal)?)
        }
        "settings.list" => {
            let settings: Map<String, Value> = store::list_settings(connection)?
                .into_iter()
                .collect();
            Ok(Value::Object(settings))
        }
        "settings.put" => {
            let key = required_str(&params, "key")?;
            let value = params
                .get("value")
                .cloned()
                .ok_or_else(|| HostError::InvalidParams("missing param: value".into()))?;
            store::put_setting(connection, &key, &value)?;
            Ok(json!({ "key": key, "value": value }))
        }
        "plugin.list" => {
            Ok(serde_json::to_value(store::list_plugins(connection)?).map_err(to_internal)?)
        }
        "plugin.upsert" => {
            let id = required_str(&params, "id")?;
            let version = required_str(&params, "version")?;
            let source = optional_str(&params, "source").unwrap_or_else(|| "user".to_string());
            let enabled = params
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            Ok(serde_json::to_value(store::upsert_plugin(
                connection,
                &id,
                &version,
                enabled,
                &source,
            )?)
            .map_err(to_internal)?)
        }
        "plugin.setEnabled" => {
            let id = required_str(&params, "id")?;
            let enabled = params
                .get("enabled")
                .and_then(Value::as_bool)
                .ok_or_else(|| HostError::InvalidParams("missing param: enabled".into()))?;
            Ok(serde_json::to_value(store::set_plugin_enabled(
                connection, &id, enabled,
            )?)
            .map_err(to_internal)?)
        }
        "ccswitch.scan" => {
            let path = required_str(&params, "path")?;
            Ok(serde_json::to_value(ccswitch::scan(&path)?).map_err(to_internal)?)
        }
        "ccswitch.read" => {
            let path = required_str(&params, "path")?;
            let id = required_str(&params, "id")?;
            Ok(serde_json::to_value(ccswitch::read(&path, &id)?).map_err(to_internal)?)
        }
        "plugin.remove" => {
            let id = required_str(&params, "id")?;
            store::remove_plugin(connection, &id)?;
            Ok(json!({ "removed": id }))
        }
        other => Err(HostError::NotFound(format!("method {other}"))),
    }
}

fn to_internal(error: serde_json::Error) -> HostError {
    HostError::Internal(format!("cannot encode response: {error}"))
}

fn required_str(params: &Value, key: &str) -> Result<String, HostError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| HostError::InvalidParams(format!("missing param: {key}")))
}

fn optional_str(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(Value::as_str).map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, Connection, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("metadata.sqlite3");
        let connection = db::open(&database).unwrap();
        (directory, connection, database)
    }

    #[test]
    fn responds_to_ping() {
        let (_directory, connection, database) = fixture();
        let result = dispatch(&connection, &database, "system.ping", json!({})).unwrap();
        assert_eq!(result, json!({ "ok": true }));
    }

    #[test]
    fn exposes_system_info() {
        let (_directory, connection, database) = fixture();
        let result = dispatch(&connection, &database, "system.info", json!({})).unwrap();
        assert_eq!(result["schemaVersion"], json!(db::SCHEMA_VERSION));
    }

    #[test]
    fn rejects_unknown_method() {
        let (_directory, connection, database) = fixture();
        let error = dispatch(&connection, &database, "system.nope", json!({})).unwrap_err();
        assert!(matches!(error, HostError::NotFound(_)));
    }

    #[test]
    fn requires_declared_params() {
        let (_directory, connection, database) = fixture();
        let error = dispatch(&connection, &database, "project.add", json!({})).unwrap_err();
        assert!(matches!(error, HostError::InvalidParams(_)));
    }

    #[test]
    fn project_lifecycle_round_trip() {
        let (directory, connection, database) = fixture();
        let project_dir = directory.path().join("workspace");
        std::fs::create_dir(&project_dir).unwrap();

        let project = dispatch(
            &connection,
            &database,
            "project.add",
            json!({ "path": project_dir.to_string_lossy(), "name": "Demo" }),
        )
        .unwrap();
        let project_id = project["id"].as_str().unwrap().to_string();

        let sessions = dispatch(
            &connection,
            &database,
            "session.create",
            json!({ "projectId": project_id, "title": "First" }),
        )
        .unwrap();
        assert_eq!(sessions["title"], json!("First"));

        let listed = dispatch(&connection, &database, "session.list", json!({})).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);

        dispatch(
            &connection,
            &database,
            "project.remove",
            json!({ "id": project_id }),
        )
        .unwrap();
        let listed = dispatch(&connection, &database, "session.list", json!({})).unwrap();
        assert!(listed.as_array().unwrap().is_empty());
    }

    #[test]
    fn settings_and_plugins_are_persisted() {
        let (_directory, connection, database) = fixture();

        dispatch(
            &connection,
            &database,
            "settings.put",
            json!({ "key": "model.id", "value": "demo" }),
        )
        .unwrap();
        let settings = dispatch(&connection, &database, "settings.list", json!({})).unwrap();
        assert_eq!(settings["model.id"], json!("demo"));

        dispatch(
            &connection,
            &database,
            "plugin.upsert",
            json!({ "id": "pictor.hello", "version": "0.0.0", "source": "bundled" }),
        )
        .unwrap();
        let plugins = dispatch(&connection, &database, "plugin.list", json!({})).unwrap();
        assert_eq!(plugins.as_array().unwrap().len(), 1);
        assert_eq!(plugins[0]["enabled"], json!(true));
    }
}
