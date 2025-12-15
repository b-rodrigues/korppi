// src-tauri/src/hunk_calculator.rs
// Calculates hunks (contiguous groups of changed lines) between documents
// Uses the `similar` crate for efficient text diffing

use serde::{Deserialize, Serialize};
use similar::{DiffOp, TextDiff};



/// A hunk represents a contiguous block of changes (word level)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    /// Type of change: "add", "delete", or "modify"
    #[serde(rename = "type")]
    pub hunk_type: String,
    
    /// Starting character index in the base document (inclusive)
    pub base_start: usize,
    
    /// Ending character index in the base document (exclusive)
    pub base_end: usize,

    /// Internal: Starting byte offset (for coalescing slicing)
    #[serde(skip)]
    pub base_start_byte: usize,
    
    /// Internal: Ending byte offset
    #[serde(skip)]
    pub base_end_byte: usize,
    
    /// Length of the change in the modified document
    pub modified_length: usize,
    
    /// Text content from the base document (for deletions/modifications)
    pub base_text: String,
    
    /// Text content from the modified document (for additions/modifications)
    pub modified_text: String,

    // Deprecated but kept for compatibility/debug if needed, 
    // though purely line-based logic is being replaced.
    // We can compute rough line numbers for display purposes if we want.
    pub display_start_line: usize,
    
    /// Structured parts for rich visualization (Add/Delete/Equal)
    #[serde(default)]
    pub parts: Vec<DiffPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiffPart {
    pub part_type: String, // "add", "delete", "equal"
    pub text: String,
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
/// Uses similar's word diffing
/// Top-level function: Hybrid Line-Word Diff
/// 1. Identifies changed "blocks" using Line Diff.
/// 2. Performs granular Word Diff within those blocks.
pub fn calculate_hunks(base_text: &str, modified_text: &str) -> Vec<Hunk> {
    let diff = TextDiff::from_lines(base_text, modified_text);
    let mut all_hunks = Vec::new();
    
    // Global cursors to track absolute position in the Base document
    let mut global_base_byte_cursor = 0;
    let mut global_base_utf16_cursor = 0;
    
    // Buffers for the current changed block
    let mut pending_deletes = String::new();
    let mut pending_inserts = String::new();
    
    // Track where the current pending block started (in Base)
    let mut block_start_byte = 0;
    let mut block_start_utf16 = 0;
    let mut in_block = false;
    
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Equal => {
                // If we were in a block, flush it now
                if in_block {
                    flush_block(
                        &mut all_hunks, 
                        &pending_deletes, 
                        &pending_inserts, 
                        block_start_byte, 
                        block_start_utf16,
                        base_text 
                    );
                    
                    // Reset buffers
                    pending_deletes.clear();
                    pending_inserts.clear();
                    in_block = false;
                }
                
                // Advance global cursors (Equal text consumes Base)
                let len_bytes = change.value().len();
                let len_utf16 = change.value().encode_utf16().count();
                global_base_byte_cursor += len_bytes;
                global_base_utf16_cursor += len_utf16;
            }
            similar::ChangeTag::Delete => {
                if !in_block {
                    in_block = true;
                    block_start_byte = global_base_byte_cursor;
                    block_start_utf16 = global_base_utf16_cursor;
                }
                
                pending_deletes.push_str(change.value());
                
                // Advance global cursors (Delete text consumes Base)
                let len_bytes = change.value().len();
                let len_utf16 = change.value().encode_utf16().count();
                global_base_byte_cursor += len_bytes;
                global_base_utf16_cursor += len_utf16;
            }
            similar::ChangeTag::Insert => {
                if !in_block {
                    // Possible if pure insert (no previous delete)
                    in_block = true;
                    // Block start is current cursor (insertion point)
                    block_start_byte = global_base_byte_cursor;
                    block_start_utf16 = global_base_utf16_cursor;
                }
                
                pending_inserts.push_str(change.value());
                // Insert does NOT consume Base cursors
            }
        }
    }
    
    // Flush any remaining block at EOF
    if in_block {
        flush_block(
            &mut all_hunks, 
            &pending_deletes, 
            &pending_inserts, 
            block_start_byte, 
            block_start_utf16,
            base_text
        );
    }
    
    all_hunks
}

/// Helper to run word diff on a specific block and map back to global coordinates
fn flush_block(
    all_hunks: &mut Vec<Hunk>,
    local_base: &str,
    local_mod: &str,
    block_start_byte: usize,
    block_start_utf16: usize,
    full_base_text: &str,
) {
    if local_base.is_empty() && local_mod.is_empty() {
        return;
    }

    // Run granular word diff on this block
    let mut local_hunks = calculate_word_hunks_in_block(local_base, local_mod);
    
    // Shift relative hunks to absolute coordinates
    for hunk in &mut local_hunks {
        hunk.base_start += block_start_utf16;
        hunk.base_end += block_start_utf16;
        hunk.base_start_byte += block_start_byte;
        hunk.base_end_byte += block_start_byte;
        
        // Recalculate line number based on absolute byte position
        hunk.display_start_line = full_base_text[..hunk.base_start_byte].lines().count();
    }
    
    // Append to main list
    all_hunks.append(&mut local_hunks);
}

/// The original logic: Word-Level Diff + Coalescing + Parts
/// Now operating on a purely local pair of strings (0-indexed).
fn calculate_word_hunks_in_block(base_text: &str, modified_text: &str) -> Vec<Hunk> {
    let diff = TextDiff::from_words(base_text, modified_text);
    let mut hunks = Vec::new();
    
    // We need to track absolute character positions manually.
    // Strategy: Iterate iter_all_changes, which provides a linear stream of operations.
    
    let mut base_byte_cursor = 0;
    let mut base_utf16_cursor = 0; // JS uses UTF-16 code units for length/indexing
    
    // Helper to buffer "Delete" and "Insert" ops that are adjacent (to form a Modify)
    let mut current_hunk: Option<Hunk> = None;
    
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Equal => {
                // If we have a pending hunk, push it and clear
                if let Some(h) = current_hunk.take() {
                    hunks.push(h);
                }
                
                // Advance cursors
                let len_bytes = change.value().len();
                let len_utf16 = change.value().encode_utf16().count();
                base_byte_cursor += len_bytes;
                base_utf16_cursor += len_utf16;
            }
            similar::ChangeTag::Delete => {
                // This is a Deletion (part of base).
                // If we already have a pending hunk:
                // - If it was "add" (Insert) only? That shouldn't happen immediately before Delete usually? 
                //   Actually, strictly `Delete` usually comes before `Insert` for a `Replace`.
                
                if let Some(ref mut h) = current_hunk {
                    // We are accumulating more deletions?
                    h.base_text.push_str(change.value());
                    
                    let len_bytes = change.value().len();
                    let len_utf16 = change.value().encode_utf16().count();
                    
                    h.base_end += len_utf16;
                    h.base_end_byte += len_bytes;
                    
                    // Add Part
                    h.parts.push(DiffPart {
                        part_type: "delete".to_string(),
                        text: change.value().to_string(),
                    });
                    
                    // Type might need upgrading to modify if we add inserts later, 
                    // or if we already had inserts (unlikely for Delete to follow Insert in standard diff output for one block)
                    if h.hunk_type == "add" {
                         h.hunk_type = "modify".to_string();
                    }
                } else {
                    let len_bytes = change.value().len();
                    let len_utf16 = change.value().encode_utf16().count();
                    
                    // Start new hunk
                    current_hunk = Some(Hunk {
                        hunk_type: "delete".to_string(),
                        base_start: base_utf16_cursor,
                        base_end: base_utf16_cursor + len_utf16,
                        base_start_byte: base_byte_cursor,
                        base_end_byte: base_byte_cursor + len_bytes,
                        
                        modified_length: 0,
                        base_text: change.value().to_string(),
                        modified_text: String::new(),
                        display_start_line: 0, // Placeholder
                        parts: vec![DiffPart {
                            part_type: "delete".to_string(),
                            text: change.value().to_string(),
                        }],
                    });
                }
                
                // Cursor matches base, so we advance it? 
                // YES. This text exists in base, effectively "consumed" by the cursor.
                let len_bytes = change.value().len();
                let len_utf16 = change.value().encode_utf16().count();
                base_byte_cursor += len_bytes;
                base_utf16_cursor += len_utf16;
            }
            similar::ChangeTag::Insert => {
                // This is an Insertion (not in base, in new).
                // Cursor does NOT advance (it stays at the insertion point).
                
                let len_bytes = change.value().len();
                // let len_utf16 = change.value().encode_utf16().count(); // Unneeded for base cursor
                
                if let Some(ref mut h) = current_hunk {
                    h.modified_text.push_str(change.value());
                    h.modified_length += change.value().encode_utf16().count(); // FIX: use UTF-16
                    
                    // Add Part
                    h.parts.push(DiffPart {
                        part_type: "add".to_string(),
                        text: change.value().to_string(),
                    });
                    
                    // If we had deletes, this becomes modify
                    if h.hunk_type == "delete" {
                        h.hunk_type = "modify".to_string();
                    }
                } else {
                    // Start new hunk (Pure Add)
                    current_hunk = Some(Hunk {
                        hunk_type: "add".to_string(),
                        base_start: base_utf16_cursor,
                        base_end: base_utf16_cursor, // Insert has 0 length in base
                        base_start_byte: base_byte_cursor,
                        base_end_byte: base_byte_cursor,
                        
                        modified_length: change.value().encode_utf16().count(), // FIX: use UTF-16
                        base_text: String::new(),
                        modified_text: change.value().to_string(),
                         // Use byte slice for line counting
                        display_start_line: 0, // Placeholder
                        parts: vec![DiffPart {
                            part_type: "add".to_string(),
                            text: change.value().to_string(),
                        }],
                    });
                }
            }
        }
    }
    
    // Push final raw hunk
    if let Some(h) = current_hunk {
        hunks.push(h);
    }
    
    // Phase 2: Coalesce micro-hunks
    // We merge hunks separated by small gaps of "Equal" text to preserve semantic context.
    
    if hunks.is_empty() {
        return Vec::new();
    }
    
    let mut merged_hunks = Vec::new();
    let mut current = hunks[0].clone();
    
    // Threshold in bytes (approx chars).
    const COALESCE_THRESHOLD: usize = 50; 
    
    for next in hunks.into_iter().skip(1) {
        // Calculate gap using BYTE positions to verify slicing distance
        let gap_len = next.base_start_byte - current.base_end_byte;
        
        if gap_len < COALESCE_THRESHOLD {
            // MERGE
            
            // 1. Get the gap text from the original base string using BYTE indices
            let gap_text = &base_text[current.base_end_byte..next.base_start_byte];
            
            // 2. Append Gap + Next to Current
            current.base_text.push_str(gap_text);
            current.base_text.push_str(&next.base_text);
            
            // Gap is "Equal", so it exists in modified text too.
            current.modified_text.push_str(gap_text);
            current.modified_text.push_str(&next.modified_text);
            
            // 3. Update range
            // Update UTF-16 indices for frontend
            current.base_end = next.base_end;
            // Update BYTE indices for next iteration of coalescing
            current.base_end_byte = next.base_end_byte;
            
            // Recalculate UTF-16 length for modified text
            current.modified_length = current.modified_text.encode_utf16().count();
            
            // 4. Update parts
            current.parts.push(DiffPart {
                part_type: "equal".to_string(),
                text: gap_text.to_string(),
            });
            current.parts.extend(next.parts);
            
            // 5. Update type
            current.hunk_type = "modify".to_string();
            
        } else {
            // Gap too large, push current and start new
            merged_hunks.push(current);
            current = next;
        }
    }
    merged_hunks.push(current);
    
    merged_hunks
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
        let base = "Alice has apple.";
        let modified = "Alice has green apple.";
        let hunks = calculate_hunks(base, modified);
        
        println!("Hunks: {:?}", hunks);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "add");
        assert!(hunks[0].modified_text.contains("green"));
    }
    
    #[test]
    fn test_single_deletion() {
        let base = "Alice has green apple.";
        let modified = "Alice has apple.";
        let hunks = calculate_hunks(base, modified);
        
        println!("Hunks: {:?}", hunks);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "delete");
        assert!(hunks[0].base_text.contains("green"));
    }

    #[test]
    fn test_coalesce_hunks() {
        // "Save it to" -> "Back it up"
        // Words: "Save"->"Back", "it"(equal), "to"->"up"
        // Should be merged because "it" is short.
        let base = "Save it to a USB.";
        let modified = "Back it up to a USB.";
        let hunks = calculate_hunks(base, modified);
        
        println!("Coalesced Hunks: {:?}", hunks);
        
        // Should be 1 hunk, not 2
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "modify");
        // "to" is unchanged, so it isn't part of the hunk.
        // Hunk 1: Save -> Back
        // Gap: " it "
        // Hunk 2: Insert "up " (Base: "", Mod: "up ")
        // Merged Base: "Save" + " it " + "" = "Save it "
        // Merged Mod: "Back" + " it " + "up " = "Back it up "
        assert_eq!(hunks[0].base_text, "Save it ");
        assert_eq!(hunks[0].modified_text, "Back it up ");
        
        // Verify parts
        // Parts: Delete "Save", Equal " it ", Insert "up " (Wait. "Back"?)
        // Hunk 1: Save -> Back. Parts: [Delete "Save", Insert "Back"]
        // Gap: " it ". Part: [Equal " it "]
        // Hunk 2: Insert "up ". Parts: [Insert "up "]
        // Merged Parts: [Delete "Save", Insert "Back", Equal " it ", Insert "up "]
        // Verify
        let parts = &hunks[0].parts;
        println!("Parts: {:?}", parts);
        assert!(parts.len() >= 3); 
        // Note: Delete/Insert order might vary slightly but usually Delete, Insert.
    }

    #[test]
    fn test_emoji_offsets() {
        // "😊" is 4 bytes vs 2 chars (UTF-16) vs 1 scalar (wrong)
        let base = "😊 text";
        let modified = "😊 edited";
        let hunks = calculate_hunks(base, modified);
        
        println!("Hunks: {:?}", hunks);
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "modify");
        
        // Base start should skip the emoji
        // Emoji length in UTF-16 is 2. Space is 1. Total 3?
        // Wait, "😊 " is equal.
        // base_start should be 3 (2 for emoji + 1 for space).
        assert_eq!(hunks[0].base_start, 3);
        
        assert_eq!(hunks[0].base_text, "text");
        assert_eq!(hunks[0].modified_text, "edited");
    }

    #[test]
    fn test_coalesce_too_far() {
        // "Alice"->"Bob", large gap, "Eve"->"Mallory"
        // Gap is > 50 chars. Should remain 2 hunks.
        let gap = "This is a very long sentence that serves as a gap between two changes to ensure they are not merged.";
        let base = format!("Alice said: '{}' and Eve agreed.", gap);
        let modified = format!("Bob said: '{}' and Mallory agreed.", gap);
        
        let hunks = calculate_hunks(&base, &modified);
        
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].base_text, "Alice");
        assert_eq!(hunks[1].base_text, "Eve");
    }
    
    #[test]
    fn test_modification() {
        let base = "line 1\noriginal line\nline 3";
        let modified = "line 1\nmodified line\nline 3";
        let hunks = calculate_hunks(base, modified);
        
        assert_eq!(hunks.len(), 1);
        // Word diff might detect this as delete "original" add "modified" (modify)
        assert_eq!(hunks[0].hunk_type, "modify");
        assert!(hunks[0].base_text.contains("original"));
        assert!(hunks[0].modified_text.contains("modified"));
    }
    
    #[test]
    fn test_sentence_modification() {
        let base = "I love cats very much";
        let modified = "I love dogs very much";
        let hunks = calculate_hunks(base, modified);
        
        // Should only pick up "cats" -> "dogs"
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].hunk_type, "modify");
        assert_eq!(hunks[0].base_text, "cats");
        assert_eq!(hunks[0].modified_text, "dogs");
        
        // Base start should be after "I love "
        // "I love " length is 7 chars.
        assert_eq!(hunks[0].base_start, 7);
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
    all_hunks.sort_by_key(|h| h.hunk.base_start);
    
    all_hunks
}

#[cfg(test)]
mod tests_hybrid {
    use super::*;

    #[test]
    fn test_hybrid_line_word_diff() {
        let base = "Line 1\nLine 2 change\nLine 3";
        let modified = "Line 1\nLine 2 modified\nLine 3";
        
        let hunks = calculate_hunks(base, modified);
        
        println!("Hunks: {:?}", hunks);
        assert_eq!(hunks.len(), 1);
        
        // Hunk should correspond to "change" -> "modified"
        // Base: "Line 1\nLine 2 " (Length: 7 + 7 = 14)
        // "c" is at 14.
        assert_eq!(hunks[0].base_text, "change");
        assert_eq!(hunks[0].modified_text, "modified");
        assert_eq!(hunks[0].base_start, 14);
    }
    
    #[test]
    fn test_block_accumulation() {
        // Test that multiple changed lines are grouped into one block for word-diffing
        let base = "A\nB changed\nC changed\nD";
        let modified = "A\nB fixed\nC fixed\nD";
        
        let hunks = calculate_hunks(base, modified);
        println!("Hunks: {:?}", hunks);
        
        // Should ideally be 2 hunks (one per line) or 1 coalesced hunk depending on gap?
        // "changed\nC " -> "fixed\nC " gap?
        // "changed"-> "fixed". Gap: "\nC ".
        // Gap is small. Should coalesce?
        // Or separation by newline?
        // Let's see behavior.
        // Hunk 1: "changed" -> "fixed"
        // Hunk 2: "changed" -> "fixed"
        // Coalescing threshold is 50. Gap "\nC " is 3 chars. They should merge.
        
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].base_text, "changed\nC changed");
        assert_eq!(hunks[0].modified_text, "fixed\nC fixed");
    }
}

