#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod pijul_ops;
mod commands;

use commands::*;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_pijul_init,
            record_edit,
            get_history,
            test_conflict_detection,
            reset_test_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
