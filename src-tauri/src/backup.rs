use std::fs;
use std::path::{Path, PathBuf};

use crate::crypto::{now_iso, sha256_hex};
use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::models::{BackupDto, BackupManifest, ExportResult, RestorePlan};
use crate::settings;

const MAX_BACKUPS: usize = 7;
const MANIFEST: &str = "manifest.json";
const MARKER: &str = "restore.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct RestoreMarker {
    backup_id: String,
    file_name: String,
    created_at: String,
}

fn backup_dir(state: &AppState) -> PathBuf {
    settings::backup_root(&state.data_dir)
}

fn manifest_path(dir: &Path) -> PathBuf { dir.join(MANIFEST) }

fn read_manifest(dir: &Path) -> AppResult<BackupManifest> {
    let p = manifest_path(dir);
    if !p.exists() { return Ok(BackupManifest::default()); }
    let raw = fs::read_to_string(&p)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write_manifest(dir: &Path, manifest: &BackupManifest) -> AppResult<()> {
    fs::create_dir_all(dir).map_err(|e| AppError::new("E_BACKUP_DIR", format!("备份目录不可写：{e}")))?;
    let body = serde_json::to_string_pretty(manifest)?;
    fs::write(manifest_path(dir), body)?;
    Ok(())
}

fn verify(dir: &Path, entry: &BackupDto) -> bool {
    let p = dir.join(&entry.file_name);
    match fs::read(&p) {
        Ok(bytes) => sha256_hex(&bytes) == entry.sha256,
        Err(_) => false,
    }
}

pub fn list_backups(state: &AppState) -> AppResult<Vec<BackupDto>> {
    let dir = backup_dir(state);
    let mut list = read_manifest(&dir)?.entries;
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for e in &mut list { e.verified = verify(&dir, e); }
    Ok(list)
}

/// VACUUM INTO 一致性快照 → 整体加密 → 校验摘要 → 最近 7 份滚动
pub fn backup_now(state: &AppState) -> AppResult<BackupDto> {
    let dir = backup_dir(state);
    fs::create_dir_all(&dir).map_err(|e| AppError::new("E_BACKUP_DIR", format!("备份目录不可写，请重新选择目录：{e}")))?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%3f").to_string();
    let id = format!("{}-{}", stamp.replace('-', ""), &sha256_hex(stamp.as_bytes())[..6]);
    let file_name = format!("backup-{id}.enc");
    let temp = state.data_dir.join(format!("vacuum-{id}.db"));
    {
        let db = state.lock_db()?;
        db::vacuum_into(&db.conn, &temp)?;
        let fan_count = db::count(&db.conn, "fan_profile")?;
        let snapshot_count = db::count(&db.conn, "guard_snapshot")?;
        let event_count = db::count(&db.conn, "guard_event")?;
        let plain = fs::read(&temp)?;
        let encrypted = db.crypto.encrypt(&plain)?;
        let target = dir.join(&file_name);
        fs::write(&target, &encrypted)?;
        let entry = BackupDto {
            id: id.clone(), file_name: file_name.clone(), created_at: now_iso(),
            size_bytes: encrypted.len() as u64, fan_count, snapshot_count, event_count,
            sha256: sha256_hex(&encrypted), verified: true,
        };
        let mut manifest = read_manifest(&dir)?;
        manifest.entries.insert(0, entry.clone());
        manifest.entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        manifest.entries.truncate(MAX_BACKUPS);
        manifest.updated_at = now_iso();
        write_manifest(&dir, &manifest)?;
        db::log_activity(&db.conn, "backup", &format!("备份 {file_name} 完成，保留最近 {MAX_BACKUPS} 份"))?;
        cleanup_orphans(&dir, &manifest)?;
        let _ = fs::remove_file(&temp);
        Ok(entry)
    }
}

fn cleanup_orphans(dir: &Path, manifest: &BackupManifest) -> AppResult<()> {
    let keep: Vec<&str> = manifest.entries.iter().map(|e| e.file_name.as_str()).collect();
    let entries = fs::read_dir(dir)?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("backup-") && name.ends_with(".enc") && !keep.contains(&name.as_str()) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// 清除本应用生成的备份与导出文件，不触碰用户放在同一目录的其它文件
pub fn purge_app_files(state: &AppState) -> AppResult<usize> {
    let dir = backup_dir(state);
    if !dir.exists() { return Ok(0); }
    let mut removed = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        let app_file = name == MANIFEST
            || (name.starts_with("backup-") && name.ends_with(".enc"))
            || (name.starts_with("export-") && name.ends_with(".enc"))
            || (name.starts_with("fans-masked-") && name.ends_with(".csv"));
        if app_file && fs::remove_file(entry.path()).is_ok() { removed += 1; }
    }
    Ok(removed)
}

pub fn clear_restore_marker(data_dir: &Path) -> AppResult<()> {
    let p = data_dir.join(MARKER);
    if p.exists() {
        fs::remove_file(p).map_err(|e| AppError::new("E_RESTORE_MARKER", format!("恢复标记清除失败：{e}")))?;
    }
    Ok(())
}

/// 启动时执行：数据库打开前处理恢复标记；返回是否已替换
pub fn apply_restore_marker(data_dir: &Path) -> AppResult<bool> {
    let marker_path = data_dir.join(MARKER);
    if !marker_path.exists() { return Ok(false); }
    let raw = fs::read_to_string(&marker_path)?;
    let marker: RestoreMarker = serde_json::from_str(&raw)
        .map_err(|e| AppError::new("E_RESTORE_MARKER", format!("恢复标记损坏：{e}")))?;
    let cfg = settings::load(data_dir);
    let source = PathBuf::from(&cfg.backup_dir).join(&marker.file_name);
    if !source.exists() {
        return Err(AppError::new("E_RESTORE_VERIFY", "选中的备份文件已不存在，未改动当前数据"));
    }
    let encrypted = fs::read(&source)?;
    let digest = sha256_hex(&encrypted);
    let manifest: BackupManifest = serde_json::from_str(
        &fs::read_to_string(PathBuf::from(&cfg.backup_dir).join(MANIFEST)).unwrap_or_default(),
    ).unwrap_or_default();
    let matched = manifest.entries.iter().any(|e| e.id == marker.backup_id && e.sha256 == digest);
    if !matched {
        return Err(AppError::new("E_RESTORE_VERIFY", "备份校验未通过，未改动当前数据"));
    }
    let crypto = crate::crypto::Crypto::load(data_dir)?;
    let plain = crypto.decrypt(&encrypted)
        .map_err(|_| AppError::new("E_RESTORE_VERIFY", "备份解密失败，未改动当前数据"))?;
    let candidate = data_dir.join("restore-candidate.db");
    fs::write(&candidate, &plain)?;
    // 打开候选库验证 SQLite 结构与记录数，避免写入损坏文件
    let check = rusqlite::Connection::open(&candidate)
        .map_err(|e| AppError::new("E_RESTORE_VERIFY", format!("备份文件不是有效数据库：{e}")))?;
    let n: i64 = check.query_row("SELECT COUNT(*) FROM fan_profile", [], |r| r.get(0))
        .map_err(|e| AppError::new("E_RESTORE_VERIFY", format!("备份结构校验失败：{e}")))?;
    drop(check);
    if n < 0 { return Err(AppError::new("E_RESTORE_VERIFY", "备份记录数异常")); }
    let target = data_dir.join("fans.db");
    let _ = fs::remove_file(data_dir.join("fans.db-wal"));
    let _ = fs::remove_file(data_dir.join("fans.db-shm"));
    fs::copy(&candidate, &target)?;
    let _ = fs::remove_file(&candidate);
    fs::remove_file(&marker_path)
        .map_err(|e| AppError::new("E_RESTORE_MARKER", format!("恢复标记清除失败：{e}")))?;
    Ok(true)
}

pub fn restore_prepare(state: &AppState, backup_id: &str) -> AppResult<RestorePlan> {
    let dir = backup_dir(state);
    let entries = list_backups(state)?;
    let target = entries.iter().find(|e| e.id == backup_id)
        .ok_or_else(|| AppError::new("E_RESTORE_VERIFY", "找不到所选备份"))?;
    if !target.verified {
        return Err(AppError::new("E_RESTORE_VERIFY", "备份校验未通过，未改动当前数据"));
    }
    // 恢复前先为当前库再备份一次，任何恢复都可回退
    let safety = backup_now(state)?;
    let marker = RestoreMarker {
        backup_id: target.id.clone(), file_name: target.file_name.clone(), created_at: now_iso(),
    };
    fs::write(state.data_dir.join(MARKER), serde_json::to_string_pretty(&marker)?)?;
    {
        let db = state.lock_db()?;
        db::log_activity(&db.conn, "restore", &format!("准备从 {} 恢复，已创建安全备份 {}", target.created_at, safety.id))?;
    }
    let _ = dir;
    Ok(RestorePlan {
        backup_id: target.id.clone(), safety_backup_id: safety.id,
        fan_count: target.fan_count, requires_restart: true,
        message: "已创建安全备份并写入恢复标记，重启应用后完成恢复".to_string(),
    })
}

pub fn export_db(state: &AppState, dest: Option<&str>) -> AppResult<ExportResult> {
    let entry = backup_now(state)?;
    let dir = backup_dir(state);
    let source = dir.join(&entry.file_name);
    let target = match dest {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => dir.join(format!("export-{}.enc", chrono::Utc::now().format("%Y%m%d-%H%M%S"))),
    };
    if let Some(parent) = target.parent() { fs::create_dir_all(parent)?; }
    fs::copy(&source, &target)?;
    Ok(ExportResult {
        path: target.to_string_lossy().to_string(),
        size_bytes: fs::metadata(&target)?.len(), masked: false,
    })
}

/// 默认导出项：脱敏 CSV，不含完整地址、电话与生日年份
pub fn export_csv(state: &AppState, dest: Option<&str>) -> AppResult<ExportResult> {
    let db = state.lock_db()?;
    let mut stmt = db.conn.prepare(
        "SELECT uid, current_nickname, birthday_encrypted, address_encrypted, address_status,
         guard_anniversary_date, note, created_at FROM fan_profile ORDER BY uid",
    )?;
    let rows = stmt.query_map([], |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<Vec<u8>>>(2)?,
        r.get::<_, Option<Vec<u8>>>(3)?, r.get::<_, String>(4)?,
        r.get::<_, Option<String>>(5)?, r.get::<_, String>(6)?, r.get::<_, String>(7)?,
    )))?;
    let mut wtr = csv::Writer::from_writer(vec![]);
    wtr.write_record(["uid", "nickname", "birthday_masked", "address_masked", "address_status",
        "guard_anniversary_date", "note", "created_at"])
        .map_err(|e| AppError::new("E_BACKUP_IO", format!("CSV 生成失败：{e}")))?;
    for row in rows {
        let t = row?;
        let birthday = db.crypto.mask_birthday(&t.2, true).unwrap_or_default();
        let address = db.crypto.mask_address(&t.3).unwrap_or_default();
        wtr.write_record([&t.0, &t.1, &birthday, &address, &t.4,
            t.5.as_deref().unwrap_or(""), &t.6, &t.7])
            .map_err(|e| AppError::new("E_BACKUP_IO", format!("CSV 生成失败：{e}")))?;
    }
    let bytes = wtr.into_inner()
        .map_err(|e| AppError::new("E_BACKUP_IO", format!("CSV 生成失败：{e}")))?;
    let target = match dest {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => settings::backup_root(&state.data_dir)
            .join(format!("fans-masked-{}.csv", chrono::Utc::now().format("%Y%m%d-%H%M%S"))),
    };
    if let Some(parent) = target.parent() { fs::create_dir_all(parent)?; }
    fs::write(&target, &bytes)?;
    Ok(ExportResult {
        path: target.to_string_lossy().to_string(),
        size_bytes: bytes.len() as u64, masked: true,
    })
}
