// src-tauri/src/comments.rs
//! Comments module for document annotations.
//!
//! Stores comments with Yjs relative position anchors for stable positioning.
//! Supports threaded replies via parent_id.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::document_manager::DocumentManager;

/// Input for creating a new comment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentInput {
    pub author: String,
    pub author_color: Option<String>,
    pub start_anchor: String, // JSON-serialized Yjs RelativePosition
    pub end_anchor: String,   // JSON-serialized Yjs RelativePosition
    pub selected_text: String,
    pub content: String,
    pub parent_id: Option<i64>,
}

/// A stored comment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: i64,
    pub timestamp: i64,
    pub author: String,
    pub author_color: Option<String>,
    pub start_anchor: String,
    pub end_anchor: String,
    pub selected_text: String,
    pub content: String,
    pub status: String,
    pub parent_id: Option<i64>,
}

/// Initialize comments table in a document's history database
pub fn init_comments_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS comments (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       INTEGER NOT NULL,
            author          TEXT    NOT NULL,
            author_color    TEXT,
            start_anchor    TEXT    NOT NULL,
            end_anchor      TEXT    NOT NULL,
            selected_text   TEXT    NOT NULL,
            content         TEXT    NOT NULL,
            status          TEXT    DEFAULT 'unresolved',
            parent_id       INTEGER,
            FOREIGN KEY (parent_id) REFERENCES comments(id)
        );

        CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
        CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Add a comment to a document
#[tauri::command]
pub fn add_comment(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    comment: CommentInput,
) -> Result<i64, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    init_comments_table(&conn)?;

    let timestamp = chrono::Utc::now().timestamp_millis();

    conn.execute(
        r#"
        INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, parent_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            timestamp,
            comment.author,
            comment.author_color,
            comment.start_anchor,
            comment.end_anchor,
            comment.selected_text,
            comment.content,
            comment.parent_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(id)
}

/// List comments for a document
#[tauri::command]
pub fn list_comments(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    status_filter: Option<String>,
) -> Result<Vec<Comment>, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    init_comments_table(&conn)?;

    let base_query = "SELECT id, timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, status, parent_id FROM comments";

    // Helper closure to map rows to Comment
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Comment> {
        Ok(Comment {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            author: row.get(2)?,
            author_color: row.get(3)?,
            start_anchor: row.get(4)?,
            end_anchor: row.get(5)?,
            selected_text: row.get(6)?,
            content: row.get(7)?,
            status: row.get(8)?,
            parent_id: row.get(9)?,
        })
    };

    if let Some(status) = &status_filter {
        // Validate status to prevent injection (only allow known values)
        let valid_statuses = ["unresolved", "resolved", "deleted"];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(format!(
                "Invalid status filter: {}. Must be one of: unresolved, resolved, deleted",
                status
            ));
        }

        let query = format!("{} WHERE status = ?1 ORDER BY timestamp ASC", base_query);
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let comments: Vec<Comment> = stmt
            .query_map(params![status], map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(comments)
    } else {
        let query = format!("{} ORDER BY timestamp ASC", base_query);
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let comments: Vec<Comment> = stmt
            .query_map([], map_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(comments)
    }
}

/// Add a reply to an existing comment
#[tauri::command]
pub fn add_reply(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    parent_id: i64,
    content: String,
    author: String,
    author_color: Option<String>,
) -> Result<i64, String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;
    init_comments_table(&conn)?;

    // Get parent comment's anchors
    let parent: Comment = conn
        .query_row(
            "SELECT id, timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, status, parent_id FROM comments WHERE id = ?1",
            params![parent_id],
            |row| {
                Ok(Comment {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    author: row.get(2)?,
                    author_color: row.get(3)?,
                    start_anchor: row.get(4)?,
                    end_anchor: row.get(5)?,
                    selected_text: row.get(6)?,
                    content: row.get(7)?,
                    status: row.get(8)?,
                    parent_id: row.get(9)?,
                })
            },
        )
        .map_err(|e| format!("Parent comment not found: {}", e))?;

    let timestamp = chrono::Utc::now().timestamp_millis();

    // Reply inherits parent's anchors
    conn.execute(
        r#"
        INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, parent_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            timestamp,
            author,
            author_color,
            parent.start_anchor,
            parent.end_anchor,
            parent.selected_text,
            content,
            parent_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(id)
}

/// Resolve a comment (mark as resolved)
#[tauri::command]
pub fn resolve_comment(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    comment_id: i64,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE comments SET status = 'resolved' WHERE id = ?1",
        params![comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Delete a comment
#[tauri::command]
pub fn delete_comment(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    comment_id: i64,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Delete the comment and its replies
    conn.execute(
        "DELETE FROM comments WHERE id = ?1 OR parent_id = ?1",
        params![comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Mark a comment as deleted (soft delete - keeps it in DB but with 'deleted' status)
#[tauri::command]
pub fn mark_comment_deleted(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    comment_id: i64,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Mark this comment and its replies as deleted
    conn.execute(
        "UPDATE comments SET status = 'deleted' WHERE id = ?1 OR parent_id = ?1",
        params![comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Restore a deleted comment (set status back to 'unresolved')
#[tauri::command]
pub fn restore_comment(
    manager: State<'_, Mutex<DocumentManager>>,
    doc_id: String,
    comment_id: i64,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|e| e.to_string())?;

    let doc = manager
        .documents
        .get(&doc_id)
        .ok_or_else(|| format!("Document not found: {}", doc_id))?;

    let conn = Connection::open(&doc.history_path).map_err(|e| e.to_string())?;

    // Restore this comment and its replies
    conn.execute(
        "UPDATE comments SET status = 'unresolved' WHERE id = ?1 OR parent_id = ?1",
        params![comment_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_comments_table(&conn).unwrap();
        conn
    }

    fn insert_test_comment(conn: &Connection, author: &str, content: &str) -> i64 {
        let timestamp = chrono::Utc::now().timestamp_millis();
        conn.execute(
            r#"INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![timestamp, author, "#ff0000", "anchor_start", "anchor_end", "selected", content],
        ).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn test_init_comments_table() {
        let conn = Connection::open_in_memory().unwrap();
        let result = init_comments_table(&conn);
        assert!(result.is_ok());

        // Verify table exists
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='comments'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_insert_comment() {
        let conn = create_test_db();
        let id = insert_test_comment(&conn, "TestUser", "Test comment");
        assert!(id > 0);
    }

    #[test]
    fn test_comment_default_status() {
        let conn = create_test_db();
        let id = insert_test_comment(&conn, "TestUser", "Test comment");

        let status: String = conn
            .query_row(
                "SELECT status FROM comments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "unresolved");
    }

    #[test]
    fn test_resolve_comment() {
        let conn = create_test_db();
        let id = insert_test_comment(&conn, "TestUser", "Test comment");

        conn.execute(
            "UPDATE comments SET status = 'resolved' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let status: String = conn
            .query_row(
                "SELECT status FROM comments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "resolved");
    }

    #[test]
    fn test_mark_deleted() {
        let conn = create_test_db();
        let id = insert_test_comment(&conn, "TestUser", "Test comment");

        conn.execute(
            "UPDATE comments SET status = 'deleted' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let status: String = conn
            .query_row(
                "SELECT status FROM comments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "deleted");
    }

    #[test]
    fn test_restore_comment() {
        let conn = create_test_db();
        let id = insert_test_comment(&conn, "TestUser", "Test comment");

        // Delete then restore
        conn.execute(
            "UPDATE comments SET status = 'deleted' WHERE id = ?1",
            params![id],
        )
        .unwrap();
        conn.execute(
            "UPDATE comments SET status = 'unresolved' WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let status: String = conn
            .query_row(
                "SELECT status FROM comments WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "unresolved");
    }

    #[test]
    fn test_comment_with_reply() {
        let conn = create_test_db();
        let parent_id = insert_test_comment(&conn, "Author1", "Parent comment");

        // Insert reply
        let timestamp = chrono::Utc::now().timestamp_millis();
        conn.execute(
            r#"INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, parent_id)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![timestamp, "Author2", "#00ff00", "anchor_start", "anchor_end", "selected", "Reply", parent_id],
        ).unwrap();
        let reply_id = conn.last_insert_rowid();

        // Verify parent_id is set
        let fetched_parent: Option<i64> = conn
            .query_row(
                "SELECT parent_id FROM comments WHERE id = ?1",
                params![reply_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fetched_parent, Some(parent_id));
    }

    #[test]
    fn test_delete_cascades_to_replies() {
        let conn = create_test_db();
        let parent_id = insert_test_comment(&conn, "Author1", "Parent");

        // Add reply
        let timestamp = chrono::Utc::now().timestamp_millis();
        conn.execute(
            r#"INSERT INTO comments (timestamp, author, author_color, start_anchor, end_anchor, selected_text, content, parent_id)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            params![timestamp, "Author2", "#00ff00", "a", "b", "s", "Reply", parent_id],
        ).unwrap();

        // Mark parent as deleted (should cascade)
        conn.execute(
            "UPDATE comments SET status = 'deleted' WHERE id = ?1 OR parent_id = ?1",
            params![parent_id],
        )
        .unwrap();

        // Both should be deleted
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM comments WHERE status = 'deleted'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
