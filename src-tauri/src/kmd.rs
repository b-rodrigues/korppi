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
use std::io::Write;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use zip::write::FileOptions;
use zip::ZipWriter;

use docx_rs::*;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::Regex;
use std::collections::HashMap;

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
fn get_yjs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    path.push("document.yjs");
    Ok(path)
}

/// Get the path to the history database
fn get_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    path.push("korppi_history.db");
    Ok(path)
}

/// Get the path to the document metadata file
fn get_meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    path.push("document_meta.json");
    Ok(path)
}

/// Load or create document metadata
fn load_or_create_meta(app: &AppHandle) -> Result<DocumentMeta, String> {
    let meta_path = get_meta_path(app)?;
    if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(DocumentMeta::default())
    }
}

/// Save document metadata
fn save_meta(app: &AppHandle, meta: &DocumentMeta) -> Result<(), String> {
    let meta_path = get_meta_path(app)?;
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
    let yjs_path = get_yjs_path(&app)?;
    let history_path = get_history_path(&app)?;

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
                s.split('-').next().unwrap_or("0").parse().unwrap_or(0)
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

// merge_history and import_kmd have been removed as legacy functions.
// Use open_document (DocumentManager) and import_patches_from_document (PatchLog) instead.

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

/// Cross-reference registries for figures, sections, and tables
#[derive(Debug, Clone, Default)]
struct CrossRefRegistry {
    figures: HashMap<String, u32>,
    sections: HashMap<String, u32>,
    tables: HashMap<String, u32>,
}

/// Build registries for all cross-reference types by scanning the markdown
fn build_crossref_registry(markdown: &str) -> CrossRefRegistry {
    let mut registry = CrossRefRegistry::default();
    let mut fig_counter = 0u32;
    let mut sec_counter = 0u32;
    let mut tbl_counter = 0u32;

    // Remove fenced code blocks and inline code before scanning to avoid matching examples
    let code_block_re = Regex::new(r"(?s)```.*?```").unwrap();
    let markdown_no_code = code_block_re.replace_all(markdown, "");
    // Also remove inline code (backticks)
    let inline_code_re = Regex::new(r"`[^`]+`").unwrap();
    let markdown_no_code = inline_code_re.replace_all(&markdown_no_code, "");

    // Match figure syntax: ![caption](url){#fig:label}
    let figure_re = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}").unwrap();
    for caps in figure_re.captures_iter(&markdown_no_code) {
        if let Some(label_match) = caps.get(3) {
            let label = label_match.as_str().to_string();
            if !registry.figures.contains_key(&label) {
                fig_counter += 1;
                registry.figures.insert(label, fig_counter);
            }
        }
    }

    // Match section syntax: # Heading {#sec:label}
    let section_re = Regex::new(r"(?m)^#{1,6}\s+.*\{#(sec:[^}]+)\}").unwrap();
    for caps in section_re.captures_iter(&markdown_no_code) {
        if let Some(label_match) = caps.get(1) {
            let label = label_match.as_str().to_string();
            if !registry.sections.contains_key(&label) {
                sec_counter += 1;
                registry.sections.insert(label, sec_counter);
            }
        }
    }

    // Match table syntax: {#tbl:label}
    let table_re = Regex::new(r"\{#(tbl:[^}]+)\}").unwrap();
    for caps in table_re.captures_iter(&markdown_no_code) {
        if let Some(label_match) = caps.get(1) {
            let label = label_match.as_str().to_string();
            if !registry.tables.contains_key(&label) {
                tbl_counter += 1;
                registry.tables.insert(label, tbl_counter);
            }
        }
    }

    registry
}

/// Get reference text for a label
fn get_reference_text(label: &str, registry: &CrossRefRegistry) -> String {
    if label.starts_with("fig:") {
        if let Some(&num) = registry.figures.get(label) {
            return format!("Figure {}", num);
        }
    } else if label.starts_with("sec:") {
        if let Some(&num) = registry.sections.get(label) {
            return format!("Section {}", num);
        }
    } else if label.starts_with("tbl:") {
        if let Some(&num) = registry.tables.get(label) {
            return format!("Table {}", num);
        }
    }
    format!("[{}]", label)
}

/// Pre-process markdown to handle cross-references
/// - Replaces @fig:label with "Figure N"
/// - Replaces @sec:label with "Section N"
/// - Replaces @tbl:label with "Table N"
/// - Removes {#sec:label} from headings
/// - Removes {#tbl:label} from after tables
/// - Converts ![caption](url){#fig:label} to standard ![caption](url)
fn preprocess_markdown_for_docx(markdown: &str, registry: &CrossRefRegistry) -> String {
    let mut result = markdown.to_string();

    // Replace all cross-references: @fig:label, @sec:label, @tbl:label
    let ref_re = Regex::new(r"@((?:fig|sec|tbl):[a-zA-Z0-9_-]+)").unwrap();
    result = ref_re
        .replace_all(&result, |caps: &regex::Captures| {
            let label = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            get_reference_text(label, registry)
        })
        .to_string();

    // Convert figure syntax: ![caption](url){#fig:label} -> ![caption](url)
    // This allows pandoc to properly embed the image
    let fig_re = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)\{#fig:[^}]+\}").unwrap();
    result = fig_re.replace_all(&result, "![$1]($2)").to_string();

    // Remove {#sec:label} from headings (keep the heading text)
    let sec_label_re = Regex::new(r"(\s*)\{#sec:[^}]+\}").unwrap();
    result = sec_label_re.replace_all(&result, "").to_string();

    // Remove standalone {#tbl:label} lines or inline occurrences
    let tbl_label_re = Regex::new(r"\s*\{#tbl:[^}]+\}").unwrap();
    result = tbl_label_re.replace_all(&result, "").to_string();

    result
}

/// Extract figure info from parsed text (alt text followed by {#fig:label})
/// This handles text collected from pulldown-cmark events
fn extract_figure_from_parsed_text(text: &str) -> Option<(String, String)> {
    let figure_re = Regex::new(r"^(.*?)\{#(fig:[^}]+)\}$").unwrap();
    if let Some(caps) = figure_re.captures(text.trim()) {
        let caption = caps
            .get(1)
            .map(|m| m.as_str().trim())
            .unwrap_or("")
            .to_string();
        let label = caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
        Some((caption, label))
    } else {
        None
    }
}

/// Convert markdown to DOCX format
fn markdown_to_docx(markdown: &str) -> Result<Docx, String> {
    // Build cross-reference registry for all types (figures, sections, tables)
    let crossref_registry = build_crossref_registry(markdown);

    // Pre-process markdown to resolve cross-references
    let processed_markdown = preprocess_markdown_for_docx(markdown, &crossref_registry);

    let mut docx = Docx::new();

    let mut current_paragraph = Paragraph::new();
    let mut current_text = String::new();
    let mut in_paragraph = false;
    let mut list_items: Vec<Paragraph> = Vec::new();
    let mut in_list = false;
    let mut is_ordered_list = false;

    // Stack to track formatting
    let mut bold_depth: i32 = 0;
    let mut italic_depth: i32 = 0;
    let mut strikethrough_depth: i32 = 0;
    let mut in_code_block = false;
    let mut code_text = String::new();
    let mut paragraph_style: Option<String> = None;

    // Helper function to flush current text with formatting
    let flush_text = |para: Paragraph,
                      text: &str,
                      is_bold: bool,
                      is_italic: bool,
                      is_strike: bool|
     -> Paragraph {
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
        if is_strike {
            run = run.strike();
        }
        para.add_run(run)
    };

    // Enable GFM extensions (strikethrough)
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    let parser = Parser::new_ext(&processed_markdown, options);

    for event in parser {
        match event {
            Event::Start(tag) => {
                match tag {
                    Tag::Heading { level, .. } => {
                        // Flush any existing paragraph
                        if in_paragraph && !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        if in_paragraph {
                            docx = docx.add_paragraph(current_paragraph);
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
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        bold_depth += 1;
                    }
                    Tag::Emphasis => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        italic_depth += 1;
                    }
                    Tag::Strikethrough => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        strikethrough_depth += 1;
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
                    Tag::CodeBlock(CodeBlockKind::Fenced(_))
                    | Tag::CodeBlock(CodeBlockKind::Indented) => {
                        in_code_block = true;
                        code_text.clear();
                    }
                    Tag::BlockQuote(_) => {
                        paragraph_style = Some("Quote".to_string());
                        current_paragraph = Paragraph::new();
                        in_paragraph = true;
                    }
                    Tag::Image { .. } => {
                        // Images are handled at the Event::End
                    }
                    _ => {}
                }
            }
            Event::End(tag) => {
                match tag {
                    TagEnd::Heading(_) | TagEnd::Paragraph => {
                        if in_paragraph {
                            // Check if this paragraph is a figure
                            let full_text = current_text.trim().to_string();
                            if let Some((caption, label)) =
                                extract_figure_from_parsed_text(&full_text)
                            {
                                // This is a figure - output it as such
                                let fig_num =
                                    crossref_registry.figures.get(&label).copied().unwrap_or(0);

                                // Create centered paragraph for the figure placeholder
                                let figure_para = Paragraph::new()
                                    .add_run(Run::new().add_text(format!("[Image: {}]", caption)))
                                    .align(AlignmentType::Center);
                                docx = docx.add_paragraph(figure_para);

                                // Create caption paragraph
                                let caption_text = if fig_num > 0 {
                                    format!("Figure {}: {}", fig_num, caption)
                                } else {
                                    format!("Figure: {}", caption)
                                };
                                let caption_para = Paragraph::new()
                                    .add_run(Run::new().add_text(caption_text).italic())
                                    .align(AlignmentType::Center)
                                    .style("Caption");
                                docx = docx.add_paragraph(caption_para);

                                current_text.clear();
                                current_paragraph = Paragraph::new();
                                in_paragraph = false;
                                paragraph_style = None;
                            } else {
                                // Regular paragraph
                                if !current_text.is_empty() {
                                    current_paragraph = flush_text(
                                        current_paragraph,
                                        &current_text,
                                        bold_depth > 0,
                                        italic_depth > 0,
                                        strikethrough_depth > 0,
                                    );
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
                    }
                    TagEnd::Strong => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        bold_depth = bold_depth.saturating_sub(1);
                    }
                    TagEnd::Emphasis => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        italic_depth = italic_depth.saturating_sub(1);
                    }
                    TagEnd::Strikethrough => {
                        // Flush current text before changing format
                        if !current_text.is_empty() {
                            current_paragraph = flush_text(
                                current_paragraph,
                                &current_text,
                                bold_depth > 0,
                                italic_depth > 0,
                                strikethrough_depth > 0,
                            );
                            current_text.clear();
                        }
                        strikethrough_depth = strikethrough_depth.saturating_sub(1);
                    }
                    TagEnd::List(_) => {
                        // Add all collected list items
                        for item in list_items.drain(..) {
                            let indented_item = if is_ordered_list {
                                item.numbering(NumberingId::new(2), IndentLevel::new(0))
                            } else {
                                item.numbering(NumberingId::new(1), IndentLevel::new(0))
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
                            let code_para = Paragraph::new().add_run(
                                Run::new()
                                    .add_text(&code_text)
                                    .fonts(RunFonts::new().ascii("Courier New"))
                                    .size(20),
                            );
                            docx = docx.add_paragraph(code_para);
                            in_code_block = false;
                            code_text.clear();
                        }
                    }
                    TagEnd::BlockQuote(_) => {
                        if in_paragraph {
                            if !current_text.is_empty() {
                                current_paragraph = flush_text(
                                    current_paragraph,
                                    &current_text,
                                    bold_depth > 0,
                                    italic_depth > 0,
                                    strikethrough_depth > 0,
                                );
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
                    TagEnd::Image => {
                        // Image was already processed through the text events
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
                    current_paragraph = flush_text(
                        current_paragraph,
                        &current_text,
                        bold_depth > 0,
                        italic_depth > 0,
                        strikethrough_depth > 0,
                    );
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
        current_paragraph = flush_text(
            current_paragraph,
            &current_text,
            bold_depth > 0,
            italic_depth > 0,
            strikethrough_depth > 0,
        );
    }
    if in_paragraph {
        if let Some(ref style) = paragraph_style {
            current_paragraph = current_paragraph.style(style);
        }
        docx = docx.add_paragraph(current_paragraph);
    }

    Ok(docx)
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

/// Export markdown to DOCX using pandoc
fn export_with_pandoc(path: &str, content: &str) -> Result<(), String> {
    use std::process::{Command, Stdio};
    use std::io::Write;
    
    // Preprocess the markdown to convert custom syntax to standard markdown
    let crossref_registry = build_crossref_registry(content);
    let mut processed_content = preprocess_markdown_for_docx(content, &crossref_registry);
    
    // Convert Tauri asset:// URLs back to absolute paths for pandoc
    // asset://localhost/%2Fpath%2Fto%2Ffile -> /path/to/file
    let asset_url_re = Regex::new(r"asset://localhost/(%[0-9A-Fa-f]{2}[^)\s]*)").unwrap();
    processed_content = asset_url_re.replace_all(&processed_content, |caps: &regex::Captures| {
        let encoded_path = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        // Simple percent-decoding
        let mut decoded = String::new();
        let mut chars = encoded_path.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '%' {
                let hex: String = chars.by_ref().take(2).collect();
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    decoded.push(byte as char);
                } else {
                    decoded.push('%');
                    decoded.push_str(&hex);
                }
            } else {
                decoded.push(c);
            }
        }
        decoded
    }).to_string();
    
    let mut child = Command::new("pandoc")
        .arg("-f")
        .arg("markdown")
        .arg("-t")
        .arg("docx")
        .arg("-o")
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pandoc: {}", e))?;
    
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(processed_content.as_bytes())
            .map_err(|e| format!("Failed to write to pandoc stdin: {}", e))?;
    }
    
    let status = child.wait()
        .map_err(|e| format!("Failed to wait for pandoc: {}", e))?;
    
    if !status.success() {
        return Err("Pandoc conversion failed".to_string());
    }
    
    Ok(())
}

/// Export markdown content as a DOCX file
/// Uses pandoc if available for better quality output, falls back to docx_rs library
#[tauri::command]
pub fn export_docx(path: String, content: String) -> Result<(), String> {
    // Try pandoc first for better quality output
    if is_pandoc_available() {
        return export_with_pandoc(&path, &content);
    }
    
    // Fallback to Rust docx_rs library
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

    #[test]
    fn test_markdown_to_docx_basic() {
        let markdown = "# Heading 1\n\nThis is a paragraph with **bold** and *italic* text.";
        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_lists() {
        let markdown = "# Lists\n\n- Item 1\n- Item 2\n\n1. First\n2. Second";
        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_code() {
        let markdown = "# Code\n\nInline `code` and:\n\n```\ncode block\n```";
        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_blockquote() {
        let markdown = "> This is a quote\n> with multiple lines";
        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_export_docx_creates_file() {
        use std::fs;
        use tempfile::tempdir;

        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.docx");
        let path_str = file_path.to_str().unwrap().to_string();

        let markdown = "# Test Document\n\nThis is a test.";
        let result = export_docx(path_str.clone(), markdown.to_string());

        assert!(result.is_ok());
        assert!(file_path.exists());

        // Check file is not empty
        let metadata = fs::metadata(&file_path).unwrap();
        assert!(metadata.len() > 0);
    }

    #[test]
    fn test_build_crossref_registry() {
        let markdown = r#"
# Introduction {#sec:intro}

![Chart showing sales data](chart.png){#fig:sales}

Some text here.

## Methods {#sec:methods}

![Another chart](chart2.png){#fig:revenue}

| Col1 | Col2 |
|------|------|
| A    | B    |

{#tbl:data}

See @fig:sales for the sales data.
"#;

        let registry = build_crossref_registry(markdown);
        assert_eq!(registry.figures.len(), 2);
        assert_eq!(registry.figures.get("fig:sales"), Some(&1));
        assert_eq!(registry.figures.get("fig:revenue"), Some(&2));
        assert_eq!(registry.sections.len(), 2);
        assert_eq!(registry.sections.get("sec:intro"), Some(&1));
        assert_eq!(registry.sections.get("sec:methods"), Some(&2));
        assert_eq!(registry.tables.len(), 1);
        assert_eq!(registry.tables.get("tbl:data"), Some(&1));
    }

    #[test]
    fn test_preprocess_cross_references() {
        let markdown = "See @fig:test for details. Also check @sec:intro and @tbl:data.";
        let mut registry = CrossRefRegistry::default();
        registry.figures.insert("fig:test".to_string(), 1);
        registry.sections.insert("sec:intro".to_string(), 2);
        registry.tables.insert("tbl:data".to_string(), 3);

        let result = preprocess_markdown_for_docx(markdown, &registry);

        assert!(result.contains("Figure 1"));
        assert!(result.contains("Section 2"));
        assert!(result.contains("Table 3"));
        assert!(!result.contains("@fig:test"));
        assert!(!result.contains("@sec:intro"));
        assert!(!result.contains("@tbl:data"));
    }

    #[test]
    fn test_preprocess_unresolved_reference() {
        let markdown = "See @fig:missing and @sec:unknown for details.";
        let registry = CrossRefRegistry::default();

        let result = preprocess_markdown_for_docx(markdown, &registry);

        assert!(result.contains("[fig:missing]"));
        assert!(result.contains("[sec:unknown]"));
    }

    #[test]
    fn test_preprocess_removes_section_labels() {
        let markdown = "# Introduction {#sec:intro}\n\nSome text.";
        let registry = CrossRefRegistry::default();

        let result = preprocess_markdown_for_docx(markdown, &registry);

        assert!(!result.contains("{#sec:intro}"));
        assert!(result.contains("# Introduction"));
    }

    #[test]
    fn test_preprocess_removes_table_labels() {
        let markdown = "| A | B |\n|---|---|\n| 1 | 2 |\n\n{#tbl:data}";
        let registry = CrossRefRegistry::default();

        let result = preprocess_markdown_for_docx(markdown, &registry);

        assert!(!result.contains("{#tbl:data}"));
    }

    #[test]
    fn test_extract_figure_from_parsed_text() {
        // Figure with label
        let text = "My Chart Caption{#fig:chart1}";
        let result = extract_figure_from_parsed_text(text);
        assert!(result.is_some());
        let (caption, label) = result.unwrap();
        assert_eq!(caption, "My Chart Caption");
        assert_eq!(label, "fig:chart1");

        // Not a figure (no label)
        let text2 = "Just some text";
        assert!(extract_figure_from_parsed_text(text2).is_none());

        // Not a figure (wrong label type)
        let text3 = "Some text{#sec:section1}";
        assert!(extract_figure_from_parsed_text(text3).is_none());
    }

    #[test]
    fn test_markdown_to_docx_with_figures() {
        let markdown = r#"
# Document

![Sales Chart](chart.png){#fig:sales}

As shown in @fig:sales, sales are increasing.
"#;

        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_multiple_figures() {
        let markdown = r#"
# Analysis

![First Chart](chart1.png){#fig:first}

![Second Chart](chart2.png){#fig:second}

Compare @fig:first with @fig:second to see the trend.
"#;

        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_with_sections() {
        let markdown = r#"
# Introduction {#sec:intro}

This is the introduction.

## Methods {#sec:methods}

As described in @sec:intro, we use certain methods.
"#;

        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_with_tables() {
        let markdown = r#"
# Data

| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |

{#tbl:data}

See @tbl:data for the complete dataset.
"#;

        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    #[test]
    fn test_markdown_to_docx_all_crossrefs() {
        let markdown = r#"
# Introduction {#sec:intro}

![Main Figure](main.png){#fig:main}

| Col1 | Col2 |
|------|------|
| X    | Y    |

{#tbl:summary}

In @sec:intro, we present @fig:main which summarizes the data in @tbl:summary.
"#;

        let result = markdown_to_docx(markdown);
        assert!(result.is_ok());
    }

    /// Helper function to convert Docx to bytes
    fn docx_to_bytes(docx: Docx) -> Result<Vec<u8>, String> {
        use std::io::Cursor;

        let mut buffer = Cursor::new(Vec::new());
        docx.build()
            .pack(&mut buffer)
            .map_err(|e| format!("Failed to pack DOCX: {}", e))?;
        Ok(buffer.into_inner())
    }

    /// Helper function to extract document.xml content from DOCX bytes
    fn extract_document_xml(docx_bytes: &[u8]) -> Option<String> {
        use std::io::{Cursor, Read};
        use zip::ZipArchive;

        let cursor = Cursor::new(docx_bytes);
        let mut archive = ZipArchive::new(cursor).ok()?;

        let mut file = archive.by_name("word/document.xml").ok()?;
        let mut contents = String::new();
        file.read_to_string(&mut contents).ok()?;

        Some(contents)
    }

    /// Extract plain text content from document.xml (strips all XML tags)
    fn extract_text_content(docx_bytes: &[u8]) -> Option<String> {
        let xml = extract_document_xml(docx_bytes)?;
        // Extract text content from <w:t> elements, preserving spaces
        let text_re = Regex::new(r"<w:t[^>]*>([^<]*)</w:t>").unwrap();
        let text: String = text_re
            .captures_iter(&xml)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str()))
            .collect::<Vec<_>>()
            .join(" "); // Join with space to preserve word boundaries
        Some(text)
    }

    /// Normalize document.xml by removing variable content (IDs, timestamps)
    fn normalize_document_xml(xml: &str) -> String {
        // Remove rsidR, rsidRPr, rsidP attributes (revision IDs that vary)
        let rsid_re = Regex::new(r#"\s*w:rsid[A-Za-z]*="[^"]*""#).unwrap();
        let result = rsid_re.replace_all(xml, "");

        // Remove w14:paraId and w14:textId attributes
        let para_id_re = Regex::new(r#"\s*w14:(paraId|textId)="[^"]*""#).unwrap();
        let result = para_id_re.replace_all(&result, "");

        result.to_string()
    }

    /// Hash the normalized document.xml content for comparison
    fn hash_document_xml(docx_bytes: &[u8]) -> Option<String> {
        use sha2::{Digest, Sha256};

        let xml = extract_document_xml(docx_bytes)?;
        let normalized = normalize_document_xml(&xml);
        let mut hasher = Sha256::new();
        hasher.update(normalized.as_bytes());
        let result = hasher.finalize();
        Some(format!("{:x}", result))
    }

    #[test]
    fn test_docx_determinism() {
        // Test that the same input produces identical output
        let markdown = r#"
# Test Document {#sec:intro}

This is a test paragraph with **bold** and *italic* text.

![Test Figure](test.png){#fig:test}

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |

{#tbl:test}

See @sec:intro, @fig:test, and @tbl:test for details.
"#;

        // Generate DOCX twice
        let docx1 = markdown_to_docx(markdown).expect("First DOCX generation failed");
        let docx2 = markdown_to_docx(markdown).expect("Second DOCX generation failed");

        // Convert to bytes
        let bytes1 = docx_to_bytes(docx1).expect("Failed to pack first DOCX");
        let bytes2 = docx_to_bytes(docx2).expect("Failed to pack second DOCX");

        // Extract and hash document.xml from both
        let hash1 = hash_document_xml(&bytes1).expect("Failed to hash first DOCX");
        let hash2 = hash_document_xml(&bytes2).expect("Failed to hash second DOCX");

        assert_eq!(
            hash1, hash2,
            "DOCX output is not deterministic - document.xml differs between runs"
        );
    }

    #[test]
    fn test_docx_structure_valid() {
        // Test that the generated DOCX has valid structure
        let markdown = "# Hello World\n\nThis is a test.";
        let docx = markdown_to_docx(markdown).expect("DOCX generation failed");
        let bytes = docx_to_bytes(docx).expect("Failed to pack DOCX");

        // Verify document.xml can be extracted
        let xml = extract_document_xml(&bytes);
        assert!(xml.is_some(), "Could not extract document.xml from DOCX");

        let xml_content = xml.unwrap();

        // Verify basic DOCX XML structure
        assert!(
            xml_content.contains("w:document"),
            "Missing w:document element"
        );
        assert!(xml_content.contains("w:body"), "Missing w:body element");
        assert!(
            xml_content.contains("Hello World"),
            "Missing heading content"
        );
        assert!(
            xml_content.contains("This is a test"),
            "Missing paragraph content"
        );
    }

    #[test]
    fn test_reference_document_export() {
        // Test exporting the reference document to verify cross-references work end-to-end
        use std::fs;
        use std::path::Path;

        // Load the reference document
        let ref_doc_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("example")
            .join("reference_doc.md");

        // Skip test if reference doc doesn't exist
        if !ref_doc_path.exists() {
            eprintln!(
                "Skipping test: reference_doc.md not found at {:?}",
                ref_doc_path
            );
            return;
        }

        let markdown =
            fs::read_to_string(&ref_doc_path).expect("Failed to read reference document");

        // Generate DOCX
        let docx = markdown_to_docx(&markdown);
        assert!(
            docx.is_ok(),
            "Failed to generate DOCX from reference document: {:?}",
            docx.err()
        );

        let docx_bytes = docx_to_bytes(docx.unwrap()).expect("Failed to pack DOCX");

        // Extract plain text content from document
        let text = extract_text_content(&docx_bytes)
            .expect("Failed to extract text content from reference document DOCX");

        // Verify cross-references are resolved
        // The reference doc has figures 1-5, sections 1-12, tables 1-3
        assert!(text.contains("Figure 1"), "Missing Figure 1 reference");
        assert!(text.contains("Figure 5"), "Missing Figure 5 reference");
        assert!(text.contains("Section 1"), "Missing Section 1 reference");
        assert!(text.contains("Section 12"), "Missing Section 12 reference");
        assert!(text.contains("Table 1"), "Missing Table 1 reference");
        assert!(text.contains("Table 3"), "Missing Table 3 reference");

        // Verify references (@type:label) are resolved - these should NOT appear in output
        // Note: We don't check for {#type:label} patterns because the reference doc
        // contains documentation examples that legitimately show these patterns
        assert!(!text.contains("@fig:"), "Figure references not resolved");
        assert!(!text.contains("@sec:"), "Section references not resolved");
        assert!(!text.contains("@tbl:"), "Table references not resolved");
    }

    #[test]
    fn test_reference_document_hash_stability() {
        // Golden file test: verify the reference document produces consistent output
        use std::fs;
        use std::path::Path;

        let ref_doc_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("example")
            .join("reference_doc.md");

        if !ref_doc_path.exists() {
            eprintln!("Skipping test: reference_doc.md not found");
            return;
        }

        let markdown =
            fs::read_to_string(&ref_doc_path).expect("Failed to read reference document");

        // Generate DOCX multiple times and verify consistency
        let docx1 = markdown_to_docx(&markdown).expect("First generation failed");
        let docx2 = markdown_to_docx(&markdown).expect("Second generation failed");

        let bytes1 = docx_to_bytes(docx1).expect("Failed to pack first DOCX");
        let bytes2 = docx_to_bytes(docx2).expect("Failed to pack second DOCX");

        let hash1 = hash_document_xml(&bytes1).expect("Failed to hash first result");
        let hash2 = hash_document_xml(&bytes2).expect("Failed to hash second result");

        assert_eq!(
            hash1, hash2,
            "Reference document DOCX export is not deterministic"
        );
    }
}
