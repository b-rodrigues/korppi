// src-tauri/src/kmd.rs
//! KMD (Korppi Markdown Document) file format implementation.
//!
//! A KMD file is a ZIP archive containing:
//! - format.json: Format version and compatibility info
//! - state.yjs: Yjs CRDT document state (binary)
//! - history.sqlite: Semantic patch history
//! - meta.json: Document metadata
//! - authors/: Author profile cache

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

use docx_rs::*;
use pulldown_cmark::{Event, Tag, TagEnd, Parser, HeadingLevel, CodeBlockKind};

pub const KMD_VERSION: &str = "0.1.0";
pub const MIN_READER_VERSION: &str = "0.1.0";
pub const APP_NAME: &str = "korppi";
pub const APP_VERSION: &str = "0.1.0";

/// Format information stored in format.json
#[derive(Debug, Serialize, Deserialize)]
pub struct FormatInfo {
    pub kmd_version: String,
    pub min_reader_version: String,
    pub created_by: CreatedBy,
    pub compression: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatedBy {
    pub app: String,
    pub version: String,
}

impl Default for FormatInfo {
    fn default() -> Self {
        Self {
            kmd_version: KMD_VERSION.to_string(),
            min_reader_version: MIN_READER_VERSION.to_string(),
            created_by: CreatedBy {
                app: APP_NAME.to_string(),
                version: APP_VERSION.to_string(),
            },
            compression: "deflate".to_string(),
        }
    }
}

/// Document metadata stored in meta.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocumentMeta {
    pub uuid: String,
    pub title: String,
    pub created_at: String,
    pub modified_at: String,
    pub authors: Vec<AuthorRef>,
    #[serde(default)]
    pub settings: DocumentSettings,
    #[serde(default)]
    pub sync_state: SyncState,
}

impl Default for DocumentMeta {
    fn default() -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            uuid: Uuid::new_v4().to_string(),
            title: "Untitled Document".to_string(),
            created_at: now.clone(),
            modified_at: now,
            authors: Vec::new(),
            settings: DocumentSettings::default(),
            sync_state: SyncState::default(),
        }
    }
}

/// Author reference in document metadata
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthorRef {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub joined_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// Author profile stored in authors/{uuid}.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthorProfile {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

/// Document settings
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DocumentSettings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_true")]
    pub spell_check: bool,
}

fn default_language() -> String {
    "en-US".to_string()
}

fn default_true() -> bool {
    true
}

/// Synchronization state
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SyncState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_export: Option<String>,
    #[serde(default)]
    pub pending_patches: u32,
}

/// Get the path to the Yjs document file
fn get_yjs_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
    path.push("document.yjs");
    path
}

/// Get the path to the history database
fn get_history_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
    path.push("korppi_history.db");
    path
}

/// Get the path to the document metadata file
fn get_meta_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
    path.push("document_meta.json");
    path
}

/// Load or create document metadata
fn load_or_create_meta(app: &AppHandle) -> Result<DocumentMeta, String> {
    let meta_path = get_meta_path(app);
    if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(DocumentMeta::default())
    }
}

/// Save document metadata
fn save_meta(app: &AppHandle, meta: &DocumentMeta) -> Result<(), String> {
    let meta_path = get_meta_path(app);
    let content = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(&meta_path, content).map_err(|e| e.to_string())
}

/// Extract unique authors from patch history
fn extract_authors_from_history(history_path: &PathBuf) -> Result<Vec<AuthorRef>, String> {
    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let conn = Connection::open(history_path).map_err(|e| e.to_string())?;

    // Check if the patches table exists
    let table_exists: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='patches'")
        .map_err(|e| e.to_string())?
        .exists([])
        .map_err(|e| e.to_string())?;

    if !table_exists {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare("SELECT DISTINCT author FROM patches")
        .map_err(|e| e.to_string())?;

    let authors: Vec<AuthorRef> = stmt
        .query_map([], |row| {
            let author_id: String = row.get(0)?;
            Ok(AuthorRef {
                id: author_id.clone(),
                name: author_id, // Use ID as name if not available
                email: None,
                joined_at: None,
                role: Some("contributor".to_string()),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(authors)
}

/// Validate a path component for safety (prevent path traversal)
pub fn is_path_safe(path: &str) -> bool {
    // Check for explicit parent directory patterns (works cross-platform)
    if path.contains("..") {
        return false;
    }

    let normalized = std::path::Path::new(path);

    // Reject absolute paths
    if normalized.is_absolute() {
        return false;
    }

    // Reject paths with parent directory references (double-check with components)
    for component in normalized.components() {
        if let std::path::Component::ParentDir = component {
            return false;
        }
    }

    // Reject paths that start with / or \
    if path.starts_with('/') || path.starts_with('\\') {
        return false;
    }

    true
}

/// Export the current document as a KMD file
#[tauri::command]
pub fn export_kmd(app: AppHandle, path: String) -> Result<DocumentMeta, String> {
    let yjs_path = get_yjs_path(&app);
    let history_path = get_history_path(&app);

    // Load or create document metadata
    let mut meta = load_or_create_meta(&app)?;

    // Update modification timestamp
    meta.modified_at = Utc::now().to_rfc3339();

    // Update sync state
    meta.sync_state.last_export = Some(Utc::now().to_rfc3339());

    // Extract authors from history if not already present
    if meta.authors.is_empty() {
        meta.authors = extract_authors_from_history(&history_path)?;
    }

    // Create the ZIP archive
    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // Write format.json
    let format_info = FormatInfo::default();
    let format_json = serde_json::to_string_pretty(&format_info).map_err(|e| e.to_string())?;
    zip.start_file("format.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(format_json.as_bytes())
        .map_err(|e| e.to_string())?;

    // Write state.yjs (if exists)
    if yjs_path.exists() {
        let yjs_data = fs::read(&yjs_path).map_err(|e| e.to_string())?;
        zip.start_file("state.yjs", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&yjs_data).map_err(|e| e.to_string())?;
    }

    // Write history.sqlite (if exists)
    if history_path.exists() {
        let history_data = fs::read(&history_path).map_err(|e| e.to_string())?;
        zip.start_file("history.sqlite", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&history_data).map_err(|e| e.to_string())?;
    }

    // Write meta.json
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    zip.start_file("meta.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(meta_json.as_bytes())
        .map_err(|e| e.to_string())?;

    // Write authors directory
    zip.add_directory("authors/", options)
        .map_err(|e| e.to_string())?;

    // Write author profiles
    for author in &meta.authors {
        let profile = AuthorProfile {
            id: author.id.clone(),
            name: author.name.clone(),
            email: author.email.clone(),
            color: "#3498db".to_string(),
            avatar_base64: None,
            public_key: None,
        };
        let profile_json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
        let author_file = format!("authors/{}.json", author.id);
        zip.start_file(&author_file, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(profile_json.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    // Finalize the archive
    zip.finish().map_err(|e| e.to_string())?;

    // Save updated metadata
    save_meta(&app, &meta)?;

    Ok(meta)
}

/// Check if the KMD version is compatible
pub fn check_version_compatibility(format_info: &FormatInfo) -> Result<(), String> {
    // Simple version check: parse as semver-like (handles 0.1.0, 1.0, 2.0.0-beta.1, etc.)
    // Extract major.minor.patch numbers, treating missing parts as 0
    fn parse_version(v: &str) -> (u32, u32, u32) {
        let parts: Vec<u32> = v
            .split('.')
            .take(3)
            .map(|s| {
                // Handle prerelease suffixes like "0-beta" by taking only the numeric part
                s.split('-')
                    .next()
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0)
            })
            .collect();
        (
            *parts.first().unwrap_or(&0),
            *parts.get(1).unwrap_or(&0),
            *parts.get(2).unwrap_or(&0),
        )
    }

    let min_version = parse_version(&format_info.min_reader_version);
    let our_version = parse_version(KMD_VERSION);

    // Check major.minor.patch compatibility
    // Major version must match or be higher
    if min_version.0 > our_version.0 {
        return Err(format!(
            "KMD version {} requires reader version {} or higher. Current: {}",
            format_info.kmd_version, format_info.min_reader_version, KMD_VERSION
        ));
    }

    // If major matches, check minor
    if min_version.0 == our_version.0 && min_version.1 > our_version.1 {
        return Err(format!(
            "KMD version {} requires reader version {} or higher. Current: {}",
            format_info.kmd_version, format_info.min_reader_version, KMD_VERSION
        ));
    }

    // If major.minor matches, check patch
    if min_version.0 == our_version.0
        && min_version.1 == our_version.1
        && min_version.2 > our_version.2
    {
        return Err(format!(
            "KMD version {} requires reader version {} or higher. Current: {}",
            format_info.kmd_version, format_info.min_reader_version, KMD_VERSION
        ));
    }

    Ok(())
}

/// Merge patches from imported database, avoiding duplicates
pub fn merge_history(
    local_path: &PathBuf,
    imported_data: &[u8],
    temp_dir: &std::path::Path,
) -> Result<(), String> {
    // Write imported data to temp file
    let temp_db_path = temp_dir.join("imported_history.sqlite");
    fs::write(&temp_db_path, imported_data).map_err(|e| e.to_string())?;

    // Open both databases
    let local_conn = Connection::open(local_path).map_err(|e| e.to_string())?;

    // Ensure local table exists
    local_conn
        .execute_batch(
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

    let imported_conn = Connection::open(&temp_db_path).map_err(|e| e.to_string())?;

    // Read patches from imported database
    let mut imported_stmt = imported_conn
        .prepare("SELECT timestamp, author, kind, data FROM patches")
        .map_err(|e| e.to_string())?;

    let patches: Vec<(i64, String, String, String)> = imported_stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Insert patches that don't already exist (check by timestamp + author + kind)
    for (timestamp, author, kind, data) in patches {
        let exists: bool = local_conn
            .prepare("SELECT 1 FROM patches WHERE timestamp = ?1 AND author = ?2 AND kind = ?3")
            .map_err(|e| e.to_string())?
            .exists(params![timestamp, &author, &kind])
            .map_err(|e| e.to_string())?;

        if !exists {
            local_conn
                .execute(
                    "INSERT INTO patches (timestamp, author, kind, data) VALUES (?1, ?2, ?3, ?4)",
                    params![timestamp, author, kind, data],
                )
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Import a KMD file, merging with current document state
#[tauri::command]
pub fn import_kmd(app: AppHandle, path: String) -> Result<DocumentMeta, String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid ZIP archive: {}", e))?;

    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;

    // Read and validate format.json
    let format_info: FormatInfo = {
        let mut format_file = archive
            .by_name("format.json")
            .map_err(|_| "Missing format.json in KMD file")?;
        let mut content = String::new();
        format_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid format.json: {}", e))?
    };

    check_version_compatibility(&format_info)?;

    // Read meta.json
    let imported_meta: DocumentMeta = {
        let mut meta_file = archive
            .by_name("meta.json")
            .map_err(|_| "Missing meta.json in KMD file")?;
        let mut content = String::new();
        meta_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("Invalid meta.json: {}", e))?
    };

    let yjs_path = get_yjs_path(&app);
    let history_path = get_history_path(&app);

    // Ensure app data directory exists
    if let Some(parent) = yjs_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Import state.yjs - overwrite current state (TODO: merge with Yjs on frontend)
    if let Ok(mut state_file) = archive.by_name("state.yjs") {
        let mut state_data = Vec::new();
        state_file
            .read_to_end(&mut state_data)
            .map_err(|e| e.to_string())?;
        fs::write(&yjs_path, &state_data).map_err(|e| e.to_string())?;
    }

    // Import history.sqlite - merge patches
    if let Ok(mut history_file) = archive.by_name("history.sqlite") {
        let mut history_data = Vec::new();
        history_file
            .read_to_end(&mut history_data)
            .map_err(|e| e.to_string())?;
        merge_history(&history_path, &history_data, temp_dir.path())?;
    }

    // Import author profiles from authors/ directory
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.starts_with("authors/") && name.ends_with(".json") {
            // Validate path safety
            if !is_path_safe(&name) {
                continue;
            }

            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| e.to_string())?;

            // Parse and cache author profile (for now, just log it)
            if let Ok(_profile) = serde_json::from_str::<AuthorProfile>(&content) {
                // TODO: Cache author profile for display
                log::debug!("Imported author profile from {}", name);
            }
        }
    }

    // Update local metadata with merged authors
    let mut local_meta = load_or_create_meta(&app)?;

    // Merge authors (avoid duplicates by ID)
    let mut author_map: std::collections::HashMap<String, AuthorRef> = std::collections::HashMap::new();
    for author in local_meta.authors {
        author_map.insert(author.id.clone(), author);
    }
    for author in imported_meta.authors.clone() {
        author_map.insert(author.id.clone(), author);
    }
    local_meta.authors = author_map.into_values().collect();

    // Update title if local is default
    if local_meta.title == "Untitled Document" {
        local_meta.title = imported_meta.title.clone();
    }

    local_meta.modified_at = Utc::now().to_rfc3339();

    save_meta(&app, &local_meta)?;

    Ok(imported_meta)
}

/// Get current document metadata
#[tauri::command]
pub fn get_document_meta(app: AppHandle) -> Result<DocumentMeta, String> {
    load_or_create_meta(&app)
}

/// Update document title
#[tauri::command]
pub fn set_document_title(app: AppHandle, title: String) -> Result<(), String> {
    let mut meta = load_or_create_meta(&app)?;
    meta.title = title;
    meta.modified_at = Utc::now().to_rfc3339();
    save_meta(&app, &meta)
}

/// Write text content to a file (for markdown export)
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Export markdown content to a file
#[tauri::command]
pub fn export_markdown(path: String, content: String) -> Result<(), String> {
    write_text_file(path, content)
}

/// Convert markdown to DOCX format
fn markdown_to_docx(markdown: &str) -> Result<Docx, String> {
    let mut docx = Docx::new();
    let parser = Parser::new(markdown);
    
    let mut current_paragraph = Paragraph::new();
    let mut current_text = String::new();
    let mut in_paragraph = false;
    let mut list_items: Vec<Paragraph> = Vec::new();
    let mut in_list = false;
    let mut is_ordered_list = false;
    
    // Stack to track formatting
    let mut bold_depth: i32 = 0;
    let mut italic_depth: i32 = 0;
    let mut in_code_block = false;
    let mut code_text = String::new();
    let mut paragraph_style: Option<String> = None;
    
    // Helper function to flush current text with formatting
    let flush_text = |para: Paragraph, text: &str, is_bold: bool, is_italic: bool| -> Paragraph {
        if text.is_empty() {
            return para;
        }
        let mut run = Run::new().add_text(text);
        if is_bold {
            run = run.bold();
        }
        if is_italic {
            run = run.italic();
        }
        para.add_run(run)
    };
    
    for event in parser {
        match event {
            Event::Start(tag) => {
                match tag {
                    Tag::Heading { level, .. } => {
                        // Flush any existing paragraph
                        if in_paragraph && !current_text.is_empty() {
                            current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                            current_text.clear();
                        }
                        if in_paragraph {
                            docx = docx.add_paragraph(current_paragraph);
                            current_paragraph = Paragraph::new();
                            in_paragraph = false;
                        }
                        
                        // Create heading with appropriate level
                        let heading_level = match level {
                            HeadingLevel::H1 => 1,
                            HeadingLevel::H2 => 2,
                            HeadingLevel::H3 => 3,
                            HeadingLevel::H4 => 4,
                            HeadingLevel::H5 => 5,
                            HeadingLevel::H6 => 6,
                        };
                        paragraph_style = Some(format!("Heading{}", heading_level));
                        current_paragraph = Paragraph::new();
                        in_paragraph = true;
                    }
                    Tag::Paragraph => {
                        in_paragraph = true;
                        paragraph_style = None;
                    }
                    Tag::Strong => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                            current_text.clear();
                        }
                        bold_depth += 1;
                    }
                    Tag::Emphasis => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                            current_text.clear();
                        }
                        italic_depth += 1;
                    }
                    Tag::List(start_num) => {
                        in_list = true;
                        is_ordered_list = start_num.is_some();
                    }
                    Tag::Item => {
                        // Start a new list item
                        current_paragraph = Paragraph::new();
                        in_paragraph = true;
                    }
                    Tag::CodeBlock(CodeBlockKind::Fenced(_)) | Tag::CodeBlock(CodeBlockKind::Indented) => {
                        in_code_block = true;
                        code_text.clear();
                    }
                    Tag::BlockQuote(_) => {
                        paragraph_style = Some("Quote".to_string());
                        current_paragraph = Paragraph::new();
                        in_paragraph = true;
                    }
                    _ => {}
                }
            }
            Event::End(tag) => {
                match tag {
                    TagEnd::Heading(_) | TagEnd::Paragraph => {
                        if in_paragraph {
                            if !current_text.is_empty() {
                                current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                                current_text.clear();
                            }
                            
                            // Apply style if any
                            if let Some(ref style) = paragraph_style {
                                current_paragraph = current_paragraph.style(style);
                            }
                            
                            if in_list {
                                list_items.push(current_paragraph);
                            } else {
                                docx = docx.add_paragraph(current_paragraph);
                            }
                            
                            current_paragraph = Paragraph::new();
                            in_paragraph = false;
                            paragraph_style = None;
                        }
                    }
                    TagEnd::Strong => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                            current_text.clear();
                        }
                        bold_depth = bold_depth.saturating_sub(1);
                    }
                    TagEnd::Emphasis => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                            current_text.clear();
                        }
                        italic_depth = italic_depth.saturating_sub(1);
                    }
                    TagEnd::List(_) => {
                        // Add all collected list items
                        for item in list_items.drain(..) {
                            let indented_item = if is_ordered_list {
                                item.numbering(
                                    NumberingId::new(2),
                                    IndentLevel::new(0),
                                )
                            } else {
                                item.numbering(
                                    NumberingId::new(1),
                                    IndentLevel::new(0),
                                )
                            };
                            docx = docx.add_paragraph(indented_item);
                        }
                        in_list = false;
                        is_ordered_list = false;
                    }
                    TagEnd::Item => {
                        // Item end is handled by paragraph end
                    }
                    TagEnd::CodeBlock => {
                        if in_code_block {
                            // Add code block as paragraph with monospace font
                            let code_para = Paragraph::new()
                                .add_run(
                                    Run::new()
                                        .add_text(&code_text)
                                        .fonts(RunFonts::new().ascii("Courier New"))
                                        .size(20)
                                );
                            docx = docx.add_paragraph(code_para);
                            in_code_block = false;
                            code_text.clear();
                        }
                    }
                    TagEnd::BlockQuote(_) => {
                        if in_paragraph {
                            if !current_text.is_empty() {
                                current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                                current_text.clear();
                            }
                            if let Some(ref style) = paragraph_style {
                                current_paragraph = current_paragraph.style(style);
                            }
                            docx = docx.add_paragraph(current_paragraph);
                            current_paragraph = Paragraph::new();
                            in_paragraph = false;
                            paragraph_style = None;
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(text) => {
                if in_code_block {
                    code_text.push_str(&text);
                } else {
                    current_text.push_str(&text);
                }
            }
            Event::Code(code) => {
                // Inline code - flush current text first
                if !current_text.is_empty() {
                    current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
                    current_text.clear();
                }
                let code_run = Run::new()
                    .add_text(&code.to_string())
                    .fonts(RunFonts::new().ascii("Courier New"))
                    .size(20);
                current_paragraph = current_paragraph.add_run(code_run);
            }
            Event::SoftBreak | Event::HardBreak => {
                if in_code_block {
                    code_text.push('\n');
                } else {
                    current_text.push(' ');
                }
            }
            _ => {}
        }
    }
    
    // Flush any remaining content
    if !current_text.is_empty() {
        current_paragraph = flush_text(current_paragraph, &current_text, bold_depth > 0, italic_depth > 0);
    }
    if in_paragraph {
        if let Some(ref style) = paragraph_style {
            current_paragraph = current_paragraph.style(style);
        }
        docx = docx.add_paragraph(current_paragraph);
    }
    
    Ok(docx)
}

/// Export markdown content as a DOCX file
#[tauri::command]
pub fn export_docx(path: String, content: String) -> Result<(), String> {
    let docx = markdown_to_docx(&content)?;
    
    let file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;
    docx.build()
        .pack(file)
        .map_err(|e| format!("Failed to write DOCX: {}", e))?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_info_default() {
        let format = FormatInfo::default();
        assert_eq!(format.kmd_version, KMD_VERSION);
        assert_eq!(format.min_reader_version, MIN_READER_VERSION);
        assert_eq!(format.created_by.app, APP_NAME);
        assert_eq!(format.compression, "deflate");
    }

    #[test]
    fn test_document_meta_default() {
        let meta = DocumentMeta::default();
        assert!(!meta.uuid.is_empty());
        assert_eq!(meta.title, "Untitled Document");
        assert!(meta.authors.is_empty());
    }

    #[test]
    fn test_version_compatibility_ok() {
        let format = FormatInfo {
            kmd_version: "0.1.0".to_string(),
            min_reader_version: "0.1.0".to_string(),
            created_by: CreatedBy {
                app: "test".to_string(),
                version: "1.0.0".to_string(),
            },
            compression: "deflate".to_string(),
        };
        assert!(check_version_compatibility(&format).is_ok());
    }

    #[test]
    fn test_version_compatibility_short_version() {
        // Test with short version like "0.1" instead of "0.1.0"
        let format = FormatInfo {
            kmd_version: "0.1".to_string(),
            min_reader_version: "0.1".to_string(),
            created_by: CreatedBy {
                app: "test".to_string(),
                version: "1.0.0".to_string(),
            },
            compression: "deflate".to_string(),
        };
        assert!(check_version_compatibility(&format).is_ok());
    }

    #[test]
    fn test_version_compatibility_prerelease() {
        // Test with prerelease version like "0.1.0-beta.1"
        let format = FormatInfo {
            kmd_version: "0.1.0-beta.1".to_string(),
            min_reader_version: "0.1.0-beta.1".to_string(),
            created_by: CreatedBy {
                app: "test".to_string(),
                version: "1.0.0".to_string(),
            },
            compression: "deflate".to_string(),
        };
        assert!(check_version_compatibility(&format).is_ok());
    }

    #[test]
    fn test_version_compatibility_fail() {
        let format = FormatInfo {
            kmd_version: "2.0.0".to_string(),
            min_reader_version: "2.0.0".to_string(),
            created_by: CreatedBy {
                app: "test".to_string(),
                version: "1.0.0".to_string(),
            },
            compression: "deflate".to_string(),
        };
        assert!(check_version_compatibility(&format).is_err());
    }

    #[test]
    fn test_path_safety() {
        assert!(is_path_safe("format.json"));
        assert!(is_path_safe("authors/uuid.json"));
        assert!(!is_path_safe("../etc/passwd"));
        assert!(!is_path_safe("/etc/passwd"));
        assert!(!is_path_safe("..\\Windows\\System32"));
    }

    #[test]
    fn test_format_info_serialization() {
        let format = FormatInfo::default();
        let json = serde_json::to_string_pretty(&format).unwrap();
        let parsed: FormatInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.kmd_version, format.kmd_version);
    }

    #[test]
    fn test_document_meta_serialization() {
        let meta = DocumentMeta {
            uuid: "test-uuid".to_string(),
            title: "Test Doc".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            modified_at: "2024-01-01T00:00:00Z".to_string(),
            authors: vec![AuthorRef {
                id: "author-1".to_string(),
                name: "Test Author".to_string(),
                email: Some("test@example.com".to_string()),
                joined_at: None,
                role: Some("owner".to_string()),
            }],
            settings: DocumentSettings::default(),
            sync_state: SyncState::default(),
        };

        let json = serde_json::to_string_pretty(&meta).unwrap();
        let parsed: DocumentMeta = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.uuid, meta.uuid);
        assert_eq!(parsed.title, meta.title);
        assert_eq!(parsed.authors.len(), 1);
        assert_eq!(parsed.authors[0].name, "Test Author");
    }

    #[test]
    fn test_author_profile_serialization() {
        let profile = AuthorProfile {
            id: "uuid-123".to_string(),
            name: "Alice".to_string(),
            email: Some("alice@example.com".to_string()),
            color: "#FF6B6B".to_string(),
            avatar_base64: None,
            public_key: None,
        };

        let json = serde_json::to_string_pretty(&profile).unwrap();
        let parsed: AuthorProfile = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, profile.id);
        assert_eq!(parsed.color, profile.color);
    }
}
