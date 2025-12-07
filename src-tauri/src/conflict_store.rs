use rusqlite::{params, Connection};
use crate::models::{Conflict, ConflictStatus, ResolutionInput};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&path).ok();
    path.push("korppi_conflicts.db");
    Ok(path)
}

pub fn init_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    // Using conflicts_v2 to ensure schema compatibility
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS conflicts_v2 (
            id              TEXT PRIMARY KEY,
            conflict_type   TEXT NOT NULL,
            base_content    TEXT NOT NULL,

            local_content   TEXT NOT NULL,
            local_author    TEXT NOT NULL,
            local_start     INTEGER NOT NULL,
            local_end       INTEGER NOT NULL,
            local_ts        INTEGER NOT NULL,

            remote_content  TEXT NOT NULL,
            remote_author   TEXT NOT NULL,
            remote_start    INTEGER NOT NULL,
            remote_end      INTEGER NOT NULL,
            remote_ts       INTEGER NOT NULL,

            base_start      INTEGER NOT NULL,
            base_end        INTEGER NOT NULL,

            status          TEXT NOT NULL DEFAULT 'Unresolved',
            resolved_content TEXT,

            detected_at     INTEGER NOT NULL,
            resolved_at     INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_conflicts_v2_status
        ON conflicts_v2(status);
        "#,
    ).map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn store_conflict(conn: &Connection, conflict: &Conflict) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT OR IGNORE INTO conflicts_v2
        (id, conflict_type, base_content,
         local_content, local_author, local_start, local_end, local_ts,
         remote_content, remote_author, remote_start, remote_end, remote_ts,
         base_start, base_end,
         status, detected_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        "#,
        params![
            conflict.id,
            format!("{:?}", conflict.conflict_type),
            conflict.base_version.content,

            conflict.local_version.content,
            conflict.local_version.author,
            conflict.local_version.start,
            conflict.local_version.end,
            conflict.local_version.timestamp,

            conflict.remote_version.content,
            conflict.remote_version.author,
            conflict.remote_version.start,
            conflict.remote_version.end,
            conflict.remote_version.timestamp,

            conflict.base_version.start,
            conflict.base_version.end,

            format!("{:?}", conflict.status),
            conflict.detected_at,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_unresolved_conflicts(conn: &Connection) -> Result<Vec<Conflict>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, conflict_type, base_content,
                   local_content, local_author, local_start, local_end, local_ts,
                   remote_content, remote_author, remote_start, remote_end, remote_ts,
                   base_start, base_end,
                   detected_at
            FROM conflicts_v2
            WHERE status = 'Unresolved'
            ORDER BY detected_at DESC
            "#
        )
        .map_err(|e| e.to_string())?;

    let conflicts = stmt
        .query_map([], |row| {
            Ok(Conflict {
                id: row.get(0)?,
                conflict_type: parse_conflict_type(row.get::<_, String>(1)?),
                base_version: crate::models::TextSpan {
                    start: row.get(13)?,
                    end: row.get(14)?,
                    content: row.get(2)?,
                    author: "base".to_string(),
                    timestamp: 0,
                },
                local_version: crate::models::TextSpan {
                    start: row.get(5)?,
                    end: row.get(6)?,
                    content: row.get(3)?,
                    author: row.get(4)?,
                    timestamp: row.get(7)?,
                },
                remote_version: crate::models::TextSpan {
                    start: row.get(10)?,
                    end: row.get(11)?,
                    content: row.get(8)?,
                    author: row.get(9)?,
                    timestamp: row.get(12)?,
                },
                status: ConflictStatus::Unresolved,
                detected_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(conflicts)
}

pub fn resolve_conflict(
    conn: &Connection,
    resolution: &ResolutionInput,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        r#"
        UPDATE conflicts_v2
        SET status = ?1, resolved_content = ?2, resolved_at = ?3
        WHERE id = ?4
        "#,
        params![
            format!("{:?}", resolution.resolution),
            resolution.merged_content,
            now,
            resolution.conflict_id,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

fn parse_conflict_type(s: String) -> crate::models::ConflictType {
    match s.as_str() {
        "OverlappingEdit" => crate::models::ConflictType::OverlappingEdit,
        "DeleteModify" => crate::models::ConflictType::DeleteModify,
        "ConcurrentInsert" => crate::models::ConflictType::ConcurrentInsert,
        "StructuralConflict" => crate::models::ConflictType::StructuralConflict,
        _ => crate::models::ConflictType::OverlappingEdit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{TextSpan, ConflictType};

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS conflicts_v2 (
                id              TEXT PRIMARY KEY,
                conflict_type   TEXT NOT NULL,
                base_content    TEXT NOT NULL,
                local_content   TEXT NOT NULL,
                local_author    TEXT NOT NULL,
                local_start     INTEGER NOT NULL,
                local_end       INTEGER NOT NULL,
                local_ts        INTEGER NOT NULL,
                remote_content  TEXT NOT NULL,
                remote_author   TEXT NOT NULL,
                remote_start    INTEGER NOT NULL,
                remote_end      INTEGER NOT NULL,
                remote_ts       INTEGER NOT NULL,
                base_start      INTEGER NOT NULL,
                base_end        INTEGER NOT NULL,
                status          TEXT NOT NULL DEFAULT 'Unresolved',
                resolved_content TEXT,
                detected_at     INTEGER NOT NULL,
                resolved_at     INTEGER
            );
            "#,
        ).unwrap();
        conn
    }

    fn create_test_conflict(id: &str) -> Conflict {
        Conflict {
            id: id.to_string(),
            conflict_type: ConflictType::OverlappingEdit,
            base_version: TextSpan {
                start: 0,
                end: 5,
                content: "base".to_string(),
                author: "base".to_string(),
                timestamp: 1000,
            },
            local_version: TextSpan {
                start: 0,
                end: 6,
                content: "local".to_string(),
                author: "Alice".to_string(),
                timestamp: 2000,
            },
            remote_version: TextSpan {
                start: 0,
                end: 7,
                content: "remote".to_string(),
                author: "Bob".to_string(),
                timestamp: 3000,
            },
            status: ConflictStatus::Unresolved,
            detected_at: 4000,
        }
    }

    #[test]
    fn test_store_conflict() {
        let conn = create_test_db();
        let conflict = create_test_conflict("test-1");
        
        let result = store_conflict(&conn, &conflict);
        assert!(result.is_ok());

        // Verify stored
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM conflicts_v2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_get_unresolved_conflicts() {
        let conn = create_test_db();
        
        // Insert test conflict
        let conflict = create_test_conflict("test-2");
        store_conflict(&conn, &conflict).unwrap();
        
        let unresolved = get_unresolved_conflicts(&conn).unwrap();
        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].id, "test-2");
    }

    #[test]
    fn test_resolve_conflict() {
        let conn = create_test_db();
        
        let conflict = create_test_conflict("test-3");
        store_conflict(&conn, &conflict).unwrap();
        
        let resolution = ResolutionInput {
            conflict_id: "test-3".to_string(),
            resolution: ConflictStatus::ResolvedLocal,
            merged_content: Some("resolved content".to_string()),
        };
        
        resolve_conflict(&conn, &resolution).unwrap();
        
        // Should no longer be unresolved
        let unresolved = get_unresolved_conflicts(&conn).unwrap();
        assert_eq!(unresolved.len(), 0);
    }

    #[test]
    fn test_parse_conflict_type() {
        assert!(matches!(parse_conflict_type("OverlappingEdit".to_string()), ConflictType::OverlappingEdit));
        assert!(matches!(parse_conflict_type("DeleteModify".to_string()), ConflictType::DeleteModify));
        assert!(matches!(parse_conflict_type("ConcurrentInsert".to_string()), ConflictType::ConcurrentInsert));
        assert!(matches!(parse_conflict_type("StructuralConflict".to_string()), ConflictType::StructuralConflict));
        assert!(matches!(parse_conflict_type("Unknown".to_string()), ConflictType::OverlappingEdit)); // default
    }

    #[test]
    fn test_duplicate_conflict_ignored() {
        let conn = create_test_db();
        
        let conflict = create_test_conflict("dup-1");
        store_conflict(&conn, &conflict).unwrap();
        
        // Insert again - should be ignored (INSERT OR IGNORE)
        store_conflict(&conn, &conflict).unwrap();
        
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM conflicts_v2", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}

