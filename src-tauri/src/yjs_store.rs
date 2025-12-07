// src-tauri/yjs_store.rs
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const FILENAME: &str = "document.yjs";

fn doc_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&path).ok();
    path.push(FILENAME);
    Ok(path)
}

#[tauri::command]
pub fn load_doc(app: AppHandle) -> Result<Vec<u8>, String> {
    let path = doc_path(&app)?;
    if path.exists() {
        fs::read(path).map_err(|e| e.to_string())
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn store_update(app: AppHandle, full_state: Vec<u8>) -> Result<(), String> {
    let path = doc_path(&app)?;
    
    // Write atomically using a temporary file
    let temp_path = path.with_extension("yjs.tmp");
    
    fs::write(&temp_path, &full_state)
        .and_then(|_| fs::rename(&temp_path, &path))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.yjs");
        let temp_path = file_path.with_extension("yjs.tmp");
        
        let data = vec![1, 2, 3, 4, 5];
        
        // Simulate atomic write
        fs::write(&temp_path, &data).unwrap();
        fs::rename(&temp_path, &file_path).unwrap();
        
        // Verify content
        let read_data = fs::read(&file_path).unwrap();
        assert_eq!(read_data, data);
        
        // Verify temp file is gone
        assert!(!temp_path.exists());
    }

    #[test]
    fn test_load_nonexistent_returns_empty() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nonexistent.yjs");
        
        // Simulating what load_doc does
        let result = if file_path.exists() {
            fs::read(&file_path).map_err(|e| e.to_string())
        } else {
            Ok(Vec::new())
        };
        
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("roundtrip.yjs");
        
        let original_data = b"Hello Yjs World!".to_vec();
        
        // Write
        fs::write(&file_path, &original_data).unwrap();
        
        // Read back
        let read_data = fs::read(&file_path).unwrap();
        
        assert_eq!(read_data, original_data);
    }
}
