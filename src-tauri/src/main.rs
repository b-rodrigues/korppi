#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod yjs_store;
mod patch_log;
mod models;

use patch_log::{list_patches, record_patch, get_patch};
use yjs_store::{load_doc, store_update};

fn main() {
    // Initialize logger in debug mode
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
            get_patch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_placeholder() {
        // Add actual tests here
        assert!(true);
    }
}
