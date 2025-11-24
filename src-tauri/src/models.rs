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

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictLocation {
    pub line: usize,
    pub options: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub details: Option<String>,
}
