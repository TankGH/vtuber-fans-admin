use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::crypto::Crypto;
use crate::error::{AppError, AppResult};
use crate::models::{ActivityDto, BootstrapDto, BackupHealth};
use crate::settings;

pub struct Db {
    pub conn: Connection,
    pub crypto: Crypto,
}

pub struct AppState {
    pub db: Mutex<Db>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&data_dir).map_err(|e| AppError::new("E_DB_OPEN", format!("数据目录创建失败：{e}")))?;
        let crypto = Crypto::load(&data_dir)?;
        let conn = open_connection(&data_dir)?;
        Ok(Self { db: Mutex::new(Db { conn, crypto }), data_dir })
    }

    pub fn lock_db(&self) -> AppResult<std::sync::MutexGuard<'_, Db>> {
        self.db.lock().map_err(|e| AppError::new("E_DB_OPEN", format!("数据库锁异常：{e}")))
    }
}

fn open_connection(data_dir: &Path) -> AppResult<Connection> {
    let path = data_dir.join("fans.db");
    let conn = Connection::open(&path).map_err(|e| AppError::new("E_DB_OPEN", format!("数据库打开失败：{e}")))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| AppError::new("E_DB_OPEN", format!("数据库初始化失败：{e}")))?;
    conn.execute_batch(include_str!("schema.sql"))
        .map_err(|e| AppError::new("E_DB_MIGRATE", format!("建表失败：{e}")))?;
    Ok(conn)
}

/// 一致性快照：VACUUM INTO 不破坏当前连接，产出可直接复制的 SQLite 文件
pub fn vacuum_into(conn: &Connection, target: &Path) -> AppResult<()> {
    if target.exists() {
        std::fs::remove_file(target).ok();
    }
    let path = target.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{path}';"))?;
    Ok(())
}

pub fn count(conn: &Connection, table: &str) -> AppResult<usize> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    let n: i64 = conn.query_row(&sql, [], |r| r.get(0))?;
    Ok(n as usize)
}

pub fn log_activity(conn: &Connection, kind: &str, summary: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO activity_log(kind, summary, created_at) VALUES (?1, ?2, ?3)",
        params![kind, summary, crate::crypto::now_iso()],
    )?;
    Ok(())
}

pub fn activities(conn: &Connection, limit: usize) -> AppResult<Vec<ActivityDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, summary, created_at FROM activity_log ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit as i64], |r| {
        Ok(ActivityDto {
            id: r.get(0)?,
            kind: r.get(1)?,
            summary: r.get(2)?,
            created_at: r.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn bootstrap(state: &AppState) -> AppResult<BootstrapDto> {
    let data_dir = state.data_dir.clone();
    let cfg = settings::load(&data_dir);
    // status_from_state 内部需要短暂持有数据库锁，必须在下方取得锁之前完成
    let sync_status = crate::sync::status_from_state(state)?;
    let reminder_days = cfg.reminder_days_ahead;
    let db = state.lock_db()?;
    let reminder_count = crate::reminder::pending_count(&db, reminder_days)?;
    let fan_count = count(&db.conn, "fan_profile")?;
    let snapshot_count = count(&db.conn, "guard_snapshot")?;
    let guard_count: usize = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM guard_snapshot_member WHERE snapshot_id = (SELECT MAX(id) FROM guard_snapshot)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let list = crate::backup::list_backups(state)?;
    let last_backup_at = list.first().map(|b| b.created_at.clone());
    let days_since_backup = last_backup_at.as_ref().and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(s).ok().map(|t| {
            (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_days()
        })
    });
    let healthy = days_since_backup.map(|d| d <= 3).unwrap_or(false);
    Ok(BootstrapDto {
        fan_count,
        guard_count,
        snapshot_count,
        conflict_count: 0,
        reminder_count,
        sync_status,
        settings: cfg.to_dto(&data_dir),
        backup_health: BackupHealth {
            last_backup_at,
            days_since_backup,
            backup_count: list.len(),
            healthy,
        },
        activities: activities(&db.conn, 8)?,
        data_dir: data_dir.to_string_lossy().to_string(),
        native_mode: true,
    })
}
