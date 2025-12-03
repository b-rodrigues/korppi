// src-tauri/src/patch_bundle.rs
//! Patch Bundle implementation for email-based collaboration.
//!
//! A patch bundle (.kmd-patch) is a ZIP archive containing:
//! - bundle.json: Bundle metadata
//! - patches.json: Array of patch entries
//! - update.yjs: Yjs update vector (binary)
//! - author.json: Author profile

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::document_manager::DocumentManager;
use crate::patch_log::Patch;
use crate::profile::UserProfile;

/// Author information for patch bundles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorInfo {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

impl From<UserProfile> for AuthorInfo {
    fn from(profile: UserProfile) -> Self {
        Self {
            id: profile.id,
            name: profile.name,
            email: profile.email,
        }
    }
}

/// A single patch entry in the bundle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchEntry {
    pub id: i64,
    pub timestamp: i64,
    pub author: String,
    pub kind: String,
    pub data: serde_json::Value,
}

impl From<Patch> for PatchEntry {
    fn from(patch: Patch) -> Self {
        Self {
            id: patch.id,
            timestamp: patch.timestamp,
            author: patch.author,
            kind: patch.kind,
            data: patch.data,
        }
    }
}

/// A patch bundle for sharing changes via email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchBundle {
    pub id: String,
    pub document_id: String,
    pub document_title: String,
    pub author: AuthorInfo,
    pub created_at: DateTime<Utc>,
    pub base_state_hash: String,
    pub patches: Vec<PatchEntry>,
}

/// Sync state for a collaborator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub collaborator_id: String,
    pub collaborator_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sent: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_received: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sent_patch_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_received_patch_id: Option<i64>,
}

/// Document sync state containing all collaborators
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSyncState {
    pub document_id: String,
    pub collaborators: Vec<SyncState>,
}

/// Result of exporting a patch bundle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub path: String,
    pub patch_count: usize,
    pub bundle_id: String,
    pub message: String,
}

/// Result of importing a patch bundle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub success: bool,
    pub patches_imported: usize,
    pub conflicts_detected: usize,
    pub author: AuthorInfo,
    pub document_title: String,
    pub message: String,
}

/// Preview of a patch bundle before import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundlePreview {
    pub author: AuthorInfo,
    pub document_id: String,
    pub document_title: String,
    pub patch_count: usize,
    pub date_range: Option<(i64, i64)>,
    pub potential_conflicts: usize,
    pub is_same_document: bool,
}

/// Get the sync directory path
fn get_sync_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("korppi").join("sync"))
        .ok_or_else(|| "Could not determine config directory".to_string())
}

/// Get the sync state file path for a document
fn get_sync_state_path(document_id: &str) -> Result<PathBuf, String> {
    get_sync_dir().map(|p| p.join(format!("{}.json", document_id)))
}

/// Load sync state for a document
fn load_sync_state(document_id: &str) -> Result<DocumentSyncState, String> {
    let path = get_sync_state_path(document_id)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(DocumentSyncState {
            document_id: document_id.to_string(),
            collaborators: Vec::new(),
        })
    }
}

/// Save sync state for a document
fn save_sync_state(state: &DocumentSyncState) -> Result<(), String> {
    let sync_dir = get_sync_dir()?;
    fs::create_dir_all(&sync_dir).map_err(|e| e.to_string())?;
    let path = get_sync_state_path(&state.document_id)?;
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Calculate a simple hash of Yjs state for conflict detection
fn calculate_state_hash(state: &[u8]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    state.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Get patches from history database since a given ID
fn get_patches_since(
    history_path: &PathBuf,
    since_id: Option<i64>,
) -> Result<Vec<PatchEntry>, String> {
    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(history_path).map_err(|e| e.to_string())?;

    // Check if patches table exists
    let table_exists: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patches'")
        .map_err(|e| e.to_string())?
        .exists([])
        .map_err(|e| e.to_string())?;

    if !table_exists {
        return Ok(Vec::new());
    }

    let query = match since_id {
        Some(id) => format!(
            "SELECT id, timestamp, author, kind, data FROM patches WHERE id > {} ORDER BY id ASC",
            id
        ),
        None => "SELECT id, timestamp, author, kind, data FROM patches ORDER BY id ASC".to_string(),
    };

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let patches: Vec<PatchEntry> = stmt
        .query_map([], |row| {
            let data_str: String = row.get(4)?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);

            Ok(PatchEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                author: row.get(2)?,
                kind: row.get(3)?,
                data,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(patches)
}

/// Get the count of patches since a given ID
fn get_patches_count_since(history_path: &PathBuf, since_id: Option<i64>) -> Result<usize, String> {
    if !history_path.exists() {
        return Ok(0);
    }

    let conn = Connection::open(history_path).map_err(|e| e.to_string())?;

    // Check if patches table exists
    let table_exists: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patches'")
        .map_err(|e| e.to_string())?
        .exists([])
        .map_err(|e| e.to_string())?;

    if !table_exists {
        return Ok(0);
    }

    let query = match since_id {
        Some(id) => format!("SELECT COUNT(*) FROM patches WHERE id > {}", id),
        None => "SELECT COUNT(*) FROM patches".to_string(),
    };

    let count: i64 = conn
        .query_row(&query, [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count as usize)
}

/// Import patches into history database, avoiding duplicates
fn import_patches_to_history(
    history_path: &PathBuf,
    patches: &[PatchEntry],
) -> Result<usize, String> {
    let conn = Connection::open(history_path).map_err(|e| e.to_string())?;

    // Ensure patches table exists
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

    let mut imported = 0;

    for patch in patches {
        // Check if patch already exists (by timestamp + author + kind)
        let exists: bool = conn
            .prepare("SELECT 1 FROM patches WHERE timestamp = ?1 AND author = ?2 AND kind = ?3")
            .map_err(|e| e.to_string())?
            .exists(params![patch.timestamp, &patch.author, &patch.kind])
            .map_err(|e| e.to_string())?;

        if !exists {
            let data_str = serde_json::to_string(&patch.data).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO patches (timestamp, author, kind, data) VALUES (?1, ?2, ?3, ?4)",
                params![patch.timestamp, &patch.author, &patch.kind, data_str],
            )
            .map_err(|e| e.to_string())?;
            imported += 1;
        }
    }

    Ok(imported)
}

/// Get current user profile
fn get_current_profile(app: &AppHandle) -> Result<UserProfile, String> {
    crate::profile::get_profile(app.clone())
}

/// Export patch bundle for sharing
#[tauri::command]
pub fn export_patch_bundle(
    app: AppHandle,
    manager: State<'_, Mutex<DocumentManager>>,
    path: String,
    since_patch_id: Option<i64>,
    collaborator_id: Option<String>,
) -> Result<ExportResult, String> {
    // Extract all needed data while holding the lock
    let (document_uuid, yjs_state, history_path, document_title) = {
        let manager = manager.lock().map_err(|e| e.to_string())?;
        let doc_id = manager
            .active_document_id
            .as_ref()
            .ok_or("No active document")?;
        let doc = manager
            .documents
            .get(doc_id)
            .ok_or("Active document not found")?;
        (
            doc.meta.uuid.clone(),
            doc.yjs_state.clone(),
            doc.history_path.clone(),
            doc.meta.title.clone(),
        )
    };

    // Get current user profile
    let profile = get_current_profile(&app)?;
    let author = AuthorInfo::from(profile);

    // Load sync state to determine since_patch_id if not provided
    let sync_state = load_sync_state(&document_uuid)?;
    let effective_since_id = since_patch_id.or_else(|| {
        collaborator_id.as_ref().and_then(|cid| {
            sync_state
                .collaborators
                .iter()
                .find(|c| &c.collaborator_id == cid)
                .and_then(|c| c.last_sent_patch_id)
        })
    });

    // Get patches since last sync
    let patches = get_patches_since(&history_path, effective_since_id)?;

    if patches.is_empty() {
        return Err("No new changes to share".to_string());
    }

    // Create bundle
    let bundle_id = Uuid::new_v4().to_string();
    let bundle = PatchBundle {
        id: bundle_id.clone(),
        document_id: document_uuid.clone(),
        document_title,
        author: author.clone(),
        created_at: Utc::now(),
        base_state_hash: calculate_state_hash(&yjs_state),
        patches: patches.clone(),
    };

    // Create ZIP archive
    let file =
        File::create(&path).map_err(|e| format!("Failed to create patch bundle file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // Write bundle.json
    let bundle_json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    zip.start_file("bundle.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(bundle_json.as_bytes())
        .map_err(|e| e.to_string())?;

    // Write patches.json
    let patches_json = serde_json::to_string_pretty(&bundle.patches).map_err(|e| e.to_string())?;
    zip.start_file("patches.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(patches_json.as_bytes())
        .map_err(|e| e.to_string())?;

    // Write update.yjs (Yjs state)
    if !yjs_state.is_empty() {
        zip.start_file("update.yjs", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&yjs_state)
            .map_err(|e| e.to_string())?;
    }

    // Write author.json
    let author_json = serde_json::to_string_pretty(&author).map_err(|e| e.to_string())?;
    zip.start_file("author.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(author_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;

    // Update sync state
    let last_patch_id = patches.last().map(|p| p.id);

    if let Some(cid) = collaborator_id {
        let mut sync_state = load_sync_state(&document_uuid)?;
        let now = Utc::now();

        if let Some(collab) = sync_state
            .collaborators
            .iter_mut()
            .find(|c| c.collaborator_id == cid)
        {
            collab.last_sent = Some(now);
            collab.last_sent_patch_id = last_patch_id;
        } else {
            sync_state.collaborators.push(SyncState {
                collaborator_id: cid.clone(),
                collaborator_name: cid,
                last_sent: Some(now),
                last_received: None,
                last_sent_patch_id: last_patch_id,
                last_received_patch_id: None,
            });
        }

        save_sync_state(&sync_state)?;
    }

    Ok(ExportResult {
        path,
        patch_count: patches.len(),
        bundle_id,
        message: format!("Exported {} changes", patches.len()),
    })
}

/// Preview a patch bundle before importing
#[tauri::command]
pub fn preview_patch_bundle(
    manager: State<'_, Mutex<DocumentManager>>,
    path: String,
) -> Result<BundlePreview, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open patch bundle: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Invalid patch bundle archive: {}", e))?;

    // Read bundle.json
    let bundle: PatchBundle = {
        let mut bundle_file = archive
            .by_name("bundle.json")
            .map_err(|_| "Missing bundle.json in patch bundle")?;
        let mut content = String::new();
        bundle_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid bundle.json: {}", e))?
    };

    // Get active document to check if same document
    let manager = manager.lock().map_err(|e| e.to_string())?;
    let is_same_document = manager
        .active_document_id
        .as_ref()
        .and_then(|id| manager.documents.get(id))
        .map(|doc| doc.meta.uuid == bundle.document_id)
        .unwrap_or(false);

    // Calculate date range
    let date_range = if bundle.patches.is_empty() {
        None
    } else {
        let min_ts = bundle.patches.iter().map(|p| p.timestamp).min().unwrap();
        let max_ts = bundle.patches.iter().map(|p| p.timestamp).max().unwrap();
        Some((min_ts, max_ts))
    };

    // Simple conflict detection: count patches in overlapping time windows
    let potential_conflicts = if let Some(doc) = manager
        .active_document_id
        .as_ref()
        .and_then(|id| manager.documents.get(id))
    {
        let local_patches = get_patches_since(&doc.history_path, None).unwrap_or_default();
        count_potential_conflicts(&local_patches, &bundle.patches)
    } else {
        0
    };

    Ok(BundlePreview {
        author: bundle.author,
        document_id: bundle.document_id,
        document_title: bundle.document_title,
        patch_count: bundle.patches.len(),
        date_range,
        potential_conflicts,
        is_same_document,
    })
}

/// Count potential conflicts between local and incoming patches
fn count_potential_conflicts(local: &[PatchEntry], incoming: &[PatchEntry]) -> usize {
    // Simplified conflict detection: count overlapping time windows with different authors
    const CONFLICT_WINDOW_MS: i64 = 60000; // 1 minute

    let mut conflicts = 0;

    for incoming_patch in incoming {
        for local_patch in local {
            // Skip if same author
            if local_patch.author == incoming_patch.author {
                continue;
            }

            // Check if patches are within conflict window
            let time_diff = (local_patch.timestamp - incoming_patch.timestamp).abs();
            if time_diff <= CONFLICT_WINDOW_MS {
                conflicts += 1;
                break; // Only count once per incoming patch
            }
        }
    }

    conflicts
}

/// Import a patch bundle from a collaborator
#[tauri::command]
pub fn import_patch_bundle(
    manager: State<'_, Mutex<DocumentManager>>,
    path: String,
) -> Result<ImportResult, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open patch bundle: {}", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Invalid patch bundle archive: {}", e))?;

    // Read bundle.json
    let bundle: PatchBundle = {
        let mut bundle_file = archive
            .by_name("bundle.json")
            .map_err(|_| "Missing bundle.json in patch bundle")?;
        let mut content = String::new();
        bundle_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid bundle.json: {}", e))?
    };

    // Read Yjs update if present
    let yjs_update: Option<Vec<u8>> = if let Ok(mut update_file) = archive.by_name("update.yjs") {
        let mut data = Vec::new();
        update_file.read_to_end(&mut data).map_err(|e| e.to_string())?;
        Some(data)
    } else {
        None
    };

    // Get active document
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    let doc_id = manager
        .active_document_id
        .as_ref()
        .ok_or("No active document")?
        .clone();

    let doc = manager
        .documents
        .get_mut(&doc_id)
        .ok_or("Active document not found")?;

    // Verify document ID matches (warn if not)
    let is_same_document = doc.meta.uuid == bundle.document_id;

    // Import patches
    let patches_imported = import_patches_to_history(&doc.history_path, &bundle.patches)?;

    // Apply Yjs update if present
    // Note: In a full implementation, this would merge with the existing Yjs state
    // For now, we just store the incoming state if the document is empty
    if let Some(update) = yjs_update {
        if doc.yjs_state.is_empty() {
            doc.yjs_state = update;
        }
        // If doc already has state, the frontend Yjs instance handles merging
    }

    // Mark document as modified
    doc.handle.is_modified = true;

    // Calculate potential conflicts
    let local_patches = get_patches_since(&doc.history_path, None).unwrap_or_default();
    let conflicts_detected = count_potential_conflicts(&local_patches, &bundle.patches);

    // Update sync state
    let last_patch_id = bundle.patches.last().map(|p| p.id);
    let document_uuid = doc.meta.uuid.clone();

    drop(manager); // Release lock

    let mut sync_state = load_sync_state(&document_uuid)?;
    let now = Utc::now();
    let author_id = bundle.author.id.clone();
    let author_name = bundle.author.name.clone();

    if let Some(collab) = sync_state
        .collaborators
        .iter_mut()
        .find(|c| c.collaborator_id == author_id)
    {
        collab.last_received = Some(now);
        collab.last_received_patch_id = last_patch_id;
    } else {
        sync_state.collaborators.push(SyncState {
            collaborator_id: author_id,
            collaborator_name: author_name,
            last_sent: None,
            last_received: Some(now),
            last_sent_patch_id: None,
            last_received_patch_id: last_patch_id,
        });
    }

    save_sync_state(&sync_state)?;

    let message = if is_same_document {
        format!(
            "Imported {} changes from {}",
            patches_imported, bundle.author.name
        )
    } else {
        format!(
            "Imported {} changes from {} (different document ID)",
            patches_imported, bundle.author.name
        )
    };

    Ok(ImportResult {
        success: true,
        patches_imported,
        conflicts_detected,
        author: bundle.author,
        document_title: bundle.document_title,
        message,
    })
}

/// Get sync state for a document
#[tauri::command]
pub fn get_sync_state(
    manager: State<'_, Mutex<DocumentManager>>,
    document_id: Option<String>,
) -> Result<Vec<SyncState>, String> {
    let doc_id = if let Some(id) = document_id {
        id
    } else {
        let manager = manager.lock().map_err(|e| e.to_string())?;
        manager
            .active_document_id
            .as_ref()
            .and_then(|id| manager.documents.get(id))
            .map(|doc| doc.meta.uuid.clone())
            .ok_or("No active document")?
    };

    let sync_state = load_sync_state(&doc_id)?;
    Ok(sync_state.collaborators)
}

/// Get count of pending changes since last sync with a collaborator
#[tauri::command]
pub fn get_pending_changes_count(
    manager: State<'_, Mutex<DocumentManager>>,
    document_id: Option<String>,
    collaborator_id: Option<String>,
) -> Result<usize, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc_id = if let Some(id) = document_id {
        id
    } else {
        manager
            .active_document_id
            .clone()
            .ok_or("No active document")?
    };

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or("Document not found")?;

    // Get last sent patch ID for this collaborator
    let sync_state = load_sync_state(&doc.meta.uuid)?;
    let since_patch_id = collaborator_id.and_then(|cid| {
        sync_state
            .collaborators
            .iter()
            .find(|c| c.collaborator_id == cid)
            .and_then(|c| c.last_sent_patch_id)
    });

    get_patches_count_since(&doc.history_path, since_patch_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_author_info_serialization() {
        let author = AuthorInfo {
            id: "test-uuid".to_string(),
            name: "Test User".to_string(),
            email: Some("test@example.com".to_string()),
        };

        let json = serde_json::to_string(&author).unwrap();
        let parsed: AuthorInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, author.id);
        assert_eq!(parsed.name, author.name);
        assert_eq!(parsed.email, author.email);
    }

    #[test]
    fn test_patch_entry_serialization() {
        let entry = PatchEntry {
            id: 1,
            timestamp: 1699999999999,
            author: "test-author".to_string(),
            kind: "insert_text".to_string(),
            data: serde_json::json!({"at": 0, "insertedText": "Hello"}),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: PatchEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, entry.id);
        assert_eq!(parsed.timestamp, entry.timestamp);
        assert_eq!(parsed.author, entry.author);
    }

    #[test]
    fn test_patch_bundle_serialization() {
        let bundle = PatchBundle {
            id: "bundle-uuid".to_string(),
            document_id: "doc-uuid".to_string(),
            document_title: "Test Document".to_string(),
            author: AuthorInfo {
                id: "author-uuid".to_string(),
                name: "Author".to_string(),
                email: None,
            },
            created_at: Utc::now(),
            base_state_hash: "abc123".to_string(),
            patches: vec![],
        };

        let json = serde_json::to_string(&bundle).unwrap();
        let parsed: PatchBundle = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, bundle.id);
        assert_eq!(parsed.document_id, bundle.document_id);
        assert_eq!(parsed.document_title, bundle.document_title);
    }

    #[test]
    fn test_sync_state_serialization() {
        let state = SyncState {
            collaborator_id: "collab-uuid".to_string(),
            collaborator_name: "Collaborator".to_string(),
            last_sent: Some(Utc::now()),
            last_received: None,
            last_sent_patch_id: Some(42),
            last_received_patch_id: None,
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: SyncState = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.collaborator_id, state.collaborator_id);
        assert_eq!(parsed.last_sent_patch_id, state.last_sent_patch_id);
    }

    #[test]
    fn test_document_sync_state_serialization() {
        let state = DocumentSyncState {
            document_id: "doc-uuid".to_string(),
            collaborators: vec![SyncState {
                collaborator_id: "collab-uuid".to_string(),
                collaborator_name: "Alice".to_string(),
                last_sent: Some(Utc::now()),
                last_received: Some(Utc::now()),
                last_sent_patch_id: Some(42),
                last_received_patch_id: Some(38),
            }],
        };

        let json = serde_json::to_string_pretty(&state).unwrap();
        let parsed: DocumentSyncState = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.document_id, state.document_id);
        assert_eq!(parsed.collaborators.len(), 1);
    }

    #[test]
    fn test_export_result_serialization() {
        let result = ExportResult {
            path: "/tmp/test.kmd-patch".to_string(),
            patch_count: 5,
            bundle_id: "bundle-uuid".to_string(),
            message: "Exported 5 changes".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ExportResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.path, result.path);
        assert_eq!(parsed.patch_count, result.patch_count);
    }

    #[test]
    fn test_import_result_serialization() {
        let result = ImportResult {
            success: true,
            patches_imported: 3,
            conflicts_detected: 1,
            author: AuthorInfo {
                id: "author-uuid".to_string(),
                name: "Bob".to_string(),
                email: None,
            },
            document_title: "Test Doc".to_string(),
            message: "Imported 3 changes from Bob".to_string(),
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ImportResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.success, result.success);
        assert_eq!(parsed.patches_imported, result.patches_imported);
        assert_eq!(parsed.conflicts_detected, result.conflicts_detected);
    }

    #[test]
    fn test_bundle_preview_serialization() {
        let preview = BundlePreview {
            author: AuthorInfo {
                id: "author-uuid".to_string(),
                name: "Alice".to_string(),
                email: Some("alice@example.com".to_string()),
            },
            document_id: "doc-uuid".to_string(),
            document_title: "Test Document".to_string(),
            patch_count: 10,
            date_range: Some((1699999999000, 1700000000000)),
            potential_conflicts: 2,
            is_same_document: true,
        };

        let json = serde_json::to_string(&preview).unwrap();
        let parsed: BundlePreview = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.patch_count, preview.patch_count);
        assert_eq!(parsed.is_same_document, preview.is_same_document);
    }

    #[test]
    fn test_calculate_state_hash() {
        let state1 = vec![1, 2, 3, 4, 5];
        let state2 = vec![1, 2, 3, 4, 5];
        let state3 = vec![5, 4, 3, 2, 1];

        let hash1 = calculate_state_hash(&state1);
        let hash2 = calculate_state_hash(&state2);
        let hash3 = calculate_state_hash(&state3);

        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_eq!(hash1.len(), 16); // 64 bits = 16 hex chars
    }

    #[test]
    fn test_count_potential_conflicts() {
        let local = vec![
            PatchEntry {
                id: 1,
                timestamp: 1000000,
                author: "alice".to_string(),
                kind: "insert_text".to_string(),
                data: serde_json::Value::Null,
            },
            PatchEntry {
                id: 2,
                timestamp: 1000100,
                author: "alice".to_string(),
                kind: "insert_text".to_string(),
                data: serde_json::Value::Null,
            },
        ];

        let incoming = vec![
            PatchEntry {
                id: 1,
                timestamp: 1000050, // Within window of local patch 1
                author: "bob".to_string(),
                kind: "insert_text".to_string(),
                data: serde_json::Value::Null,
            },
            PatchEntry {
                id: 2,
                timestamp: 2000000, // Outside window
                author: "bob".to_string(),
                kind: "insert_text".to_string(),
                data: serde_json::Value::Null,
            },
        ];

        let conflicts = count_potential_conflicts(&local, &incoming);
        assert_eq!(conflicts, 1); // Only the first incoming patch conflicts
    }

    #[test]
    fn test_count_potential_conflicts_same_author() {
        let local = vec![PatchEntry {
            id: 1,
            timestamp: 1000000,
            author: "alice".to_string(),
            kind: "insert_text".to_string(),
            data: serde_json::Value::Null,
        }];

        let incoming = vec![PatchEntry {
            id: 1,
            timestamp: 1000010, // Within window but same author
            author: "alice".to_string(),
            kind: "insert_text".to_string(),
            data: serde_json::Value::Null,
        }];

        let conflicts = count_potential_conflicts(&local, &incoming);
        assert_eq!(conflicts, 0); // Same author, no conflict
    }
}
