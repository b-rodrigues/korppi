use crate::models::{Conflict, ConflictType, ConflictStatus, TextSpan};
use crate::patch_log::Patch;

/// Detects conflicts by analyzing overlapping patches from different authors
pub struct ConflictDetector {
    /// Time window (ms) within which concurrent edits are considered conflicting
    concurrency_window: i64,
}

impl ConflictDetector {
    pub fn new(concurrency_window_ms: i64) -> Self {
        Self {
            concurrency_window: concurrency_window_ms,
        }
    }

    /// Analyze patches and detect conflicts
    pub fn detect_conflicts(&self, patches: &[Patch]) -> Vec<Conflict> {
        let mut conflicts = Vec::new();

        // Group patches by time windows
        let time_groups = self.group_by_time_window(patches);

        for group in time_groups {
            // Only check groups with multiple authors
            let authors: std::collections::HashSet<_> =
                group.iter().map(|p| &p.author).collect();

            if authors.len() < 2 {
                continue;
            }

            // Check for overlapping edits within the group
            let group_conflicts = self.find_overlapping_edits(&group);
            conflicts.extend(group_conflicts);
        }

        conflicts
    }

    fn group_by_time_window<'a>(&self, patches: &'a [Patch]) -> Vec<Vec<&'a Patch>> {
        if patches.is_empty() {
            return Vec::new();
        }

        let mut groups: Vec<Vec<&Patch>> = Vec::new();
        let mut current_group: Vec<&Patch> = vec![&patches[0]];
        let mut group_start = patches[0].timestamp;

        for patch in patches.iter().skip(1) {
            if patch.timestamp - group_start <= self.concurrency_window {
                current_group.push(patch);
                // Update group_start to allow chaining (sliding window)
                group_start = patch.timestamp;
            } else {
                if !current_group.is_empty() {
                    groups.push(current_group);
                }
                current_group = vec![patch];
                group_start = patch.timestamp;
            }
        }

        if !current_group.is_empty() {
            groups.push(current_group);
        }

        groups
    }

    fn find_overlapping_edits(&self, patches: &[&Patch]) -> Vec<Conflict> {
        let mut conflicts = Vec::new();

        // Extract ranges from patch data
        let edits: Vec<EditInfo> = patches
            .iter()
            .flat_map(|p| self.extract_all_edit_infos(p))
            .collect();

        // Compare all pairs
        for i in 0..edits.len() {
            for j in (i + 1)..edits.len() {
                if edits[i].author == edits[j].author {
                    continue;
                }

                if self.ranges_overlap(&edits[i], &edits[j]) {
                    let conflict = self.create_conflict(&edits[i], &edits[j]);
                    conflicts.push(conflict);
                }
            }
        }

        conflicts
    }

    fn extract_all_edit_infos(&self, patch: &Patch) -> Vec<EditInfo> {
        let mut edits = Vec::new();
        let data = &patch.data;

        // Handle semantic_group patches (array of operations)
        if let Some(ops) = data.as_array() {
            for op in ops {
                if let Some(edit) = self.parse_single_operation(op, patch) {
                    edits.push(edit);
                }
            }
        }

        edits
    }

    fn parse_single_operation(&self, op: &serde_json::Value, patch: &Patch) -> Option<EditInfo> {
        let kind = op.get("kind").and_then(|k| k.as_str())?;

        match kind {
            "insert_text" => {
                let at = op.get("at").and_then(|v| v.as_u64())? as usize;
                let text = op.get("insertedText").and_then(|v| v.as_str())?;
                Some(EditInfo {
                    start: at,
                    end: at,
                    content: text.to_string(),
                    author: patch.author.clone(),
                    timestamp: patch.timestamp,
                    edit_type: EditType::Insert,
                })
            }
            "delete_text" => {
                let range = op.get("range").and_then(|v| v.as_array())?;
                let start = range.get(0).and_then(|v| v.as_u64())? as usize;
                let end = range.get(1).and_then(|v| v.as_u64())? as usize;
                let deleted = op.get("deletedText")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(EditInfo {
                    start,
                    end,
                    content: deleted,
                    author: patch.author.clone(),
                    timestamp: patch.timestamp,
                    edit_type: EditType::Delete,
                })
            }
            "replace_text" => {
                let range = op.get("range").and_then(|v| v.as_array())?;
                let start = range.get(0).and_then(|v| v.as_u64())? as usize;
                let end = range.get(1).and_then(|v| v.as_u64())? as usize;
                let inserted = op.get("insertedText")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(EditInfo {
                    start,
                    end,
                    content: inserted,
                    author: patch.author.clone(),
                    timestamp: patch.timestamp,
                    edit_type: EditType::Replace,
                })
            }
            _ => None,
        }
    }

    fn ranges_overlap(&self, a: &EditInfo, b: &EditInfo) -> bool {
        // Check if edit ranges overlap
        // For inserts at same position, they conflict
        if a.edit_type == EditType::Insert && b.edit_type == EditType::Insert {
            return a.start == b.start;
        }

        // General overlap check
        a.start < b.end && b.start < a.end
    }

    fn create_conflict(&self, local: &EditInfo, remote: &EditInfo) -> Conflict {
        let conflict_type = match (&local.edit_type, &remote.edit_type) {
            (EditType::Insert, EditType::Insert) => ConflictType::ConcurrentInsert,
            (EditType::Delete, EditType::Replace) |
            (EditType::Replace, EditType::Delete) => ConflictType::DeleteModify,
            _ => ConflictType::OverlappingEdit,
        };

        Conflict {
            id: format!("{}-{}-{}", local.timestamp, remote.timestamp, local.start),
            conflict_type,
            base_version: TextSpan {
                start: local.start.min(remote.start),
                end: local.end.max(remote.end),
                content: String::new(), // Would need base document state
                author: "base".to_string(),
                timestamp: 0,
            },
            local_version: TextSpan {
                start: local.start,
                end: local.end,
                content: local.content.clone(),
                author: local.author.clone(),
                timestamp: local.timestamp,
            },
            remote_version: TextSpan {
                start: remote.start,
                end: remote.end,
                content: remote.content.clone(),
                author: remote.author.clone(),
                timestamp: remote.timestamp,
            },
            status: ConflictStatus::Unresolved,
            detected_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}

#[derive(Debug, Clone)]
struct EditInfo {
    start: usize,
    end: usize,
    content: String,
    author: String,
    timestamp: i64,
    edit_type: EditType,
}

#[derive(Debug, Clone, PartialEq)]
enum EditType {
    Insert,
    Delete,
    Replace,
}
