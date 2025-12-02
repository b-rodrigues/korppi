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
