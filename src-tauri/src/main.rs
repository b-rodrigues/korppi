#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod yjs_store;
mod patch_log;

use patch_log::{list_patches, record_patch, get_patch};
use yjs_store::{load_doc, store_update};

fn main() {
    tauri::Builder::default()
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
