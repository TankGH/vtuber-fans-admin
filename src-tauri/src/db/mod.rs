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

/// 一键清除本机全部业务数据、备份与配置；保留加密密钥以保证应用后续可正常使用。
/// 必须携带二次确认参数，且只删除本应用生成的文件。
pub fn clear_all(state: &AppState, confirm: bool) -> AppResult<()> {
    if !confirm {
        return Err(AppError::invalid("清除全部数据需要二次确认"));
    }
    {
        let mut db = state.lock_db()?;
        let tx = db.conn.transaction()?;
        for table in [
            "gift_shipment", "gift_batch", "guard_snapshot_member", "guard_snapshot",
            "guard_event", "fan_nickname_history", "reminder_ack", "custom_reminder",
            "ledger_entry", "activity_log", "app_settings", "import_batch", "fan_profile",
        ] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        let _ = tx.execute("DELETE FROM sqlite_sequence", []);
        tx.commit()?;
    }
    crate::backup::purge_app_files(state)?;
    crate::backup::clear_restore_marker(&state.data_dir)?;
    for entry in std::fs::read_dir(&state.data_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if (name.starts_with("vacuum-") && name.ends_with(".db")) || name == "restore-candidate.db" {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    settings::clear(&state.data_dir)?;
    Ok(())
}

pub fn bootstrap(state: &AppState) -> AppResult<BootstrapDto> {
    let data_dir = state.data_dir.clone();
    let cfg = settings::load(&data_dir);
    let reminder_days = cfg.reminder_days_ahead;
    let db = state.lock_db()?;
    let reminder_count = crate::reminder::pending_count(&db, reminder_days, &cfg)?;
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
