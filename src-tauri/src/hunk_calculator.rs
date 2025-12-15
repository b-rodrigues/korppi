// src-tauri/src/hunk_calculator.rs
// Calculates hunks (contiguous groups of changed lines) between documents
// Uses the `similar` crate for efficient text diffing

use serde::{Deserialize, Serialize};
use similar::{DiffOp, TextDiff};

/// A hunk represents a contiguous block of changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    /// Type of change: "add", "delete", or "modify"
    #[serde(rename = "type")]
    pub hunk_type: String,
    
    /// Starting line in the base document (0-indexed)
    pub base_start_line: usize,
    
    /// Ending line in the base document (exclusive)
    pub base_end_line: usize,
    
    /// Starting line in the modified document (0-indexed)
    pub modified_start_line: usize,
    
    /// Ending line in the modified document (exclusive)
    pub modified_end_line: usize,
    
    /// Lines from the base document (for deletions/modifications)
    pub base_lines: Vec<String>,
    
    /// Lines from the modified document (for additions/modifications)
    pub modified_lines: Vec<String>,
}

/// A hunk with author information attached
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthoredHunk {
    #[serde(flatten)]
    pub hunk: Hunk,
    
    /// Unique ID for this hunk
    pub hunk_id: String,
    
    /// Patch ID this hunk came from
    pub patch_id: i64,
    
    /// Patch UUID
    pub patch_uuid: Option<String>,
    
    /// Author ID
    pub author: String,
    
    /// Author display name
    pub author_name: String,
    
    /// Author color (hex)
    pub author_color: String,
    
    /// Timestamp of the patch
    pub timestamp: i64,
}

/// Calculate hunks between a base document and a modified document
/// Uses similar's grouped_ops() which already groups changes into logical hunks
pub fn calculate_hunks(base_text: &str, modified_text: &str) -> Vec<Hunk> {
    let diff = TextDiff::from_lines(base_text, modified_text);
    
    let base_lines: Vec<&str> = base_text.lines().collect();
    let modified_lines: Vec<&str> = modified_text.lines().collect();
    
    let mut hunks = Vec::new();
    
    // grouped_ops(0) returns groups of changes with 0 context lines
    // Each group is a contiguous set of operations = one hunk
    for ops in diff.grouped_ops(0) {
        let mut base_start = usize::MAX;
        let mut base_end = 0;
        let mut modified_start = usize::MAX;
        let mut modified_end = 0;
        let mut hunk_base_lines = Vec::new();
        let mut hunk_modified_lines = Vec::new();
        
        for op in &ops {
            match op {
                DiffOp::Delete { old_index, old_len, .. } => {
                    base_start = base_start.min(*old_index);
                    base_end = base_end.max(*old_index + *old_len);
                    for i in *old_index..(*old_index + *old_len) {
                        if i < base_lines.len() {
                            hunk_base_lines.push(base_lines[i].to_string());
                        }
                    }
                }
                DiffOp::Insert { new_index, new_len, .. } => {
                    modified_start = modified_start.min(*new_index);
                    modified_end = modified_end.max(*new_index + *new_len);
                    for i in *new_index..(*new_index + *new_len) {
                        if i < modified_lines.len() {
                            hunk_modified_lines.push(modified_lines[i].to_string());
                        }
                    }
                }
                DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                    base_start = base_start.min(*old_index);
                    base_end = base_end.max(*old_index + *old_len);
                    modified_start = modified_start.min(*new_index);
                    modified_end = modified_end.max(*new_index + *new_len);
                    
                    for i in *old_index..(*old_index + *old_len) {
                        if i < base_lines.len() {
                            hunk_base_lines.push(base_lines[i].to_string());
                        }
                    }
                    for i in *new_index..(*new_index + *new_len) {
                        if i < modified_lines.len() {
                            hunk_modified_lines.push(modified_lines[i].to_string());
                        }
                    }
                }
                DiffOp::Equal { .. } => {
                    // Skip equal operations (context lines)
                }
            }
        }
        
        // Skip if nothing changed
        if hunk_base_lines.is_empty() && hunk_modified_lines.is_empty() {
            continue;
        }
        
        // Determine hunk type
        let hunk_type = if !hunk_base_lines.is_empty() && !hunk_modified_lines.is_empty() {
            "modify"
        } else if !hunk_base_lines.is_empty() {
            "delete"
        } else {
            "add"
        };
        
        // Fix up start values if they weren't set
        if base_start == usize::MAX {
            base_start = modified_start;
        }
        if modified_start == usize::MAX {
            modified_start = base_start;
        }
        
        hunks.push(Hunk {
            hunk_type: hunk_type.to_string(),
            base_start_line: base_start,
            base_end_line: base_end,
            modified_start_line: modified_start,
            modified_end_line: modified_end,
            base_lines: hunk_base_lines,
            modified_lines: hunk_modified_lines,
        });
    }
    
    hunks
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_identical_texts() {
        let base = "line 1\nline 2\nline 3";
        let modified = "line 1\nline 2\nline 3";
        let hunks = calculate_hunks(base, modified);
        assert!(hunks.is_empty());
    }
    
    #[test]
    fn test_single_addition() {
        let base = "line 1\nline 3";
        let modified = "line 1\nline 2\nline 3";
        let hunks = calculate_hunks(base, modified);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "add");
        assert_eq!(hunks[0].modified_lines, vec!["line 2"]);
    }
    
    #[test]
    fn test_single_deletion() {
        let base = "line 1\nline 2\nline 3";
        let modified = "line 1\nline 3";
        let hunks = calculate_hunks(base, modified);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "delete");
        assert_eq!(hunks[0].base_lines, vec!["line 2"]);
    }
    
    #[test]
    fn test_modification() {
        let base = "line 1\noriginal line\nline 3";
        let modified = "line 1\nmodified line\nline 3";
        let hunks = calculate_hunks(base, modified);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "modify");
        assert_eq!(hunks[0].base_lines, vec!["original line"]);
        assert_eq!(hunks[0].modified_lines, vec!["modified line"]);
    }
    
    #[test]
    fn test_separate_hunks() {
        let base = "line 1\nline 2\nline 3\nline 4\nline 5";
        let modified = "changed 1\nline 2\nline 3\nline 4\nchanged 5";
        let hunks = calculate_hunks(base, modified);
        
        // Should be 2 separate hunks
        assert_eq!(hunks.len(), 2);
        
        assert_eq!(hunks[0].hunk_type, "modify");
        assert_eq!(hunks[0].base_lines, vec!["line 1"]);
        assert_eq!(hunks[0].modified_lines, vec!["changed 1"]);
        
        assert_eq!(hunks[1].hunk_type, "modify");
        assert_eq!(hunks[1].base_lines, vec!["line 5"]);
        assert_eq!(hunks[1].modified_lines, vec!["changed 5"]);
    }
}

/// Input for a patch to calculate hunks for
#[derive(Debug, Deserialize)]
pub struct PatchInput {
    /// Patch ID
    pub id: i64,
    /// Patch UUID
    pub uuid: Option<String>,
    /// Author ID
    pub author: String,
    /// Author display name
    pub author_name: String,
    /// Author color (hex)
    pub author_color: String,
    /// Timestamp of the patch
    pub timestamp: i64,
    /// The snapshot content of this patch
    pub snapshot: String,
}

/// Tauri command: Calculate hunks for multiple patches compared to a base
/// 
/// This computes BASE vs PATCH_A, BASE vs PATCH_B, etc. and returns
/// all hunks with author information attached.
#[tauri::command]
pub fn calculate_hunks_for_patches(
    base_content: String,
    patches: Vec<PatchInput>,
) -> Vec<AuthoredHunk> {
    let mut all_hunks = Vec::new();
    let mut hunk_counter = 0;
    
    for patch in patches {
        // Calculate hunks: BASE vs this PATCH
        let hunks = calculate_hunks(&base_content, &patch.snapshot);
        
        // Attach patch metadata to each hunk
        for hunk in hunks {
            all_hunks.push(AuthoredHunk {
                hunk,
                hunk_id: format!("{}-{}", patch.id, hunk_counter),
                patch_id: patch.id,
                patch_uuid: patch.uuid.clone(),
                author: patch.author.clone(),
                author_name: patch.author_name.clone(),
                author_color: patch.author_color.clone(),
                timestamp: patch.timestamp,
            });
            hunk_counter += 1;
        }
    }
    
    // Sort hunks by position in base document
    all_hunks.sort_by_key(|h| h.hunk.base_start_line);
    
    all_hunks
}

