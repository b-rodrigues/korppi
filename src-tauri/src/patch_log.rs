// src-tauri/patch_log.rs
use std::path::PathBuf;
use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::ZipArchive;

use crate::comments::{Comment, init_comments_table};
use crate::db_utils::ensure_schema;

/// Generate a deterministic patch UID from content
/// Uses SHA256 hash of author + timestamp + snapshot content
/// Returns first 16 hex characters for brevity
pub fn generate_patch_uid(author: &str, timestamp: i64, data: &serde_json::Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(author.as_bytes());
    hasher.update(b"|");
    hasher.update(timestamp.to_string().as_bytes());
    hasher.update(b"|");
    
    // Include snapshot content if present for more accurate deduplication
    if let Some(snapshot) = data.get("snapshot").and_then(|s| s.as_str()) {
        hasher.update(snapshot.as_bytes());
    } else {
        // Fallback to full data JSON for non-snapshot patches
        if let Ok(data_str) = serde_json::to_string(data) {
            hasher.update(data_str.as_bytes());
        }
    }
    
    let hash = hasher.finalize();
    // Return first 16 hex characters
    format!("{:x}", hash)[..16].to_string()
}

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

    // Use shared schema definition
    ensure_schema(&conn)?;

    Ok(conn)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchInput {
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
    pub uuid: Option<String>,
    pub parent_uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Patch {
    pub id: i64,
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub parent_uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PatchReview {
    pub patch_uuid: String,
    pub reviewer_id: String,
    pub decision: String, // "accepted" or "rejected"
    pub reviewer_name: Option<String>,
    pub reviewed_at: i64,
}

#[tauri::command]
pub fn record_patch(app: AppHandle, patch: PatchInput, parent_uuid: Option<String>) -> Result<String, String> {
    let conn = get_conn(&app)?;
    let data_str =
        serde_json::to_string(&patch.data).map_err(|e| e.to_string())?;

    // Use provided UUID or generate new one
    let patch_uuid = patch.uuid.clone().unwrap_or_else(|| Uuid::new_v4().to_string());

    // Use provided parent_uuid (from struct) or argument fallback
    let actual_parent = patch.parent_uuid.or(parent_uuid);

    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![patch.timestamp, patch.author, patch.kind, data_str, patch_uuid, actual_parent],
    )
    .map_err(|e| e.to_string())?;

    Ok(patch_uuid)
}

#[tauri::command]
pub fn list_patches(app: AppHandle) -> Result<Vec<Patch>, String> {
    let conn = get_conn(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, author, kind, data, uuid, parent_uuid
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
                uuid: row.get(5).ok(),
                parent_uuid: row.get(6).ok(),
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
        .prepare("SELECT id, timestamp, author, kind, data, uuid, parent_uuid FROM patches WHERE id = ?1")
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
                uuid: row.get(5).ok(),
                parent_uuid: row.get(6).ok(),
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
    let source_patches: Vec<(i64, i64, String, String, String, Option<String>, Option<String>)> = {
        // First try with uuid and parent_uuid columns
        let query = "SELECT id, timestamp, author, kind, data, uuid, parent_uuid FROM patches WHERE kind = 'Save' ORDER BY timestamp ASC";
        let query_fallback = "SELECT id, timestamp, author, kind, data, NULL as uuid, NULL as parent_uuid FROM patches WHERE kind = 'Save' ORDER BY timestamp ASC";

        let mut stmt = source_conn
            .prepare(query)
            .or_else(|_| source_conn.prepare(query_fallback))
            .map_err(|e| e.to_string())?;
        
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5).ok(),
                    row.get(6).ok(),
                ))
            })
            .map_err(|e| e.to_string())?;
        
        // Collect before stmt is dropped
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    
    // Get snapshots for those patches
    let mut snapshot_map: HashMap<i64, Vec<u8>> = HashMap::new();
    for (patch_id, _, _, _, _, _, _) in &source_patches {
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
    
    // Get target document's history database path
    let temp_base = std::env::temp_dir().join("korppi-documents");
    let target_history_path = temp_base.join(&target_doc_id).join("history.sqlite");
    
    if !target_history_path.exists() {
        return Err(format!("Target document history not found at {:?}", target_history_path));
    }
    
    let target_conn = Connection::open(&target_history_path)
        .map_err(|e| e.to_string())?;
    
    // Use shared schema definition
    ensure_schema(&target_conn)?;
    
    // Import patches into target, deduplicating by UUID
    let mut imported_patches = Vec::new();
    
    for (source_patch_id, timestamp, author, kind, data_str, source_uuid, parent_uuid) in source_patches {
        // Parse data
        let data: serde_json::Value = serde_json::from_str(&data_str)
            .unwrap_or(serde_json::Value::Null);
        
        // Use existing UUID or generate a new one
        let patch_uuid = source_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());
        
        // Check if this patch already exists by UUID
        let exists: bool = target_conn
            .query_row(
                "SELECT 1 FROM patches WHERE uuid = ?1",
                params![&patch_uuid],
                |_| Ok(true)
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        
        if exists {
            // Patch already exists, skip insert but import reviews below
            continue;
        }
        
        // Insert new patch
        target_conn
            .execute(
                "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![timestamp, &author, &kind, &data_str, &patch_uuid, parent_uuid],
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
        
        imported_patches.push(Patch {
            id: new_patch_id,
            timestamp,
            author,
            kind,
            data,
            uuid: Some(patch_uuid),
            parent_uuid,
        });
    }
    
    // Import reviews from source to target
    import_reviews(&source_conn, &target_conn)?;

    // Import comments
    import_comments(&source_conn, &target_conn)?;

    // Clean up
    drop(source_conn);
    std::fs::remove_file(&temp_db_path).ok();

    Ok(imported_patches)
}

fn import_reviews(source_conn: &Connection, target_conn: &Connection) -> Result<(), String> {
    // Check if patch_reviews table exists in source
    let table_exists: bool = source_conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='patch_reviews'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !table_exists {
        return Ok(());
    }

    // Get all reviews from source
    let mut stmt = source_conn
        .prepare("SELECT patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at FROM patch_reviews")
        .map_err(|e| e.to_string())?;

    let source_reviews = stmt
        .query_map([], |row| {
            Ok(PatchReview {
                patch_uuid: row.get(0)?,
                reviewer_id: row.get(1)?,
                decision: row.get(2)?,
                reviewer_name: row.get(3)?,
                reviewed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Import reviews (INSERT OR REPLACE to handle duplicates)
    for review in source_reviews {
        target_conn
            .execute(
                "INSERT OR REPLACE INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![review.patch_uuid, review.reviewer_id, review.decision, review.reviewer_name, review.reviewed_at],
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn import_comments(source_conn: &Connection, target_conn: &Connection) -> Result<(), String> {
    // Check if comments table exists in source
    let table_exists: bool = source_conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='comments'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !table_exists {
        return Ok(());
    }

    // Ensure target table exists
    init_comments_table(target_conn)?;

    // Get all comments from source
    let mut stmt = source_conn
        .prepare("SELECT id, timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, status, parent_id FROM comments ORDER BY id ASC")
        .map_err(|e| e.to_string())?;

    let source_comments = stmt
        .query_map([], |row| {
            Ok(Comment {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                author: row.get(2)?,
                author_color: row.get(3)?,
                start_anchor: row.get(4)?,
                end_anchor: row.get(5)?,
                selected_text: row.get(6)?,
                content: row.get(7)?,
                status: row.get(8)?,
                parent_id: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Map source ID -> Target ID
    let mut id_map: HashMap<i64, i64> = HashMap::new();

    for comment in source_comments {
        // Check if equivalent comment exists in target
        // We match on timestamp, author, and content to identify duplicates
        let existing_id: Option<i64> = target_conn
            .query_row(
                "SELECT id FROM comments WHERE timestamp = ?1 AND author = ?2 AND content = ?3",
                params![comment.timestamp, comment.author, comment.content],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(id) = existing_id {
            // Found duplicate, map source ID to existing target ID
            id_map.insert(comment.id, id);
        } else {
            // New comment, insert it
            // Remap parent_id if it exists
            let new_parent_id = comment.parent_id.and_then(|pid| id_map.get(&pid).copied());

            target_conn
                .execute(
                    r#"
                    INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, status, parent_id)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                    "#,
                    params![
                        comment.timestamp,
                        comment.author,
                        comment.author_color,
                        comment.start_anchor,
                        comment.end_anchor,
                        comment.selected_text,
                        comment.content,
                        comment.status,
                        new_parent_id,
                    ],
                )
                .map_err(|e| e.to_string())?;

            let new_id = target_conn.last_insert_rowid();
            id_map.insert(comment.id, new_id);
        }
    }

    Ok(())
}

/// Record a review for a patch
#[tauri::command]
pub fn record_patch_review(
    app: AppHandle,
    patch_uuid: String,
    reviewer_id: String,
    decision: String,
    reviewer_name: Option<String>,
) -> Result<(), String> {
    let conn = get_conn(&app)?;

    // Validate decision
    if decision != "accepted" && decision != "rejected" {
        return Err(format!("Invalid decision: {}. Must be 'accepted' or 'rejected'", decision));
    }

    let reviewed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "INSERT OR REPLACE INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get reviews for a specific patch
#[tauri::command]
pub fn get_patch_reviews(
    app: AppHandle,
    patch_uuid: String,
) -> Result<Vec<PatchReview>, String> {
    let conn = get_conn(&app)?;

    let mut stmt = conn
        .prepare("SELECT patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at FROM patch_reviews WHERE patch_uuid = ?1 ORDER BY reviewed_at DESC")
        .map_err(|e| e.to_string())?;

    let reviews = stmt
        .query_map([patch_uuid], |row| {
            Ok(PatchReview {
                patch_uuid: row.get(0)?,
                reviewer_id: row.get(1)?,
                decision: row.get(2)?,
                reviewer_name: row.get(3)?,
                reviewed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(reviews)
}

/// Get patches that need review by the current user
#[tauri::command]
pub fn get_patches_needing_review(
    app: AppHandle,
    reviewer_id: String,
) -> Result<Vec<Patch>, String> {
    let conn = get_conn(&app)?;

    // Query patches where author != reviewer_id and no review exists from reviewer_id
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.timestamp, p.author, p.kind, p.data, p.uuid, p.parent_uuid
             FROM patches p
             WHERE p.author != ?1
             AND p.uuid IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM patch_reviews pr
                 WHERE pr.patch_uuid = p.uuid
                 AND pr.reviewer_id = ?1
             )
             ORDER BY p.timestamp ASC"
        )
        .map_err(|e| e.to_string())?;

    let patches = stmt
        .query_map([reviewer_id], |row| {
            let data_str: String = row.get(4)?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);

            Ok(Patch {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                author: row.get(2)?,
                kind: row.get(3)?,
                data,
                uuid: row.get(5).ok(),
                parent_uuid: row.get(6).ok(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(patches)
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
