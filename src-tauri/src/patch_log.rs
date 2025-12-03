// src-tauri/patch_log.rs
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

fn db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
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

        CREATE TABLE IF NOT EXISTS snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            patch_id    INTEGER NOT NULL,
            state       BLOB    NOT NULL,
            FOREIGN KEY (patch_id) REFERENCES patches(id)
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_patch_id ON snapshots(patch_id);
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

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: i64,
    pub timestamp: i64,
    pub patch_id: i64,
    pub state: Vec<u8>,
}

/// Save a Yjs state snapshot at a specific patch ID
#[tauri::command]
pub fn save_snapshot(app: AppHandle, patch_id: i64, state: Vec<u8>) -> Result<(), String> {
    let conn = get_conn(&app)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "INSERT INTO snapshots (timestamp, patch_id, state) VALUES (?1, ?2, ?3)",
        params![timestamp, patch_id, state],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get the nearest snapshot before or at a given patch ID
#[tauri::command]
pub fn get_snapshot_for_patch(app: AppHandle, patch_id: i64) -> Result<Option<Snapshot>, String> {
    let conn = get_conn(&app)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, patch_id, state FROM snapshots
             WHERE patch_id <= ?1
             ORDER BY patch_id DESC
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let snapshot = stmt
        .query_row([patch_id], |row| {
            Ok(Snapshot {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                patch_id: row.get(2)?,
                state: row.get(3)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(snapshot)
}

/// Result of a restore operation
#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreResult {
    pub snapshot_content: Option<String>,
    pub patch_id: i64,
}

/// Restore to a specific patch - returns the snapshot content (text) for that patch
/// This uses the text snapshot stored in the patch data if available
#[tauri::command]
pub fn restore_to_patch(app: AppHandle, patch_id: i64) -> Result<RestoreResult, String> {
    let conn = get_conn(&app)?;

    // First, try to get the patch to extract the snapshot field from data
    let mut stmt = conn
        .prepare("SELECT data FROM patches WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let data_str: Option<String> = stmt
        .query_row([patch_id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(data_str) = data_str {
        // Parse the JSON data and extract the snapshot field if present
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&data_str) {
            if let Some(snapshot) = data.get("snapshot").and_then(|s| s.as_str()) {
                return Ok(RestoreResult {
                    snapshot_content: Some(snapshot.to_string()),
                    patch_id,
                });
            }
        }
    }

    // No snapshot content available
    Ok(RestoreResult {
        snapshot_content: None,
        patch_id,
    })
}
