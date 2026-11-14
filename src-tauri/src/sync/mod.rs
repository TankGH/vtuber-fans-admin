pub mod bilibili;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use chrono::{Local, Timelike};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::crypto::now_iso;
use crate::db::{log_activity, AppState, Db};
use crate::error::{AppError, AppResult};
use crate::models::{
    ParsedRow, SyncQrDto, SyncQrPollDto, SyncSnapshotResultDto, SyncStatusDto,
};
use crate::{guard, profile, settings};

/// 后续新增其它同步源时的扩展点；当前 HTTP 实现为 `bilibili::BiliSource`
pub trait SyncSource: Send + Sync {
    fn fetch_guard_snapshot(&self, room_id: &str) -> AppResult<Vec<GuardMember>>;
    fn source_kind(&self) -> &'static str;
}

#[derive(Debug, Clone)]
pub struct GuardMember {
    pub uid: String,
    pub nickname: String,
    pub guard_level: i32,
    pub rank: Option<i32>,
}

pub const SYNC_STATUS: &str = "自动抓取默认关闭；用户显式启用后可按需扫码登录，凭证加密保存在本机，失败时降级到手动导入";

// ---- 进程内同步状态（不落盘，重启后由 settings / 凭证文件恢复） ----

pub struct QrSession {
    pub key: String,
    pub created_at: i64,
}

#[derive(Default)]
pub struct SyncState {
    pub qr: Mutex<Option<QrSession>>,
    pub last_error: Mutex<Option<String>>,
    pub last_sync_at: Mutex<Option<String>>,
}

fn guard_mutex<T>(m: &Mutex<T>) -> AppResult<MutexGuard<'_, T>> {
    m.lock().map_err(|e| AppError::new("E_INTERNAL", format!("同步状态锁异常：{e}")))
}

fn set_error(app: &tauri::AppHandle, message: Option<String>) {
    if let Some(s) = app.try_state::<SyncState>() {
        if let Ok(mut slot) = s.last_error.lock() { *slot = message; }
    }
}

fn app_state(app: &tauri::AppHandle) -> AppResult<tauri::State<'_, AppState>> {
    app.try_state::<AppState>()
        .ok_or_else(|| AppError::new("E_INTERNAL", "本地数据尚未就绪"))
}

fn sync_state(app: &tauri::AppHandle) -> AppResult<tauri::State<'_, SyncState>> {
    app.try_state::<SyncState>()
        .ok_or_else(|| AppError::new("E_INTERNAL", "同步状态尚未就绪"))
}

// ---- 凭证：AES-256-GCM + DPAPI 主密钥加密，绝不出现在日志或备份清单中 ----

const SESSION_FILE: &str = "bili_session.enc";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiliSession {
    pub cookie: String,
    pub mid: String,
    pub uname: String,
    pub saved_at: String,
}

pub fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join(SESSION_FILE)
}

pub fn load_session(db: &Db, data_dir: &Path) -> AppResult<Option<BiliSession>> {
    let path = session_path(data_dir);
    if !path.exists() { return Ok(None); }
    let blob = std::fs::read(&path)
        .map_err(|e| AppError::new("E_SYNC_COOKIE", format!("本地凭证读取失败：{e}")))?;
    db.crypto.decrypt_json::<BiliSession>(&blob)
        .map(Some)
        .map_err(|e| AppError::new("E_SYNC_COOKIE", format!("本地凭证已损坏，请重新扫码登录：{}", e.message)))
}

pub fn save_session(db: &Db, data_dir: &Path, session: &BiliSession) -> AppResult<()> {
    let blob = db.crypto.encrypt_json(session)?;
    std::fs::write(session_path(data_dir), blob)
        .map_err(|e| AppError::new("E_SYNC_COOKIE", format!("本地凭证保存失败：{e}")))
}

pub fn clear_session(data_dir: &Path) -> AppResult<()> {
    let path = session_path(data_dir);
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|e| AppError::new("E_SYNC_COOKIE", format!("本地凭证清除失败：{e}")))?;
    }
    Ok(())
}

fn mark_expired(db: &Db, expired: bool) -> AppResult<()> {
    db.conn.execute(
        "INSERT INTO app_meta(key, value) VALUES ('bili_login_expired', ?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![if expired { "1" } else { "0" }],
    )?;
    Ok(())
}

fn is_expired(db: &Db) -> bool {
    db.conn.query_row(
        "SELECT value FROM app_meta WHERE key='bili_login_expired'", [], |r| r.get::<_, String>(0),
    ).ok().as_deref() == Some("1")
}

fn login_state(db: &Db, data_dir: &Path, enabled: bool) -> &'static str {
    if !enabled { return "disabled"; }
    if !session_path(data_dir).exists() { return "not_logged_in"; }
    if is_expired(db) { return "expired"; }
    "logged_in"
}

// ---- 对外能力 ----

/// 不依赖 AppHandle 的状态快照，供 app_bootstrap 使用
pub fn status_from_state(state: &AppState) -> AppResult<SyncStatusDto> {
    let cfg = settings::load(&state.data_dir);
    let db = state.lock_db()?;
    let session = load_session(&db, &state.data_dir)?;
    let login = login_state(&db, &state.data_dir, cfg.sync_enabled);
    drop(db);
    let message = match login {
        "disabled" => "自动抓取已关闭，不会发起任何外部请求；名单可通过 CSV / Excel 手动导入。".to_string(),
        "not_logged_in" => "已启用自动抓取，尚未登录。点击「扫码登录 B 站」按需完成登录。".to_string(),
        "expired" => "登录态已失效，请重新扫码登录；也可继续手动导入名单。".to_string(),
        _ => "登录有效，可立即同步或等待每日定时快照。".to_string(),
    };
    Ok(SyncStatusDto {
        enabled: cfg.sync_enabled,
        login_state: login.to_string(),
        cookie_configured: cfg.cookie_configured,
        mid: session.as_ref().map(|s| s.mid.clone()).unwrap_or_default(),
        uname: session.as_ref().map(|s| s.uname.clone()).unwrap_or_default(),
        room_id: cfg.room_id,
        snapshot_hour: cfg.snapshot_hour,
        last_sync_at: None,
        last_error: None,
        message,
    })
}

pub fn status(app: &tauri::AppHandle) -> AppResult<SyncStatusDto> {
    let mut dto = status_from_state(&*app_state(app)?)?;
    let rt = sync_state(app)?;
    dto.last_error = guard_mutex(&rt.last_error)?.clone();
    dto.last_sync_at = guard_mutex(&rt.last_sync_at)?.clone();
    Ok(dto)
}

fn require_enabled(app: &tauri::AppHandle) -> AppResult<()> {
    let state = app_state(app)?;
    if !settings::load(&state.data_dir).sync_enabled {
        return Err(AppError::invalid("自动抓取未启用，请先在设置中主动开启"));
    }
    Ok(())
}

pub fn set_enabled(app: &tauri::AppHandle, enabled: bool, confirm: bool) -> AppResult<SyncStatusDto> {
    if enabled && !confirm {
        return Err(AppError::invalid("启用自动抓取需要确认：启用后才会按需访问 B 站接口"));
    }
    let state = app_state(app)?;
    settings::set_sync_enabled(&state.data_dir, enabled)?;
    {
        let db = state.lock_db()?;
        log_activity(&db.conn, "sync", if enabled { "用户主动启用自动抓取" } else { "用户关闭自动抓取" })?;
    }
    let rt = sync_state(app)?;
    if !enabled {
        *guard_mutex(&rt.qr)? = None;
        *guard_mutex(&rt.last_error)? = None;
    }
    status(app)
}

pub fn qr_start(app: &tauri::AppHandle) -> AppResult<SyncQrDto> {
    require_enabled(app)?;
    let ticket = bilibili::qr_generate()?;
    let svg = bilibili::qr_svg(&ticket.url)?;
    let rt = sync_state(app)?;
    *guard_mutex(&rt.qr)? = Some(QrSession { key: ticket.key.clone(), created_at: bilibili::unix_seconds() });
    *guard_mutex(&rt.last_error)? = None;
    Ok(SyncQrDto {
        qr_svg: svg,
        qr_url: ticket.url,
        qrcode_key: ticket.key,
        expires_in: 180,
        message: "请使用 B 站 App 扫码并在手机上确认；二维码仅在本机生成。".to_string(),
    })
}

pub fn qr_poll(app: &tauri::AppHandle) -> AppResult<SyncQrPollDto> {
    require_enabled(app)?;
    let rt = sync_state(app)?;
    let key = guard_mutex(&rt.qr)?.as_ref().map(|q| q.key.clone())
        .ok_or_else(|| AppError::invalid("二维码会话已结束，请重新生成"))?;
    let result = bilibili::qr_poll(&key);
    let result = match result {
        Ok(v) => v,
        Err(e) => {
            *guard_mutex(&rt.last_error)? = Some(e.message.clone());
            *guard_mutex(&rt.qr)? = None;
            return Err(e);
        }
    };
    if result.state == "expired" || result.state == "error" {
        *guard_mutex(&rt.qr)? = None;
    }
    if result.state != "success" {
        return Ok(SyncQrPollDto { status: result.state, message: result.message, uname: None });
    }
    let cookie = result.cookie.unwrap_or_default();
    let account = bilibili::nav(&cookie).map_err(|e| {
        set_error(app, Some(e.message.clone()));
        e
    })?;
    let session = BiliSession {
        cookie,
        mid: account.mid,
        uname: account.uname.clone(),
        saved_at: now_iso(),
    };
    let state = app_state(app)?;
    {
        let db = state.lock_db()?;
        save_session(&db, &state.data_dir, &session)?;
        mark_expired(&db, false)?;
        log_activity(&db.conn, "sync", "扫码登录成功，凭证已加密保存到本机")?;
    }
    *guard_mutex(&rt.qr)? = None;
    *guard_mutex(&rt.last_error)? = None;
    Ok(SyncQrPollDto { status: "success".into(), message: "扫码登录成功，凭证已加密保存在本机".into(), uname: Some(account.uname) })
}

pub fn logout(app: &tauri::AppHandle) -> AppResult<SyncStatusDto> {
    let state = app_state(app)?;
    {
        let db = state.lock_db()?;
        clear_session(&state.data_dir)?;
        mark_expired(&db, false)?;
        log_activity(&db.conn, "sync", "用户退出 B 站登录并清除本机凭证")?;
    }
    let rt = sync_state(app)?;
    *guard_mutex(&rt.qr)? = None;
    status(app)
}

/// 把一次快照写入本地库：同日重复同步覆盖同一条快照，不产生重复记录；
/// 昵称与档案通过导入合并状态机复用，手动锁定字段始终不被覆盖。
pub fn apply_snapshot(db: &Db, room_id: &str, members: &[GuardMember], source: &str) -> AppResult<SyncSnapshotResultDto> {
    let date = Local::now().format("%Y-%m-%d").to_string();
    let now = now_iso();
    let crypto = db.crypto.clone();
    let tx = db.conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO guard_snapshot(snapshot_date, room_id, fetched_at, source, note) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(snapshot_date) DO UPDATE SET room_id=excluded.room_id, fetched_at=excluded.fetched_at,
           source=excluded.source, note=excluded.note",
        params![date, room_id, now, source, "网页端大航海名单快照"],
    )?;
    let snapshot_id: i64 = tx.query_row(
        "SELECT id FROM guard_snapshot WHERE snapshot_date=?1", [&date], |r| r.get(0),
    )?;
    tx.execute("DELETE FROM guard_snapshot_member WHERE snapshot_id=?1", [snapshot_id])?;
    for m in members {
        tx.execute(
            "INSERT INTO guard_snapshot_member(snapshot_id, uid, nickname, guard_level, rank) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(snapshot_id, uid) DO UPDATE SET nickname=excluded.nickname,
               guard_level=excluded.guard_level, rank=excluded.rank",
            params![snapshot_id, m.uid, m.nickname, m.guard_level, m.rank],
        )?;
    }
    let mut new_count = 0usize;
    let mut merge_count = 0usize;
    for m in members {
        let row = ParsedRow {
            row: 0, uid: m.uid.clone(), nickname: m.nickname.clone(),
            guard_level: Some(m.guard_level), rank: m.rank,
            first_interaction_at: String::new(), birthday: String::new(), address: String::new(),
            note: String::new(), unit_months: None, price_yuan: None,
        };
        if profile::upsert_from_import(&tx, &crypto, &row)? { new_count += 1; } else { merge_count += 1; }
    }
    tx.commit()?;
    log_activity(&db.conn, "sync", &format!("写入 {} 大航海快照：新增 {}、合并 {}", date, new_count, merge_count))?;
    Ok(SyncSnapshotResultDto {
        snapshot_id, snapshot_date: date, member_count: members.len(),
        new_count, merge_count, source: source.to_string(),
    })
}

pub fn snapshot_now(app: &tauri::AppHandle) -> AppResult<SyncSnapshotResultDto> {
    require_enabled(app)?;
    let state = app_state(app)?;
    let cfg = settings::load(&state.data_dir);
    if cfg.room_id.trim().is_empty() {
        return Err(AppError::invalid("请先填写直播间房间号"));
    }
    let session = {
        let db = state.lock_db()?;
        load_session(&db, &state.data_dir)?
    }.ok_or_else(|| AppError::new("E_SYNC_COOKIE", "尚未扫码登录，请先登录 B 站"))?;
    let source = bilibili::BiliSource { cookie: session.cookie.clone() };
    let members = match source.fetch_guard_snapshot(&cfg.room_id) {
        Ok(v) => v,
        Err(e) => {
            set_error(app, Some(e.message.clone()));
            if e.code == "E_SYNC_COOKIE" {
                if let Ok(db) = state.lock_db() { let _ = mark_expired(&db, true); }
            }
            return Err(AppError::new(&e.code, format!("{}。可继续使用 CSV / Excel 手动导入。", e.message)));
        }
    };
    let result = {
        let db = state.lock_db()?;
        mark_expired(&db, false)?;
        apply_snapshot(&db, &cfg.room_id, &members, source.source_kind())?
    };
    let rt = sync_state(app)?;
    *guard_mutex(&rt.last_error)? = None;
    *guard_mutex(&rt.last_sync_at)? = Some(now_iso());
    Ok(result)
}

fn meta_today(db: &Db, key: &str) -> AppResult<bool> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    let last: Option<String> = db.conn.query_row(
        "SELECT value FROM app_meta WHERE key=?1", [key], |r| r.get(0),
    ).optional()?;
    Ok(last.as_deref() == Some(today.as_str()))
}

fn set_meta_today(db: &Db, key: &str) -> AppResult<()> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    db.conn.execute(
        "INSERT INTO app_meta(key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, today],
    )?;
    Ok(())
}

/// 后台定时：只在用户启用同步、当天尚未尝试、且当前小时等于设定快照时刻时执行一次
pub fn run_scheduled(app: &tauri::AppHandle) {
    let Ok(state) = app_state(app) else { return; };
    let cfg = settings::load(&state.data_dir);
    if !cfg.sync_enabled || cfg.room_id.trim().is_empty() { return; }
    if Local::now().hour() as i32 != cfg.snapshot_hour { return; }
    let Ok(db) = state.lock_db() else { return; };
    let due = meta_today(&db, "sync_last_attempt_date").unwrap_or(false);
    let has_today = db.conn.query_row(
        "SELECT COUNT(*) FROM guard_snapshot WHERE snapshot_date=?1 AND source='snapshot'",
        [Local::now().format("%Y-%m-%d").to_string()], |r| r.get::<_, i64>(0),
    ).unwrap_or(0) > 0;
    if due || has_today { return; }
    let _ = set_meta_today(&db, "sync_last_attempt_date");
    drop(db);
    match snapshot_now(app) {
        Ok(r) => tracing::info!("定时同步完成：{} 人", r.member_count),
        Err(e) => tracing::warn!("定时同步失败：{}", e.message),
    }
}

pub fn schedule_loop(app: tauri::AppHandle) {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(300));
        run_scheduled(&app);
    }
}

/// 供概览页展示最近一次自动同步写入的快照数量
pub fn snapshot_count(db: &Db) -> AppResult<usize> {
    Ok(guard::list_snapshots(db)?.len())
}
