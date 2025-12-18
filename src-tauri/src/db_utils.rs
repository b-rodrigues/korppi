// src-tauri/src/db_utils.rs
use rusqlite::Connection;
use uuid::Uuid;

pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    // 1. Add columns first (ignore errors if they exist)
    // Note: SQLite ALTER TABLE ADD COLUMN does not support UNIQUE constraint directly
    conn.execute("ALTER TABLE patches ADD COLUMN uuid TEXT", []).ok();
    conn.execute("ALTER TABLE patches ADD COLUMN parent_uuid TEXT", []).ok();

    // 2. Create tables (for new docs) and Indices (for all)
    // For new tables, we define the schema fully.
    // For existing tables, IF NOT EXISTS will skip table creation, but indices will be created.
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

        CREATE TABLE IF NOT EXISTS snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            patch_id    INTEGER NOT NULL,
            state       BLOB    NOT NULL,
            FOREIGN KEY (patch_id) REFERENCES patches(id)
        );

        CREATE TABLE IF NOT EXISTS patch_reviews (
            patch_uuid   TEXT NOT NULL,
            reviewer_id  TEXT NOT NULL,
            decision     TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
            reviewer_name TEXT,
            reviewed_at  INTEGER NOT NULL,
            PRIMARY KEY (patch_uuid, reviewer_id)
        );

        CREATE TABLE IF NOT EXISTS document_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp    INTEGER NOT NULL,
            event_type   TEXT NOT NULL,
            author_id    TEXT NOT NULL,
            author_name  TEXT NOT NULL,
            author_color TEXT,
            details      TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_snapshots_patch_id ON snapshots(patch_id);
        CREATE INDEX IF NOT EXISTS idx_patch_reviews_reviewer_id ON patch_reviews(reviewer_id);
        -- Use unique index to enforce uniqueness on the uuid column (covers both new and migrated tables)
        CREATE UNIQUE INDEX IF NOT EXISTS idx_patches_uuid ON patches(uuid);
        -- Performance indexes for common query patterns
        CREATE INDEX IF NOT EXISTS idx_patches_timestamp ON patches(timestamp);
        CREATE INDEX IF NOT EXISTS idx_patches_author ON patches(author);
        CREATE INDEX IF NOT EXISTS idx_patches_kind ON patches(kind);
        CREATE INDEX IF NOT EXISTS idx_patch_reviews_patch_uuid ON patch_reviews(patch_uuid);
        CREATE INDEX IF NOT EXISTS idx_document_events_timestamp ON document_events(timestamp);
        "#,
    )
    .map_err(|e| e.to_string())?;

    // 3. Backfill UUIDs for existing patches that are NULL
    // We do this in Rust to ensure consistent UUIDv4 formatting
    {
        let mut stmt = conn.prepare("SELECT id FROM patches WHERE uuid IS NULL").map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for id in ids {
            let new_uuid = Uuid::new_v4().to_string();
            conn.execute("UPDATE patches SET uuid = ?1 WHERE id = ?2", rusqlite::params![new_uuid, id])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
