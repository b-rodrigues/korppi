// src-tauri/patch_log.rs
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path_resolver().app_data_dir().unwrap();
    std::fs::create_dir_all(&path).ok();
    path.push("korppi_history.db");
    path
}

fn get_conn(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app);
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchInput {
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Patch {
    pub id: i64,
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
}

#[tauri::command]
pub fn record_patch(app: AppHandle, patch: PatchInput) -> Result<(), String> {
    let conn = get_conn(&app)?;
    let data_str =
        serde_json::to_string(&patch.data).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data)
         VALUES (?1, ?2, ?3, ?4)",
        params![patch.timestamp, patch.author, patch.kind, data_str],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_patches(app: AppHandle) -> Result<Vec<Patch>, String> {
    let conn = get_conn(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, author, kind, data
             FROM patches
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let data_str: String = row.get(4)?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);

            Ok(Patch {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                author: row.get(2)?,
                kind: row.get(3)?,
                data,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut patches = Vec::new();
    for row in rows {
        patches.push(row.map_err(|e| e.to_string())?);
    }

    Ok(patches)
}

#[tauri::command]
pub fn get_patch(app: AppHandle, id: i64) -> Result<Patch, String> {
    let conn = get_conn(&app)?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp, author, kind, data FROM patches WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let patch = stmt
        .query_row([id], |row| {
            let data_str: String = row.get(4)?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);

            Ok(Patch {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                author: row.get(2)?,
                kind: row.get(3)?,
                data,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(patch)
}
