// src-tauri/yjs_store.rs
use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager; // needed for app path access

const FILENAME: &str = "document.yjs";

fn doc_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path_resolver().app_data_dir().unwrap();
    fs::create_dir_all(&path).ok();
    path.push(FILENAME);
    path
}

#[tauri::command]
pub fn load_doc(app: AppHandle) -> Result<Vec<u8>, String> {
    let path = doc_path(&app);
    if path.exists() {
        fs::read(path).map_err(|e| e.to_string())
    } else {
        Ok(Vec::new()) // empty document
    }
}

#[tauri::command]
pub fn store_update(app: AppHandle, update: Vec<u8>) -> Result<(), String> {
    let path = doc_path(&app);

    // Append updates — future-proof for sync/merging
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| std::io::Write::write_all(&mut file, &update))
        .map_err(|e| e.to_string())
}
