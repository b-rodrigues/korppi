use tauri::AppHandle;
use crate::models::{Conflict, ResolutionInput};
use crate::conflict_detector::ConflictDetector;
use crate::conflict_store;
use crate::patch_log;

/// Scan patches and detect new conflicts
#[tauri::command]
pub fn detect_conflicts(app: AppHandle) -> Result<Vec<Conflict>, String> {
    // Get all patches
    let patches = patch_log::list_patches(app.clone())?;

    // Run conflict detection
    let detector = ConflictDetector::new(5000); // 5 second window
    let conflicts = detector.detect_conflicts(&patches);

    // Store new conflicts
    let conn = conflict_store::init_db(&app)?;
    for conflict in &conflicts {
        conflict_store::store_conflict(&conn, conflict)?;
    }

    Ok(conflicts)
}

/// Get all unresolved conflicts
#[tauri::command]
pub fn get_conflicts(app: AppHandle) -> Result<Vec<Conflict>, String> {
    let conn = conflict_store::init_db(&app)?;
    conflict_store::get_unresolved_conflicts(&conn)
}

/// Resolve a conflict with user's choice
#[tauri::command]
pub fn resolve_conflict(
    app: AppHandle,
    resolution: ResolutionInput,
) -> Result<(), String> {
    let conn = conflict_store::init_db(&app)?;
    conflict_store::resolve_conflict(&conn, &resolution)
}

/// Get conflict count (for UI badge)
#[tauri::command]
pub fn get_conflict_count(app: AppHandle) -> Result<usize, String> {
    let conflicts = get_conflicts(app)?;
    Ok(conflicts.len())
}
