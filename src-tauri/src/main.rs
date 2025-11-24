// Prevents additional console window on Windows in release mode
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod pijul_ops;

use models::*;
use pijul_ops::*;
use anyhow::Result;

/// CLI runner for Pijul tests
fn main() -> Result<()> {
    println!("🦀 Korppi Prototype - Backend Validator");
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Day 1: Initialization
    println!("\nTest 1: Repository Initialization");
    let repo_path = get_test_repo_path()?;
    if repo_path.exists() {
        std::fs::remove_dir_all(&repo_path)?;
    }

    match init_repository(&repo_path) {
        Ok(_) => println!("✅ Success: Pijul repository initialized at {:?}", repo_path),
        Err(e) => {
            println!("❌ Failed: {}", e);
            return Ok(());
        }
    }

    // Day 2: Record Change
    println!("\nTest 2: Record Change");
    let content = "Hello, world!";
    let message = "Initial commit";
    match record_change(&repo_path, content, message) {
        Ok(hash) => println!("✅ Success: Change recorded. Patch: {}", hash),
        Err(e) => {
            println!("❌ Failed to record change: {}", e);
            // Don't return, try to proceed if possible or debugging
        }
    }

    // Day 2: History
    println!("\nTest 3: Get History");
    match get_patch_history(&repo_path) {
        Ok(history) => {
            println!("✅ Success: Retrieved {} patches", history.len());
            for patch in history {
                println!("  - {} ({})", patch.hash, patch.description);
            }
        },
        Err(e) => println!("❌ Failed to get history: {}", e),
    }

    // Day 3: Conflict
    println!("\nTest 4: Conflict Detection");
    match simulate_conflict(&repo_path) {
        Ok(info) => {
            if info.has_conflict {
                 println!("✅ Success: Conflict detected as expected.");
                 println!("  Details: {:?}", info);
            } else {
                 println!("⚠️ Warning: No conflict detected (unexpected).");
            }
        },
        Err(e) => println!("❌ Failed to simulate conflict: {}", e),
    }

    Ok(())
}
