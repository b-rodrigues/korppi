use rusqlite::{params, Connection};
use crate::models::{Conflict, ConflictStatus, ResolutionInput};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;

fn db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap();
    std::fs::create_dir_all(&path).ok();
    path.push("korppi_conflicts.db");
    path
}

pub fn init_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app);
    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS conflicts (
            id              TEXT PRIMARY KEY,
            conflict_type   TEXT NOT NULL,
            base_content    TEXT NOT NULL,
            local_content   TEXT NOT NULL,
            local_author    TEXT NOT NULL,
            remote_content  TEXT NOT NULL,
            remote_author   TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'Unresolved',
            resolved_content TEXT,
            start_pos       INTEGER NOT NULL,
            end_pos         INTEGER NOT NULL,
            detected_at     INTEGER NOT NULL,
            resolved_at     INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_conflicts_status
        ON conflicts(status);
        "#,
    ).map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn store_conflict(conn: &Connection, conflict: &Conflict) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT OR REPLACE INTO conflicts
        (id, conflict_type, base_content, local_content, local_author,
         remote_content, remote_author, status, start_pos, end_pos, detected_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            conflict.id,
            format!("{:?}", conflict.conflict_type),
            conflict.base_version.content,
            conflict.local_version.content,
            conflict.local_version.author,
            conflict.remote_version.content,
            conflict.remote_version.author,
            format!("{:?}", conflict.status),
            conflict.local_version.start,
            conflict.local_version.end,
            conflict.detected_at,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn get_unresolved_conflicts(conn: &Connection) -> Result<Vec<Conflict>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, conflict_type, base_content, local_content, local_author,
                   remote_content, remote_author, start_pos, end_pos, detected_at
            FROM conflicts
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
                    start: row.get(7)?,
                    end: row.get(8)?,
                    content: row.get(2)?,
                    author: "base".to_string(),
                    timestamp: 0,
                },
                local_version: crate::models::TextSpan {
                    start: row.get(7)?,
                    end: row.get(8)?,
                    content: row.get(3)?,
                    author: row.get(4)?,
                    timestamp: row.get(9)?,
                },
                remote_version: crate::models::TextSpan {
                    start: row.get(7)?,
                    end: row.get(8)?,
                    content: row.get(5)?,
                    author: row.get(6)?,
                    timestamp: row.get(9)?,
                },
                status: ConflictStatus::Unresolved,
                detected_at: row.get(9)?,
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
        UPDATE conflicts
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
