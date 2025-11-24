use crate::pijul_ops::*;
use crate::models::*;

#[tauri::command]
pub fn test_pijul_init() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    // Clean slate
    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| e.to_string())?;
    }

    match init_repository(&repo_path) {
        Ok(_) => Ok(TestResult {
            success: true,
            message: "Pijul repository initialized!".to_string(),
            details: Some(format!("Path: {:?}", repo_path)),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to initialize".to_string(),
            details: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn record_edit(content: String, message: String) -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    match record_change(&repo_path, &content, &message) {
        Ok(hash) => Ok(TestResult {
            success: true,
            message: "Change recorded".to_string(),
            details: Some(format!("Hash: {}", hash)),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to record".to_string(),
            details: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn get_history() -> Result<Vec<PatchInfo>, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    get_patch_history(&repo_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn test_conflict_detection() -> Result<ConflictInfo, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    simulate_conflict(&repo_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_test_repo() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| e.to_string())?;
    }

    Ok(TestResult {
        success: true,
        message: "Repository reset".to_string(),
        details: None,
    })
}
