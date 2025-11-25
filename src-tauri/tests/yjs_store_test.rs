// src-tauri/tests/yjs_store_test.rs
#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_yjs_state_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.yjs");

        // Simulate writing state
        let test_data = vec![1, 2, 3, 4, 5];
        fs::write(&file_path, &test_data).unwrap();

        // Simulate reading state
        let loaded_data = fs::read(&file_path).unwrap();

        assert_eq!(test_data, loaded_data);
    }

    #[test]
    fn test_atomic_write() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.yjs");
        let temp_path = file_path.with_extension("yjs.tmp");

        // Simulate atomic write
        let data = vec![1, 2, 3];
        fs::write(&temp_path, &data).unwrap();
        fs::rename(&temp_path, &file_path).unwrap();

        assert!(file_path.exists());
        assert!(!temp_path.exists());
        assert_eq!(fs::read(&file_path).unwrap(), data);
    }
}
