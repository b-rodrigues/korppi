use crate::pijul_ops::*;
use crate::models::*;

/// Test Pijul initialization
/// 
/// This command:
/// 1. Gets or creates the test repository path
/// 2. Cleans any existing repository
/// 3. Initializes a new Pijul repository
/// 4. Verifies the initialization was successful
#[tauri::command]
pub fn test_pijul_init() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| format!("Failed to get repo path: {}", e))?;

    // Clean slate
    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| format!("Failed to clean old repo: {}", e))?;
    }

    // Create repository
    match init_repository(&repo_path) {
        Ok(_) => {
            // Verify it worked
            match verify_repository(&repo_path) {
                Ok(true) => Ok(TestResult {
                    success: true,
                    message: "✅ Pijul repository initialized successfully!".to_string(),
                    details: Some(format!(
                        "Repository created at: {:?}\n\
                         \nStructure:\n\
                         - .pijul/ directory created\n\
                         - pristine/ database initialized\n\
                         - main channel created\n\
                         - changes/ directory ready\n\
                         \n✨ Day 1 validation complete!",
                        repo_path
                    )),
                }),
                Ok(false) => Ok(TestResult {
                    success: false,
                    message: "Repository created but verification failed".to_string(),
                    details: Some("The .pijul structure exists but may be incomplete".to_string()),
                }),
                Err(e) => Ok(TestResult {
                    success: false,
                    message: "Verification error".to_string(),
                    details: Some(format!("Could not verify repository: {}", e)),
                }),
            }
        }
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to initialize repository".to_string(),
            details: Some(format!("Error: {}\n\nThis might be a Pijul API issue.", e)),
        }),
    }
}

/// Record a change (Day 2 - Not Yet Implemented)
#[tauri::command]
pub fn record_edit(content: String, message: String) -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    // Check if repository exists
    if !repo_path.join(".pijul").exists() {
        return Ok(TestResult {
            success: false,
            message: "Repository not initialized".to_string(),
            details: Some("Run 'Test Pijul Init' first to create a repository".to_string()),
        });
    }

    match record_change(&repo_path, &content, &message) {
        Ok(hash) => Ok(TestResult {
            success: true,
            message: "⚠️ Mock implementation - Day 2 not complete".to_string(),
            details: Some(format!(
                "Returned mock hash: {}\n\
                 \nNote: This is a placeholder.\n\
                 Day 2 implementation requires:\n\
                 - Writing file to working copy\n\
                 - Recording changes with Pijul\n\
                 - Generating real patch hash",
                hash
            )),
        }),
        Err(e) => Ok(TestResult {
            success: false,
            message: "Failed to record change".to_string(),
            details: Some(e.to_string()),
        }),
    }
}

/// Get patch history (Day 2 - Not Yet Implemented)
#[tauri::command]
pub fn get_history() -> Result<Vec<PatchInfo>, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    // Check if repository exists
    if !repo_path.join(".pijul").exists() {
        return Err("Repository not initialized. Run 'Test Pijul Init' first.".to_string());
    }

    get_patch_history(&repo_path)
        .map_err(|e| format!("Failed to get history: {}", e))
}

/// Test conflict detection (Day 3 - Not Yet Implemented)
#[tauri::command]
pub fn test_conflict_detection() -> Result<ConflictInfo, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    // Check if repository exists
    if !repo_path.join(".pijul").exists() {
        return Err("Repository not initialized. Run 'Test Pijul Init' first.".to_string());
    }

    simulate_conflict(&repo_path)
        .map_err(|e| format!("Failed to simulate conflict: {}", e))
}

/// Reset the test repository
#[tauri::command]
pub fn reset_test_repo() -> Result<TestResult, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)
            .map_err(|e| format!("Failed to remove repository: {}", e))?;
    }

    Ok(TestResult {
        success: true,
        message: "Test repository reset successfully".to_string(),
        details: Some(format!("Removed: {:?}", repo_path)),
    })
}

/// Get repository status (for debugging)
#[tauri::command]
pub fn get_repo_status() -> Result<String, String> {
    let repo_path = get_test_repo_path()
        .map_err(|e| e.to_string())?;

    if !repo_path.exists() {
        return Ok(format!("❌ Repository path does not exist: {:?}", repo_path));
    }

    let pijul_dir = repo_path.join(".pijul");
    if !pijul_dir.exists() {
        return Ok(format!(
            "⚠️ Repository directory exists but not initialized\nPath: {:?}",
            repo_path
        ));
    }

    let mut status = format!("📁 Repository Status\n\nPath: {:?}\n\n", repo_path);

    // Check structure
    status.push_str("Structure:\n");
    status.push_str(&format!("  .pijul/ - {}\n", if pijul_dir.exists() { "✅" } else { "❌" }));
    status.push_str(&format!("  pristine/ - {}\n", if pijul_dir.join("pristine").exists() { "✅" } else { "❌" }));
    status.push_str(&format!("  changes/ - {}\n", if pijul_dir.join("changes").exists() { "✅" } else { "❌" }));
    status.push_str(&format!("  pristine/db - {}\n", if pijul_dir.join("pristine/db").exists() { "✅" } else { "❌" }));

    // Try to verify
    match verify_repository(&repo_path) {
        Ok(true) => status.push_str("\n✅ Repository is valid and functional"),
        Ok(false) => status.push_str("\n⚠️ Repository structure incomplete"),
        Err(e) => status.push_str(&format!("\n❌ Verification error: {}", e)),
    }

    Ok(status)
}
