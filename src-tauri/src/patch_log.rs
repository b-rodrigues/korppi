// src-tauri/patch_log.rs
use std::path::PathBuf;
use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::ZipArchive;

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&path).ok();
    path.push("korppi_history.db");
    Ok(path)
}

fn get_conn(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Patch {
    pub id: i64,
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
    #[serde(default = "default_review_status")]
    pub review_status: String,
}

fn default_review_status() -> String {
    "pending".to_string()
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
                review_status: "pending".to_string(),
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
                review_status: "pending".to_string(),
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

/// Maximum allowed snapshot size (100 MB)
const MAX_SNAPSHOT_SIZE: usize = 100 * 1024 * 1024;

/// Save a Yjs state snapshot at a specific patch ID
#[tauri::command]
pub fn save_snapshot(app: AppHandle, patch_id: i64, state: Vec<u8>) -> Result<(), String> {
    // Validate input
    if state.is_empty() {
        return Err("Snapshot state cannot be empty".to_string());
    }
    if state.len() > MAX_SNAPSHOT_SIZE {
        return Err(format!("Snapshot size exceeds maximum allowed ({} bytes)", MAX_SNAPSHOT_SIZE));
    }

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

/// Import patches from an external KMD file into current document
#[tauri::command]
pub fn import_patches_from_document(
    source_path: String,
    target_doc_id: String,
    _app: AppHandle,
) -> Result<Vec<Patch>, String> {
    // Open the source KMD file
    let source_file = std::fs::File::open(&source_path)
        .map_err(|e| format!("Failed to open source file: {}", e))?;
    
    let mut archive = ZipArchive::new(source_file)
        .map_err(|e| format!("Failed to read KMD archive:{}", e))?;
    
    // Extract history.sqlite from the archive
    let mut history_file = archive
        .by_name("history.sqlite")
        .map_err(|e| format!("No history.sqlite in source KMD: {}", e))?;
    
    // Read the history database to a temp location
    let temp_dir = std::env::temp_dir();
    let temp_db_path = temp_dir.join(format!("import_history_{}.sqlite", Uuid::new_v4()));
    
    let mut temp_file = std::fs::File::create(&temp_db_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    
    std::io::copy(&mut history_file, &mut temp_file)
        .map_err(|e| format!("Failed to extract history: {}", e))?;
    
    drop(temp_file);
    drop(history_file);
    drop(archive);
    
    // Open the extracted database
    let source_conn = Connection::open(&temp_db_path)
        .map_err(|e| format!("Failed to open source history: {}", e))?;
    
    // Get all Save patches from source (ignore intermediate edits)
    let source_patches: Vec<(i64, i64, String, String, String)> = {
        let mut stmt = source_conn
            .prepare(
                "SELECT id, timestamp, author, kind, data
                 FROM patches
                 WHERE kind = 'Save'
                 ORDER BY timestamp ASC"
            )
            .map_err(|e| e.to_string())?;
        
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        
        // Collect before stmt is dropped
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    
    // Get snapshots for those patches
    let mut snapshot_map: HashMap<i64, Vec<u8>> = HashMap::new();
    for (patch_id, _, _, _, _) in &source_patches {
        let state: Option<Vec<u8>> = source_conn
            .query_row(
                "SELECT state FROM snapshots WHERE patch_id = ?1",
                [patch_id],
                |row| row.get(0)
            )
            .optional()
            .map_err(|e| e.to_string())?;
        
        if let Some(state) = state {
            snapshot_map.insert(*patch_id, state);
        }
    }
    
    drop(source_conn);
    
    // Clean up temp file
    std::fs::remove_file(&temp_db_path).ok();
    
    // Get target document's history database path
    // The history is stored in the temp directory for the document
    let temp_base = std::env::temp_dir().join("korppi-documents");
    let target_history_path = temp_base.join(&target_doc_id).join("history.sqlite");
    
    if !target_history_path.exists() {
        return Err(format!("Target document history not found at {:?}", target_history_path));
    }
    
    let target_conn = Connection::open(&target_history_path)
        .map_err(|e| e.to_string())?;
    
    // Import patches into target
    let mut imported_patches = Vec::new();
    
    for (source_patch_id, timestamp, author, kind, data_str) in source_patches {
        // Insert patch with 'pending' review status (imported patches need review)
        target_conn
            .execute(
                "INSERT INTO patches (timestamp, author, kind, data, review_status) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![timestamp, author, kind, data_str, "pending"],
            )
            .map_err(|e| e.to_string())?;
        
        let new_patch_id = target_conn.last_insert_rowid();
        
        // Insert snapshot if available
        if let Some(state) = snapshot_map.get(&source_patch_id) {
            target_conn
                .execute(
                    "INSERT INTO snapshots (timestamp, patch_id, state) VALUES (?1, ?2, ?3)",
                    params![timestamp, new_patch_id, state],
                )
                .map_err(|e| e.to_string())?;
        }
        
        // Parse data for return value
        let data: serde_json::Value = serde_json::from_str(&data_str)
            .unwrap_or(serde_json::Value::Null);
        
        imported_patches.push(Patch {
            id: new_patch_id,
            timestamp,
            author,
            kind,
            data,
            review_status: "pending".to_string(),
        });
    }
    
    Ok(imported_patches)
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
