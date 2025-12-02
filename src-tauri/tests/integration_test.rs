// src-tauri/tests/integration_test.rs
use rusqlite::Connection;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_yjs_state_roundtrip() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("document.yjs");
    
    // Simulate Yjs state
    let original_state = vec![1, 2, 3, 4, 5, 6, 7, 8];
    
    // Write atomically
    let temp_path = file_path.with_extension("yjs.tmp");
    fs::write(&temp_path, &original_state).unwrap();
    fs::rename(&temp_path, &file_path).unwrap();
    
    // Read back
    let loaded_state = fs::read(&file_path).unwrap();
    
    assert_eq!(original_state, loaded_state);
    assert!(!temp_path.exists(), "Temp file should be cleaned up");
}

#[test]
fn test_yjs_overwrite_not_append() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("document.yjs");
    
    // Write first state
    fs::write(&file_path, &[1, 2, 3]).unwrap();
    
    // Write second state (should overwrite, not append)
    fs::write(&file_path, &[4, 5, 6]).unwrap();
    
    let final_state = fs::read(&file_path).unwrap();
    
    assert_eq!(final_state, vec![4, 5, 6]);
    assert_eq!(final_state.len(), 3, "Should be overwritten, not appended");
}

#[test]
fn test_patch_log_basic_operations() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create table
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL
        );
        "#,
    )
    .unwrap();
    
    // Insert test patch
    let timestamp = 1234567890;
    let author = "test_user";
    let kind = "semantic_group";
    let data = r#"{"patches":[{"kind":"insert_text"}]}"#;
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![timestamp, author, kind, data],
    )
    .unwrap();
    
    // Verify insertion
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM patches", [], |row| row.get(0))
        .unwrap();
    
    assert_eq!(count, 1);
    
    // Verify data
    let mut stmt = conn
        .prepare("SELECT timestamp, author, kind, data FROM patches WHERE id = 1")
        .unwrap();
    
    let result = stmt.query_row([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })
    .unwrap();
    
    assert_eq!(result.0, timestamp);
    assert_eq!(result.1, author);
    assert_eq!(result.2, kind);
    assert_eq!(result.3, data);
}

#[test]
fn test_patch_log_ordering() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    conn.execute_batch(
        r#"
        CREATE TABLE patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL
        );
        "#,
    )
    .unwrap();
    
    // Insert patches in non-chronological order
    let patches = vec![
        (3000, "user", "group", "{}"),
        (1000, "user", "group", "{}"),
        (2000, "user", "group", "{}"),
    ];
    
    for (ts, author, kind, data) in patches {
        conn.execute(
            "INSERT INTO patches (timestamp, author, kind, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![ts, author, kind, data],
        )
        .unwrap();
    }
    
    // Query in ID order (insertion order)
    let mut stmt = conn.prepare("SELECT timestamp FROM patches ORDER BY id ASC").unwrap();
    
    let timestamps: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    
    assert_eq!(timestamps, vec![3000, 1000, 2000]);
    
    // Query in timestamp order
    let mut stmt = conn.prepare("SELECT timestamp FROM patches ORDER BY timestamp ASC").unwrap();
    
    let sorted_timestamps: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    
    assert_eq!(sorted_timestamps, vec![1000, 2000, 3000]);
}

#[test]
fn test_concurrent_file_writes() {
    use std::thread;
    
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("concurrent.yjs");
    
    // Simulate multiple rapid writes (like rapid keystrokes)
    let handles: Vec<_> = (0..10)
        .map(|i| {
            let path = file_path.clone();
            thread::spawn(move || {
                let data = vec![i as u8; 10];
                let temp = path.with_extension("yjs.tmp");
                fs::write(&temp, &data).ok();
                fs::rename(&temp, &path).ok();
            })
        })
        .collect();
    
    for handle in handles {
        handle.join().unwrap();
    }
    
    // Verify file exists and has valid content
    assert!(file_path.exists());
    let final_data = fs::read(&file_path).unwrap();
    assert_eq!(final_data.len(), 10);
}

#[test]
fn test_json_data_integrity() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    conn.execute_batch(
        r#"
        CREATE TABLE patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL
        );
        "#,
    )
    .unwrap();
    
    // Insert complex JSON
    let complex_json = r#"{
        "patches": [
            {"kind": "insert_text", "at": 0, "text": "Hello"},
            {"kind": "delete_text", "range": [5, 10]},
            {"kind": "add_mark", "mark": "bold"}
        ]
    }"#;
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data) VALUES (?, ?, ?, ?)",
        rusqlite::params![12345, "user", "group", complex_json],
    )
    .unwrap();
    
    // Verify JSON is stored and retrieved correctly
    let retrieved: String = conn
        .query_row("SELECT data FROM patches WHERE id = 1", [], |row| row.get(0))
        .unwrap();
    
    // Parse to verify it's valid JSON
    let parsed: serde_json::Value = serde_json::from_str(&retrieved).unwrap();
    
    assert!(parsed["patches"].is_array());
    assert_eq!(parsed["patches"].as_array().unwrap().len(), 3);
}
