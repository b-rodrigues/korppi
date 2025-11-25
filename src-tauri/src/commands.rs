use crate::models::*;
use crate::pijul_ops::*;

/// Initialize the test Pijul repository
#[tauri::command]
pub fn test_pijul_init() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;

    // Clean previous repo if exists
    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| format!("Failed to remove old repo: {}", e))?;
    }

    match init_repository(&repo_path) {
        Ok(_) => match verify_repository(&repo_path) {
            Ok(true) => Ok(TestResult {
                success: true,
                message: "Pijul repository initialized successfully".to_string(),
                details: Some(format!("Created at {:?}", repo_path)),
            }),
            Ok(false) => Ok(TestResult {
                success: false,
                message: "Repository created, but verification failed".to_string(),
                details: None,
            }),
            Err(e) => Ok(TestResult {
                success: false,
                message: "Verification error".to_string(),
                details: Some(e.to_string()),
            }),
        },
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to initialize repository".to_string(),
            details: Some(e.to_string()),
        }),
    }
}

/// Record a change to the document
#[tauri::command]
pub fn record_edit(content: String, message: String) -> Result<TestResult, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;

    if !repo_path.join(".pijul").exists() {
        return Ok(TestResult {
            success: false,
            message: "Repository not initialized".to_string(),
            details: Some("Run 'Test Pijul Init' first".to_string()),
        });
    }

    match record_change(&repo_path, &content, &message) {
        Ok(hash) if hash == "no_change" => Ok(TestResult {
            success: true,
            message: "No changes to record".to_string(),
            details: Some("The content is identical to the previous version".to_string()),
        }),
        Ok(hash) => Ok(TestResult {
            success: true,
            message: "Change recorded".to_string(),
            details: Some(format!("Patch hash: {}", hash)),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to record change".to_string(),
            details: Some(e.to_string()),
        }),
    }
}

/// Retrieve patch history
#[tauri::command]
pub fn get_history() -> Result<Vec<PatchInfo>, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;

    get_patch_history(&repo_path).map_err(|e| e.to_string())
}

/// Simulate a conflict and return structured information
#[tauri::command]
pub fn test_conflict_detection() -> Result<ConflictInfo, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;
    simulate_conflict(&repo_path).map_err(|e| e.to_string())
}

/// Reset test repository
#[tauri::command]
pub fn reset_test_repo() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;

    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| format!("Failed to remove repo: {}", e))?;
    }

    Ok(TestResult {
        success: true,
        message: "Repository reset".to_string(),
        details: Some(format!("Removed {:?}", repo_path)),
    })
}

/// Show debugging information about repo structure
#[tauri::command]
pub fn get_repo_status() -> Result<String, String> {
    let repo_path = get_test_repo_path().map_err(|e| e.to_string())?;

    if !repo_path.exists() {
        return Ok(format!("Repository directory does not exist: {:?}", repo_path));
    }

    let mut status = format!("Repository status for {:?}\n\n", repo_path);

    let pijul = repo_path.join(".pijul");
    status.push_str(&format!("  .pijul: {}\n", pijul.exists()));

    let pristine = pijul.join("pristine/db");
    status.push_str(&format!("  pristine/db: {}\n", pristine.exists()));

    let changes = pijul.join("changes");
    status.push_str(&format!("  changes/: {}\n", changes.exists()));

    match verify_repository(&repo_path) {
        Ok(true) => status.push_str("\nRepository structure is valid."),
        Ok(false) => status.push_str("\nRepository incomplete."),
        Err(e) => status.push_str(&format!("\nVerification failed: {}", e)),
    }

    Ok(status)
}
