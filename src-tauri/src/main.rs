#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod yjs_store;
use yjs_store::{load_doc, store_update};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_doc,
            store_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
