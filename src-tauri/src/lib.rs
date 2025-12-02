pub mod yjs_store;
pub mod patch_log;
pub mod models;
pub mod conflict_detector;
pub mod conflict_store;
pub mod conflict_commands;

use patch_log::{list_patches, record_patch, get_patch};
use yjs_store::{load_doc, store_update};
use conflict_commands::{detect_conflicts, get_conflicts, resolve_conflict, get_conflict_count};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(debug_assertions)]
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_doc,
            store_update,
            record_patch,
            list_patches,
            get_patch,
            detect_conflicts,
            get_conflicts,
            resolve_conflict,
            get_conflict_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
