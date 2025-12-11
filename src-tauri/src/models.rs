use serde::{Deserialize, Serialize};

/// Represents a detected conflict between two versions
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conflict {
    pub id: String,
    pub conflict_type: ConflictType,
    pub base_version: TextSpan,   // Common ancestor
    pub local_version: TextSpan,  // Our changes
    pub remote_version: TextSpan, // Their changes
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
    ResolvedLocal,  // Kept local version
    ResolvedRemote, // Kept remote version
    ResolvedMerged, // Manual merge
    ResolvedBoth,   // Kept both
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
