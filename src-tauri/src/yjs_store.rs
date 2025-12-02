// src-tauri/yjs_store.rs
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const FILENAME: &str = "document.yjs";

fn doc_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
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
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn store_update(app: AppHandle, full_state: Vec<u8>) -> Result<(), String> {
    let path = doc_path(&app);
    
    // Write atomically using a temporary file
    let temp_path = path.with_extension("yjs.tmp");
    
    fs::write(&temp_path, &full_state)
        .and_then(|_| fs::rename(&temp_path, &path))
        .map_err(|e| e.to_string())
}
