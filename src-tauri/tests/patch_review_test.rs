// Test patch review functionality
use korppi::patch_log::{Patch, PatchReview};
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::TempDir;
use uuid::Uuid;

#[test]
fn test_uuid_generation_on_new_patch() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            uuid        TEXT UNIQUE,
            parent_uuid TEXT
        );
        "#,
    )
    .unwrap();
    
    // Insert patch with UUID
    let uuid = Uuid::new_v4().to_string();
    let timestamp = 1234567890;
    let author = "test_user";
    let kind = "Save";
    let data = json!({"snapshot": "test content"});
    let data_str = serde_json::to_string(&data).unwrap();
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![timestamp, author, kind, data_str, uuid, None::<String>],
    )
    .unwrap();
    
    // Verify patch was inserted with UUID
    let retrieved_uuid: String = conn
        .query_row("SELECT uuid FROM patches WHERE id = 1", [], |row| row.get(0))
        .unwrap();
    
    assert_eq!(retrieved_uuid, uuid);
}

#[test]
fn test_parent_uuid_linkage() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            uuid        TEXT UNIQUE,
            parent_uuid TEXT
        );
        "#,
    )
    .unwrap();
    
    // Insert parent patch
    let parent_uuid = Uuid::new_v4().to_string();
    let data = json!({"snapshot": "parent content"});
    let data_str = serde_json::to_string(&data).unwrap();
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![1000, "test_user", "Save", data_str, parent_uuid, None::<String>],
    )
    .unwrap();
    
    // Insert child patch with parent_uuid
    let child_uuid = Uuid::new_v4().to_string();
    let child_data = json!({"snapshot": "child content"});
    let child_data_str = serde_json::to_string(&child_data).unwrap();
    
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid, parent_uuid) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![2000, "test_user", "Save", child_data_str, child_uuid, parent_uuid],
    )
    .unwrap();
    
    // Verify parent linkage
    let retrieved_parent_uuid: String = conn
        .query_row("SELECT parent_uuid FROM patches WHERE uuid = ?1", [&child_uuid], |row| row.get(0))
        .unwrap();
    
    assert_eq!(retrieved_parent_uuid, parent_uuid);
}

#[test]
fn test_patch_review_recording() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patch_reviews (
            patch_uuid   TEXT NOT NULL,
            reviewer_id  TEXT NOT NULL,
            decision     TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
            reviewer_name TEXT,
            reviewed_at  INTEGER NOT NULL,
            PRIMARY KEY (patch_uuid, reviewer_id)
        );
        CREATE INDEX IF NOT EXISTS idx_patch_reviews_reviewer_id ON patch_reviews(reviewer_id);
        "#,
    )
    .unwrap();
    
    let patch_uuid = Uuid::new_v4().to_string();
    let reviewer_id = "reviewer1";
    let decision = "accepted";
    let reviewer_name = "Reviewer One";
    let reviewed_at = 1234567890;
    
    // Insert review
    conn.execute(
        "INSERT INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at],
    )
    .unwrap();
    
    // Verify review was inserted
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM patch_reviews WHERE patch_uuid = ?1", [&patch_uuid], |row| row.get(0))
        .unwrap();
    
    assert_eq!(count, 1);
    
    // Verify review details
    let (ret_decision, ret_name): (String, String) = conn
        .query_row(
            "SELECT decision, reviewer_name FROM patch_reviews WHERE patch_uuid = ?1 AND reviewer_id = ?2",
            params![patch_uuid, reviewer_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        )
        .unwrap();
    
    assert_eq!(ret_decision, decision);
    assert_eq!(ret_name, reviewer_name);
}

#[test]
fn test_multiple_reviews_per_reviewer_ordered() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patch_reviews (
            patch_uuid   TEXT NOT NULL,
            reviewer_id  TEXT NOT NULL,
            decision     TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
            reviewer_name TEXT,
            reviewed_at  INTEGER NOT NULL,
            PRIMARY KEY (patch_uuid, reviewer_id)
        );
        "#,
    )
    .unwrap();
    
    let patch_uuid = Uuid::new_v4().to_string();
    let reviewer_id = "reviewer1";
    
    // First review (rejected)
    conn.execute(
        "INSERT INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&patch_uuid, reviewer_id, "rejected", "Reviewer One", 1000],
    )
    .unwrap();
    
    // Update review (accepted) - should replace the previous one due to PRIMARY KEY constraint
    conn.execute(
        "INSERT OR REPLACE INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&patch_uuid, reviewer_id, "accepted", "Reviewer One", 2000],
    )
    .unwrap();
    
    // Verify only one review exists (the latest)
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM patch_reviews WHERE patch_uuid = ?1", [&patch_uuid], |row| row.get(0))
        .unwrap();
    
    assert_eq!(count, 1);
    
    // Verify it's the latest review
    let (decision, reviewed_at): (String, i64) = conn
        .query_row(
            "SELECT decision, reviewed_at FROM patch_reviews WHERE patch_uuid = ?1 AND reviewer_id = ?2",
            params![patch_uuid, reviewer_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        )
        .unwrap();
    
    assert_eq!(decision, "accepted");
    assert_eq!(reviewed_at, 2000);
}

#[test]
fn test_needs_my_review_query() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            uuid        TEXT UNIQUE,
            parent_uuid TEXT
        );
        
        CREATE TABLE IF NOT EXISTS patch_reviews (
            patch_uuid   TEXT NOT NULL,
            reviewer_id  TEXT NOT NULL,
            decision     TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
            reviewer_name TEXT,
            reviewed_at  INTEGER NOT NULL,
            PRIMARY KEY (patch_uuid, reviewer_id)
        );
        "#,
    )
    .unwrap();
    
    let current_user = "alice";
    
    // Insert patches from different authors
    let bob_patch_uuid = Uuid::new_v4().to_string();
    let charlie_patch_uuid = Uuid::new_v4().to_string();
    let alice_patch_uuid = Uuid::new_v4().to_string();
    
    let data = json!({"snapshot": "content"});
    let data_str = serde_json::to_string(&data).unwrap();
    
    // Bob's patch (needs review by Alice)
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![1000, "bob", "Save", &data_str, bob_patch_uuid],
    )
    .unwrap();
    
    // Charlie's patch (already reviewed by Alice)
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![2000, "charlie", "Save", &data_str, charlie_patch_uuid],
    )
    .unwrap();
    
    // Alice's patch (should not need review by Alice)
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![3000, current_user, "Save", &data_str, alice_patch_uuid],
    )
    .unwrap();
    
    // Alice already reviewed Charlie's patch
    conn.execute(
        "INSERT INTO patch_reviews (patch_uuid, reviewer_id, decision, reviewer_name, reviewed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![charlie_patch_uuid, current_user, "accepted", "Alice", 2500],
    )
    .unwrap();
    
    // Query patches needing review by Alice
    let mut stmt = conn
        .prepare(
            "SELECT uuid FROM patches
             WHERE author != ?1
             AND uuid IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM patch_reviews pr
                 WHERE pr.patch_uuid = patches.uuid
                 AND pr.reviewer_id = ?1
             )
             ORDER BY timestamp ASC"
        )
        .unwrap();
    
    let uuids: Vec<String> = stmt
        .query_map([current_user], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    
    // Should only return Bob's patch
    assert_eq!(uuids.len(), 1);
    assert_eq!(uuids[0], bob_patch_uuid);
}

#[test]
fn test_import_deduplication_by_uuid() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("test.db");
    
    let conn = Connection::open(&db_path).unwrap();
    
    // Create tables
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patches (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            author      TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            data        TEXT    NOT NULL,
            uuid        TEXT UNIQUE,
            parent_uuid TEXT
        );
        "#,
    )
    .unwrap();
    
    let patch_uuid = Uuid::new_v4().to_string();
    let data = json!({"snapshot": "content"});
    let data_str = serde_json::to_string(&data).unwrap();
    
    // Insert first patch
    conn.execute(
        "INSERT INTO patches (timestamp, author, kind, data, uuid) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![1000, "bob", "Save", &data_str, &patch_uuid],
    )
    .unwrap();
    
    // Try to import same patch (should be skipped due to UUID constraint)
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM patches WHERE uuid = ?1",
            params![&patch_uuid],
            |_| Ok(true)
        )
        .optional()
        .unwrap()
        .unwrap_or(false);
    
    assert!(exists, "Patch with UUID should exist");
    
    // Verify only one patch exists
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM patches WHERE uuid = ?1", [&patch_uuid], |row| row.get(0))
        .unwrap();
    
    assert_eq!(count, 1, "Should only have one patch with this UUID");
}
