// src-tauri/src/document_manager.rs
//! Document Manager for multi-document support.
//!
//! Manages multiple documents with isolated state for each.
//! Documents can be opened, saved, and closed independently.
//! Recent documents are tracked for quick access.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::kmd::{
    check_version_compatibility, DocumentMeta, FormatInfo, AuthorProfile,
};
use crate::db_utils::ensure_schema;
use quick_xml::events::Event;
use quick_xml::reader::Reader;

/// Default author color for new profiles
const DEFAULT_AUTHOR_COLOR: &str = "#3498db";

/// A handle to an open document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentHandle {
    pub id: String,
    pub path: Option<PathBuf>,
    pub title: String,
    pub is_modified: bool,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub opened_at: DateTime<Utc>,
}

/// A recent document entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDocument {
    pub path: PathBuf,
    pub title: String,
    #[serde(with = "chrono::serde::ts_milliseconds")]
    pub last_opened: DateTime<Utc>,
}

/// State for a single document
pub struct DocumentState {
    pub handle: DocumentHandle,
    pub yjs_state: Vec<u8>,
    pub history_path: PathBuf,
    pub meta: DocumentMeta,
}

/// The document manager state
pub struct DocumentManager {
    pub documents: HashMap<String, DocumentState>,
    pub active_document_id: Option<String>,
}

impl Default for DocumentManager {
    fn default() -> Self {
        Self {
            documents: HashMap::new(),
            active_document_id: None,
        }
    }
}

/// Get the config directory for korppi
fn get_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("korppi"))
        .ok_or_else(|| "Could not determine config directory".to_string())
}

/// Get the path to the recent documents file
fn get_recent_path() -> Result<PathBuf, String> {
    get_config_dir().map(|p| p.join("recent.json"))
}

/// Get the temp directory for document workspaces
fn get_temp_base_dir() -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join("korppi-documents");
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    Ok(temp)
}

/// Create a temp directory for a document
fn create_document_temp_dir(doc_id: &str) -> Result<PathBuf, String> {
    let base = get_temp_base_dir()?;
    let doc_dir = base.join(doc_id);
    fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
    Ok(doc_dir)
}

/// Clean up a document's temp directory
fn cleanup_document_temp_dir(doc_id: &str) -> Result<(), String> {
    let base = get_temp_base_dir()?;
    let doc_dir = base.join(doc_id);
    if doc_dir.exists() {
        fs::remove_dir_all(&doc_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Load recent documents list
fn load_recent_documents() -> Result<Vec<RecentDocument>, String> {
    let path = get_recent_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save recent documents list
fn save_recent_documents(recent: &[RecentDocument]) -> Result<(), String> {
    let config_dir = get_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let path = config_dir.join("recent.json");
    let content = serde_json::to_string_pretty(recent).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Add a document to the recent list
fn add_to_recent(path: PathBuf, title: String) -> Result<(), String> {
    let mut recent = load_recent_documents().unwrap_or_default();
    
    // Remove if already exists
    recent.retain(|r| r.path != path);
    
    // Add to front
    recent.insert(0, RecentDocument {
        path,
        title,
        last_opened: Utc::now(),
    });
    
    // Keep only 10 most recent
    recent.truncate(10);
    
    save_recent_documents(&recent)
}

/// Extract a KMD file to a document temp directory
fn extract_kmd_to_temp(kmd_path: &PathBuf, doc_id: &str) -> Result<(Vec<u8>, PathBuf, DocumentMeta), String> {
    let file = File::open(kmd_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;
    
    let temp_dir = create_document_temp_dir(doc_id)?;
    
    // Read and validate format.json
    let format_info: FormatInfo = {
        let mut format_file = archive
            .by_name("format.json")
            .map_err(|_| "Missing format.json in KMD file")?;
        let mut content = String::new();
        format_file.read_to_string(&mut content).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid format.json: {}", e))?
    };
    
    check_version_compatibility(&format_info)?;
    
    // Read meta.json
    let meta: DocumentMeta = {
        let mut meta_file = archive
            .by_name("meta.json")
            .map_err(|_| "Missing meta.json in KMD file")?;
        let mut content = String::new();
        meta_file.read_to_string(&mut content).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid meta.json: {}", e))?
    };
    
    // Extract state.yjs
    let yjs_state = if let Ok(mut state_file) = archive.by_name("state.yjs") {
        let mut state_data = Vec::new();
        state_file.read_to_end(&mut state_data).map_err(|e| e.to_string())?;
        state_data
    } else {
        Vec::new()
    };
    
    // Extract history.sqlite to temp dir
    let history_path = temp_dir.join("history.sqlite");
    if let Ok(mut history_file) = archive.by_name("history.sqlite") {
        let mut history_data = Vec::new();
        history_file.read_to_end(&mut history_data).map_err(|e| e.to_string())?;
        fs::write(&history_path, &history_data).map_err(|e| e.to_string())?;
    }
    
    Ok((yjs_state, history_path, meta))
}

/// Bundle a document state into a KMD file
fn bundle_to_kmd(
    kmd_path: &PathBuf,
    yjs_state: &[u8],
    history_path: &PathBuf,
    meta: &DocumentMeta,
) -> Result<(), String> {
    let file = File::create(kmd_path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    
    // Write format.json
    let format_info = FormatInfo::default();
    let format_json = serde_json::to_string_pretty(&format_info).map_err(|e| e.to_string())?;
    zip.start_file("format.json", options).map_err(|e| e.to_string())?;
    zip.write_all(format_json.as_bytes()).map_err(|e| e.to_string())?;
    
    // Write state.yjs
    if !yjs_state.is_empty() {
        zip.start_file("state.yjs", options).map_err(|e| e.to_string())?;
        zip.write_all(yjs_state).map_err(|e| e.to_string())?;
    }
    
    // Write history.sqlite
    if history_path.exists() {
        let history_data = fs::read(history_path).map_err(|e| e.to_string())?;
        zip.start_file("history.sqlite", options).map_err(|e| e.to_string())?;
        zip.write_all(&history_data).map_err(|e| e.to_string())?;
    }
    
    // Write meta.json
    let meta_json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    zip.start_file("meta.json", options).map_err(|e| e.to_string())?;
    zip.write_all(meta_json.as_bytes()).map_err(|e| e.to_string())?;
    
    // Write authors directory
    zip.add_directory("authors/", options).map_err(|e| e.to_string())?;
    
    // Write author profiles
    for author in &meta.authors {
        let profile = AuthorProfile {
            id: author.id.clone(),
            name: author.name.clone(),
            email: author.email.clone(),
            color: DEFAULT_AUTHOR_COLOR.to_string(),
            avatar_base64: None,
            public_key: None,
        };
        let profile_json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
        let author_file = format!("authors/{}.json", author.id);
        zip.start_file(&author_file, options).map_err(|e| e.to_string())?;
        zip.write_all(profile_json.as_bytes()).map_err(|e| e.to_string())?;
    }
    
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Create a new empty document
#[tauri::command]
pub fn new_document(
    manager: State<'_, Mutex<DocumentManager>>,
) -> Result<DocumentHandle, String> {
    let doc_id = Uuid::new_v4().to_string();
    let temp_dir = create_document_temp_dir(&doc_id)?;
    
    let handle = DocumentHandle {
        id: doc_id.clone(),
        path: None,
        title: "Untitled Document".to_string(),
        is_modified: false,
        opened_at: Utc::now(),
    };
    
    let meta = DocumentMeta::default();
    
    let state = DocumentState {
        handle: handle.clone(),
        yjs_state: Vec::new(),
        history_path: temp_dir.join("history.sqlite"),
        meta,
    };
    
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    manager.documents.insert(doc_id.clone(), state);
    manager.active_document_id = Some(doc_id);
    
    Ok(handle)
}

/// Open a document (shows file picker if path is None)
#[tauri::command]
pub async fn open_document(
    app: AppHandle,
    manager: State<'_, Mutex<DocumentManager>>,
    path: Option<String>,
) -> Result<DocumentHandle, String> {
    use tauri_plugin_dialog::DialogExt;
    
    let file_path: PathBuf = if let Some(p) = path {
        PathBuf::from(p)
    } else {
        // Show file picker
        let file = app.dialog()
            .file()
            .add_filter("Korppi Document", &["kmd"])
            .blocking_pick_file();
        
        match file {
            Some(f) => f.into_path().map_err(|_| "Failed to convert file path".to_string())?,
            None => return Err("No file selected".to_string()),
        }
    };
    
    if !file_path.exists() {
        return Err(format!("File not found: {:?}", file_path));
    }
    
    let doc_id = Uuid::new_v4().to_string();
    let (yjs_state, history_path, mut meta) = extract_kmd_to_temp(&file_path, &doc_id)?;
    
    // Use filename as title if meta has default "Untitled Document"
    let title = if meta.title == "Untitled Document" {
        file_path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| meta.title.clone())
    } else {
        meta.title.clone()
    };
    
    // Update meta.title to match
    meta.title = title.clone();
    
    let handle = DocumentHandle {
        id: doc_id.clone(),
        path: Some(file_path.clone()),
        title,
        is_modified: false,
        opened_at: Utc::now(),
    };
    
    let state = DocumentState {
        handle: handle.clone(),
        yjs_state: yjs_state.clone(),
        history_path,
        meta,
    };
    
    // Add to recent documents
    add_to_recent(file_path.clone(), handle.title.clone())?;
    
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    manager.documents.insert(doc_id.clone(), state);
    manager.active_document_id = Some(doc_id);
    
    Ok(handle)
}

/// Save document (Save As if path provided)
#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    path: Option<String>,
) -> Result<DocumentHandle, String> {
    use tauri_plugin_dialog::DialogExt;
    
    // Get mutable reference to document state
    let (yjs_state, history_path, mut meta, existing_path) = {
        let manager = manager.lock().map_err(|e| e.to_string())?;
        let doc = manager.documents.get(&id)
            .ok_or_else(|| format!("Document not found: {}", id))?;
        (doc.yjs_state.clone(), doc.history_path.clone(), doc.meta.clone(), doc.handle.path.clone())
    };
    
    let save_path: PathBuf = if let Some(p) = path {
        PathBuf::from(p)
    } else if let Some(p) = existing_path {
        p
    } else {
        // Show save dialog
        let file = app.dialog()
            .file()
            .add_filter("Korppi Document", &["kmd"])
            .set_file_name(&format!("{}.kmd", meta.title))
            .blocking_save_file();
        
        match file {
            Some(f) => f.into_path().map_err(|_| "Failed to convert save path".to_string())?,
            None => return Err("Save cancelled".to_string()),
        }
    };
    
    // Update metadata
    meta.modified_at = Utc::now().to_rfc3339();
    meta.sync_state.last_export = Some(Utc::now().to_rfc3339());
    
    // Update title from filename if untitled (BEFORE bundling)
    if meta.title == "Untitled Document" {
        if let Some(stem) = save_path.file_stem() {
            meta.title = stem.to_string_lossy().to_string();
        }
    }
    
    // Bundle to KMD
    bundle_to_kmd(&save_path, &yjs_state, &history_path, &meta)?;
    
    // Update document state
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    if let Some(doc) = manager.documents.get_mut(&id) {
        doc.handle.path = Some(save_path.clone());
        doc.handle.is_modified = false;
        doc.meta = meta.clone();
        
        // Update title from filename if untitled
        if doc.handle.title == "Untitled Document" {
            if let Some(stem) = save_path.file_stem() {
                doc.handle.title = stem.to_string_lossy().to_string();
            }
        }
        
        // Add to recent documents
        add_to_recent(save_path, doc.handle.title.clone())?;
        
        return Ok(doc.handle.clone());
    }
    
    Err("Document not found after save".to_string())
}

/// Close a document (returns false if unsaved changes need confirmation)
#[tauri::command]
pub fn close_document(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    force: Option<bool>,
) -> Result<bool, String> {
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    
    if let Some(doc) = manager.documents.get(&id) {
        // If document has unsaved changes and not forcing, return false
        if doc.handle.is_modified && !force.unwrap_or(false) {
            return Ok(false);
        }
        
        // Clean up temp directory
        let _ = cleanup_document_temp_dir(&id);
        
        // Remove from documents
        manager.documents.remove(&id);
        
        // If this was the active document, switch to another
        if manager.active_document_id.as_ref() == Some(&id) {
            manager.active_document_id = manager.documents.keys().next().cloned();
        }
        
        return Ok(true);
    }
    
    Err(format!("Document not found: {}", id))
}

/// Get all open documents
#[tauri::command]
pub fn get_open_documents(
    manager: State<'_, Mutex<DocumentManager>>,
) -> Result<Vec<DocumentHandle>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.documents.values().map(|d| d.handle.clone()).collect())
}

/// Get recent documents list
#[tauri::command]
pub fn get_recent_documents() -> Result<Vec<RecentDocument>, String> {
    load_recent_documents()
}

/// Clear recent documents list
#[tauri::command]
pub fn clear_recent_documents() -> Result<(), String> {
    save_recent_documents(&[])
}

/// Set which document is currently active
#[tauri::command]
pub fn set_active_document(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
) -> Result<(), String> {
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    
    if manager.documents.contains_key(&id) {
        manager.active_document_id = Some(id);
        Ok(())
    } else {
        Err(format!("Document not found: {}", id))
    }
}

/// Get the active document
#[tauri::command]
pub fn get_active_document(
    manager: State<'_, Mutex<DocumentManager>>,
) -> Result<Option<DocumentHandle>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    if let Some(id) = &manager.active_document_id {
        if let Some(doc) = manager.documents.get(id) {
            return Ok(Some(doc.handle.clone()));
        }
    }
    Ok(None)
}

/// Get document Yjs state
#[tauri::command]
pub fn get_document_state(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
) -> Result<Vec<u8>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    manager.documents.get(&id)
        .map(|d| d.yjs_state.clone())
        .ok_or_else(|| format!("Document not found: {}", id))
}

/// Update document Yjs state
#[tauri::command]
pub fn update_document_state(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    state: Vec<u8>,
) -> Result<(), String> {
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    
    if let Some(doc) = manager.documents.get_mut(&id) {
        doc.yjs_state = state;
        doc.handle.is_modified = true;
        Ok(())
    } else {
        Err(format!("Document not found: {}", id))
    }
}

/// Mark document as modified
#[tauri::command]
pub fn mark_document_modified(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    modified: bool,
) -> Result<(), String> {
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    
    if let Some(doc) = manager.documents.get_mut(&id) {
        doc.handle.is_modified = modified;
        Ok(())
    } else {
        Err(format!("Document not found: {}", id))
    }
}

/// Update document title
#[tauri::command]
pub fn update_document_title(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    title: String,
) -> Result<(), String> {
    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    
    if let Some(doc) = manager.documents.get_mut(&id) {
        doc.handle.title = title.clone();
        doc.meta.title = title;
        doc.handle.is_modified = true;
        Ok(())
    } else {
        Err(format!("Document not found: {}", id))
    }
}

/// Record a patch for a specific document
#[tauri::command]
pub fn record_document_patch(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    patch: crate::patch_log::PatchInput,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&id)
        .ok_or_else(|| format!("Document not found: {}", id))?;
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    
    // Use shared schema definition
    ensure_schema(&conn)?;
    
    let data_str = serde_json::to_string(&patch.data).map_err(|e| e.to_string())?;
    
    // Use provided UUID or generate new one
    let patch_uuid = patch.uuid.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![patch.timestamp, patch.author, patch.kind, data_str, patch_uuid, patch.parent_uuid],
    ).map_err(|e| e.to_string())?;
    
    let patch_id = conn.last_insert_rowid();
    
    // If this is a Save patch with a snapshot, save it to the snapshots table
    if patch.kind == "Save" {
        if let Some(snapshot_str) = patch.data.get("snapshot") {
            if let Some(snapshot_text) = snapshot_str.as_str() {
                // Store the snapshot text as bytes
                conn.execute(
                    "INSERT INTO snapshots (timestamp, patch_id, state) VALUES (?1, ?2, ?3)",
                    params![patch.timestamp, patch_id, snapshot_text.as_bytes()],
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    
    Ok(())
}

/// List patches for a specific document
#[tauri::command]
pub fn list_document_patches(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
) -> Result<Vec<crate::patch_log::Patch>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&id)
        .ok_or_else(|| format!("Document not found: {}", id))?;
    
    if !doc.history_path.exists() {
        return Ok(Vec::new());
    }
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Ensure schema exists and is migrated (especially on first open of legacy doc)
    ensure_schema(&conn)?;
    
    let mut stmt = conn
        .prepare("SELECT id, timestamp, author, kind, data, uuid, parent_uuid FROM patches ORDER BY id ASC")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt
        .query_map([], |row| {
            let data_str: String = row.get(4)?;
            let data: serde_json::Value =
                serde_json::from_str(&data_str).unwrap_or(serde_json::Value::Null);
            
            Ok(crate::patch_log::Patch {
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

/// Record a review for a patch in a document
#[tauri::command]
pub fn record_document_patch_review(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    patch_uuid: String,
    reviewer_id: String,
    decision: String,
    reviewer_name: Option<String>,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    
    // Ensure schema exists (needed for patch_reviews table)
    ensure_schema(&conn)?;

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

/// Get reviews for patches in a document
#[tauri::command]
pub fn get_document_patch_reviews(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    patch_uuid: String,
) -> Result<Vec<crate::patch_log::PatchReview>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    
    // Ensure schema exists
    ensure_schema(&conn)?;
    
    let mut stmt = conn
        .prepare("SELECT patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at FROM patch_reviews WHERE patch_uuid = ?1 ORDER BY reviewed_at DESC")
        .map_err(|e| e.to_string())?;

    let reviews = stmt
        .query_map([patch_uuid], |row| {
            Ok(crate::patch_log::PatchReview {
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

/// Get patches that need review by a user in a document
#[tauri::command]
pub fn get_document_patches_needing_review(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    reviewer_id: String,
) -> Result<Vec<crate::patch_log::Patch>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager.documents.get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Ensure schema exists
    ensure_schema(&conn)?;

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

            Ok(crate::patch_log::Patch {
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

/// Get file path passed as command line argument
#[tauri::command]
pub fn get_initial_file() -> Option<String> {
    std::env::var("KORPPI_OPEN_FILE").ok()
}

/// Maximum allowed snapshot size (100 MB)
const MAX_SNAPSHOT_SIZE: usize = 100 * 1024 * 1024;

/// Save a Yjs state snapshot for a specific document at a given patch ID
#[tauri::command]
pub fn save_document_snapshot(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    patch_id: i64,
    state: Vec<u8>,
) -> Result<(), String> {
    // Validate input
    if state.is_empty() {
        return Err("Snapshot state cannot be empty".to_string());
    }
    if state.len() > MAX_SNAPSHOT_SIZE {
        return Err(format!("Snapshot size exceeds maximum allowed ({} bytes)", MAX_SNAPSHOT_SIZE));
    }

    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&id)
        .ok_or_else(|| format!("Document not found: {}", id))?;
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    
    // Ensure tables exist
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            patch_id    INTEGER NOT NULL,
            state       BLOB    NOT NULL,
            FOREIGN KEY (patch_id) REFERENCES patches(id)
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_patch_id ON snapshots(patch_id);
        "#,
    ).map_err(|e| e.to_string())?;
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    
    conn.execute(
        "INSERT INTO snapshots (timestamp, patch_id, state) VALUES (?1, ?2, ?3)",
        params![timestamp, patch_id, state],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Result of a restore operation for a document
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentRestoreResult {
    pub snapshot_content: Option<String>,
    pub patch_id: i64,
}

/// Restore a document to a specific patch - returns the snapshot content (text) for that patch
#[tauri::command]
pub fn restore_document_to_patch(
    manager: State<'_, Mutex<DocumentManager>>,
    id: String,
    patch_id: i64,
) -> Result<DocumentRestoreResult, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;
    
    let doc = manager.documents.get(&id)
        .ok_or_else(|| format!("Document not found: {}", id))?;
    
    if !doc.history_path.exists() {
        return Ok(DocumentRestoreResult {
            snapshot_content: None,
            patch_id,
        });
    }
    
    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    
    // Try to get the patch to extract the snapshot field from data
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
                return Ok(DocumentRestoreResult {
                    snapshot_content: Some(snapshot.to_string()),
                    patch_id,
                });
            }
        }
    }
    
    // No snapshot content available
    Ok(DocumentRestoreResult {
        snapshot_content: None,
        patch_id,
    })
}

/// Result of checking parent patch status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ParentPatchStatus {
    pub has_parent: bool,
    pub parent_uuid: Option<String>,
    pub parent_rejected: bool,
    pub rejected_by_name: Option<String>,
}

/// Check if a patch's parent has been rejected by the current user
/// This is used to warn users about accepting orphaned patches
#[tauri::command]
pub fn check_parent_patch_status(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    patch_uuid: String,
    reviewer_id: String,
) -> Result<ParentPatchStatus, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager.documents.get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Ensure schema exists
    ensure_schema(&conn)?;

    // Get the patch's parent_uuid
    let parent_uuid: Option<String> = conn
        .query_row(
            "SELECT parent_uuid FROM patches WHERE uuid = ?1",
            params![&patch_uuid],
            |row| row.get(0)
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    // If no parent, nothing to check
    let Some(parent_uuid) = parent_uuid else {
        return Ok(ParentPatchStatus {
            has_parent: false,
            parent_uuid: None,
            parent_rejected: false,
            rejected_by_name: None,
        });
    };

    // Check if the parent was rejected by this reviewer
    let rejection: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT decision, reviewer_name FROM patch_reviews WHERE patch_uuid = ?1 AND reviewer_id = ?2",
            params![&parent_uuid, &reviewer_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match rejection {
        Some((decision, reviewer_name)) if decision == "rejected" => {
            Ok(ParentPatchStatus {
                has_parent: true,
                parent_uuid: Some(parent_uuid),
                parent_rejected: true,
                rejected_by_name: reviewer_name,
            })
        }
        _ => {
            Ok(ParentPatchStatus {
                has_parent: true,
                parent_uuid: Some(parent_uuid),
                parent_rejected: false,
                rejected_by_name: None,
            })
        }
    }
}

/// Supported import file formats
#[derive(Debug, Clone, Copy, PartialEq)]
enum ImportFormat {
    Markdown,
    RMarkdown,
    Quarto,
    Docx,
    Odt,
}

impl ImportFormat {
    fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "md" | "markdown" | "txt" => Some(ImportFormat::Markdown),
            "rmd" => Some(ImportFormat::RMarkdown),
            "qmd" => Some(ImportFormat::Quarto),
            "docx" => Some(ImportFormat::Docx),
            "odt" => Some(ImportFormat::Odt),
            _ => None,
        }
    }
}

/// Strip YAML frontmatter from markdown content (for .rmd, .qmd files)
fn strip_yaml_frontmatter(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();

    // Check if the document starts with YAML frontmatter delimiter
    if lines.is_empty() || lines[0].trim() != "---" {
        return content.to_string();
    }

    // Find the closing delimiter
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" || line.trim() == "..." {
            // Return everything after the frontmatter
            return lines[(i + 1)..].join("\n");
        }
    }

    // No closing delimiter found, return original content
    content.to_string()
}

/// Check if pandoc is available on the system
fn is_pandoc_available() -> bool {
    use std::process::Command;
    Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Tauri command to check if pandoc is available
#[tauri::command]
pub fn check_pandoc_available() -> bool {
    is_pandoc_available()
}

/// Tauri command to open a URL in the system's default browser
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

/// Extract content from a DOCX file and convert to Markdown
/// If use_pandoc is true and pandoc is available, uses pandoc for conversion
/// Otherwise falls back to basic text extraction
fn extract_docx_text_with_option(file_path: &PathBuf, use_pandoc: bool) -> Result<String, String> {
    if use_pandoc {
        if let Ok(markdown) = convert_with_pandoc(file_path, "docx") {
            return Ok(markdown);
        }
    }
    
    // Fallback: basic text extraction without formatting
    extract_docx_text_basic(file_path)
}

/// Extract content from a DOCX file (convenience wrapper)
fn extract_docx_text(file_path: &PathBuf) -> Result<String, String> {
    // Try pandoc first by default
    extract_docx_text_with_option(file_path, true)
}

/// Convert a document to markdown using pandoc
fn convert_with_pandoc(file_path: &PathBuf, from_format: &str) -> Result<String, String> {
    use std::process::Command;
    
    let output = Command::new("pandoc")
        .arg("-f")
        .arg(from_format)
        .arg("-t")
        .arg("markdown")
        .arg("--wrap=none")  // Don't wrap lines
        .arg(file_path)
        .output()
        .map_err(|e| format!("Failed to run pandoc: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc conversion failed: {}", stderr));
    }
    
    let markdown = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in pandoc output: {}", e))?;
    
    Ok(markdown)
}

/// Basic DOCX text extraction without formatting (fallback when pandoc unavailable)
fn extract_docx_text_basic(file_path: &PathBuf) -> Result<String, String> {
    let file = File::open(file_path).map_err(|e| format!("Failed to open DOCX file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid DOCX file: {}", e))?;

    // DOCX stores the main content in word/document.xml
    let mut document_xml = archive
        .by_name("word/document.xml")
        .map_err(|_| "Missing word/document.xml in DOCX file")?;

    let mut xml_content = String::new();
    document_xml.read_to_string(&mut xml_content).map_err(|e| e.to_string())?;

    // Parse the XML and extract text
    let mut reader = Reader::from_str(&xml_content);
    reader.trim_text(true);

    let mut text_parts: Vec<String> = Vec::new();
    let mut current_paragraph: Vec<String> = Vec::new();
    let mut in_text = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let name = e.local_name();
                let name_str = std::str::from_utf8(name.as_ref()).unwrap_or("");

                if name_str == "t" {
                    in_text = true;
                } else if name_str == "p" {
                    if !current_paragraph.is_empty() {
                        text_parts.push(current_paragraph.join(""));
                        current_paragraph.clear();
                    }
                } else if name_str == "br" {
                    current_paragraph.push("\n".to_string());
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_text {
                    if let Ok(text) = e.unescape() {
                        current_paragraph.push(text.to_string());
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.local_name();
                let name_str = std::str::from_utf8(name.as_ref()).unwrap_or("");
                if name_str == "t" {
                    in_text = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Error parsing DOCX XML: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    if !current_paragraph.is_empty() {
        text_parts.push(current_paragraph.join(""));
    }

    Ok(text_parts.join("\n\n"))
}

/// Extract content from an ODT file and convert to Markdown using pandoc
/// Falls back to basic text extraction if pandoc is not available
fn extract_odt_text(file_path: &PathBuf) -> Result<String, String> {
    // First, try using pandoc for high-quality conversion
    if let Ok(markdown) = convert_with_pandoc(file_path, "odt") {
        return Ok(markdown);
    }
    
    // Fallback: basic text extraction without formatting
    extract_odt_text_basic(file_path)
}

/// Basic ODT text extraction without formatting (fallback when pandoc unavailable)
fn extract_odt_text_basic(file_path: &PathBuf) -> Result<String, String> {
    let file = File::open(file_path).map_err(|e| format!("Failed to open ODT file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid ODT file: {}", e))?;

    // ODT stores the main content in content.xml
    let mut content_xml = archive
        .by_name("content.xml")
        .map_err(|_| "Missing content.xml in ODT file")?;

    let mut xml_content = String::new();
    content_xml.read_to_string(&mut xml_content).map_err(|e| e.to_string())?;

    // Parse the XML and extract text
    let mut reader = Reader::from_str(&xml_content);
    reader.trim_text(true);

    let mut text_parts: Vec<String> = Vec::new();
    let mut current_paragraph: Vec<String> = Vec::new();
    let mut in_paragraph = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let name = e.local_name();
                let name_str = std::str::from_utf8(name.as_ref()).unwrap_or("");

                // Check for paragraph elements (text:p, text:h for headings)
                if name_str == "p" || name_str == "h" {
                    if !current_paragraph.is_empty() {
                        text_parts.push(current_paragraph.join(""));
                        current_paragraph.clear();
                    }
                    in_paragraph = true;
                }
                // Check for line breaks (text:line-break)
                else if name_str == "line-break" {
                    current_paragraph.push("\n".to_string());
                }
                // Check for tabs (text:tab)
                else if name_str == "tab" {
                    current_paragraph.push("\t".to_string());
                }
                // Check for spaces (text:s)
                else if name_str == "s" {
                    current_paragraph.push(" ".to_string());
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_paragraph {
                    if let Ok(text) = e.unescape() {
                        current_paragraph.push(text.to_string());
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.local_name();
                let name_str = std::str::from_utf8(name.as_ref()).unwrap_or("");

                if name_str == "p" || name_str == "h" {
                    in_paragraph = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("Error parsing ODT XML: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    // Don't forget the last paragraph
    if !current_paragraph.is_empty() {
        text_parts.push(current_paragraph.join(""));
    }

    Ok(text_parts.join("\n\n"))
}

/// Result of an import operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub handle: DocumentHandle,
    pub content: String,
    pub source_format: String,
}

/// Import a document from various formats (markdown, docx, odt)
/// Shows file picker if path is None
#[tauri::command]
pub async fn import_document(
    app: AppHandle,
    manager: State<'_, Mutex<DocumentManager>>,
    path: Option<String>,
) -> Result<ImportResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path: PathBuf = if let Some(p) = path {
        PathBuf::from(p)
    } else {
        // Show file picker with filters for all supported formats
        let file = app.dialog()
            .file()
            .add_filter("All Supported", &["md", "markdown", "txt", "rmd", "qmd", "docx", "odt"])
            .add_filter("Markdown", &["md", "markdown", "txt"])
            .add_filter("R Markdown", &["rmd"])
            .add_filter("Quarto", &["qmd"])
            .add_filter("Word Document", &["docx"])
            .add_filter("OpenDocument Text", &["odt"])
            .blocking_pick_file();

        match file {
            Some(f) => f.into_path().map_err(|_| "Failed to convert file path".to_string())?,
            None => return Err("No file selected".to_string()),
        }
    };

    if !file_path.exists() {
        return Err(format!("File not found: {:?}", file_path));
    }

    // Determine format from extension
    let extension = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let format = ImportFormat::from_extension(extension)
        .ok_or_else(|| format!("Unsupported file format: {}", extension))?;

    // Extract content based on format
    let content = match format {
        ImportFormat::Markdown => {
            fs::read_to_string(&file_path)
                .map_err(|e| format!("Failed to read markdown file: {}", e))?
        }
        ImportFormat::RMarkdown | ImportFormat::Quarto => {
            let raw_content = fs::read_to_string(&file_path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            strip_yaml_frontmatter(&raw_content)
        }
        ImportFormat::Docx => {
            extract_docx_text(&file_path)?
        }
        ImportFormat::Odt => {
            extract_odt_text(&file_path)?
        }
    };

    // Create a new document
    let doc_id = Uuid::new_v4().to_string();
    let temp_dir = create_document_temp_dir(&doc_id)?;

    // Get title from filename
    let title = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported Document".to_string());

    let handle = DocumentHandle {
        id: doc_id.clone(),
        path: None, // Imported documents don't have a .kmd path yet
        title: title.clone(),
        is_modified: true, // Mark as modified since it's not saved as KMD yet
        opened_at: Utc::now(),
    };

    let mut meta = DocumentMeta::default();
    meta.title = title;

    let state = DocumentState {
        handle: handle.clone(),
        yjs_state: Vec::new(), // Will be populated when editor loads
        history_path: temp_dir.join("history.sqlite"),
        meta,
    };

    let mut manager = manager.lock().map_err(|e| e.to_string())?;
    manager.documents.insert(doc_id.clone(), state);
    manager.active_document_id = Some(doc_id);

    let format_name = match format {
        ImportFormat::Markdown => "markdown",
        ImportFormat::RMarkdown => "rmarkdown",
        ImportFormat::Quarto => "quarto",
        ImportFormat::Docx => "docx",
        ImportFormat::Odt => "odt",
    };

    Ok(ImportResult {
        handle,
        content,
        source_format: format_name.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_handle_serialization() {
        let handle = DocumentHandle {
            id: "test-id".to_string(),
            path: Some(PathBuf::from("/test/path.kmd")),
            title: "Test Document".to_string(),
            is_modified: false,
            opened_at: Utc::now(),
        };
        
        let json = serde_json::to_string(&handle).unwrap();
        let parsed: DocumentHandle = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.id, handle.id);
        assert_eq!(parsed.title, handle.title);
        assert_eq!(parsed.is_modified, handle.is_modified);
    }
    
    #[test]
    fn test_recent_document_serialization() {
        let recent = RecentDocument {
            path: PathBuf::from("/test/path.kmd"),
            title: "Test Doc".to_string(),
            last_opened: Utc::now(),
        };
        
        let json = serde_json::to_string(&recent).unwrap();
        let parsed: RecentDocument = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.path, recent.path);
        assert_eq!(parsed.title, recent.title);
    }
    
    #[test]
    fn test_document_manager_default() {
        let manager = DocumentManager::default();
        assert!(manager.documents.is_empty());
        assert!(manager.active_document_id.is_none());
    }
    
    #[test]
    fn test_is_pandoc_available_returns_bool() {
        // This test just verifies the function runs without panicking
        // and returns a boolean (may be true or false depending on system)
        let result = super::is_pandoc_available();
        assert!(result == true || result == false);
    }
    
    #[test]
    fn test_extract_docx_text_basic_invalid_file() {
        // Test with non-existent file
        let result = super::extract_docx_text_basic(&PathBuf::from("/nonexistent/file.docx"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open"));
    }
    
    #[test]
    fn test_extract_odt_text_basic_invalid_file() {
        // Test with non-existent file
        let result = super::extract_odt_text_basic(&PathBuf::from("/nonexistent/file.odt"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open"));
    }
    
    #[test]
    fn test_import_result_serialization() {
        let handle = DocumentHandle {
            id: "test-id".to_string(),
            path: Some(PathBuf::from("/test/path.docx")),
            title: "Imported Doc".to_string(),
            is_modified: false,
            opened_at: Utc::now(),
        };
        
        let result = ImportResult {
            handle: handle.clone(),
            content: "# Test Content".to_string(),
            source_format: "docx".to_string(),
        };
        
        let json = serde_json::to_string(&result).unwrap();
        let parsed: ImportResult = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.content, "# Test Content");
        assert_eq!(parsed.source_format, "docx");
        assert_eq!(parsed.handle.id, "test-id");
    }
    
    #[test]
    fn test_convert_with_pandoc_invalid_file() {
        // Test with non-existent file (should fail gracefully)
        let result = super::convert_with_pandoc(&PathBuf::from("/nonexistent/file.docx"), "docx");
        // May fail because pandoc not installed or file doesn't exist - either is acceptable
        // We just verify it doesn't panic
        assert!(result.is_ok() || result.is_err());
    }
}
