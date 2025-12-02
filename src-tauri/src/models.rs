use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchInfo {
    pub hash: String,
    pub description: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictInfo {
    pub has_conflict: bool,
    pub locations: Vec<ConflictLocation>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConflictLocation {
    pub path: String,
    pub line: Option<usize>,
    pub conflict_type: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub details: Option<String>,
}

/// Represents a detected conflict between two versions
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conflict {
    pub id: String,
    pub conflict_type: ConflictType,
    pub base_version: TextSpan,      // Common ancestor
    pub local_version: TextSpan,     // Our changes
    pub remote_version: TextSpan,    // Their changes
    pub status: ConflictStatus,
    pub detected_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ConflictType {
    /// Both edited the same region
    OverlappingEdit,
    /// One deleted text the other modified
    DeleteModify,
    /// Both inserted at the same position
    ConcurrentInsert,
    /// Structural conflict (e.g., both wrapped in different block types)
    StructuralConflict,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ConflictStatus {
    Unresolved,
    ResolvedLocal,   // Kept local version
    ResolvedRemote,  // Kept remote version
    ResolvedMerged,  // Manual merge
    ResolvedBoth,    // Kept both
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextSpan {
    pub start: usize,
    pub end: usize,
    pub content: String,
    pub author: String,
    pub timestamp: i64,
}

/// Input for conflict resolution
#[derive(Debug, Serialize, Deserialize)]
pub struct ResolutionInput {
    pub conflict_id: String,
    pub resolution: ConflictStatus,
    pub merged_content: Option<String>, // For manual merge
}
