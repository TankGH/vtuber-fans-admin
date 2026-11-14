use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::{SettingsDto, SettingsInput};

const FILE_NAME: &str = "settings.json";

fn default_backup_dir() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    format!("{home}\\Documents\\vtuber-fans-admin-backups")
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            theme: "galaxy".to_string(),
            backup_dir: default_backup_dir(),
            minimize_to_tray: true,
            launch_at_startup: false,
            birthday_year_hidden: true,
            snapshot_hour: 4,
            websocket_enabled: false,
            cookie_configured: false,
            data_dir: String::new(),
            onboarding_done: false,
            sync_enabled: false,
            room_id: String::new(),
            reminder_days_ahead: 3,
        }
    }
}

impl SettingsDto {
    pub fn to_dto(&self, data_dir: &Path) -> SettingsDto {
        let mut dto = self.clone();
        dto.data_dir = data_dir.to_string_lossy().to_string();
        dto
    }
}

pub fn path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(FILE_NAME)
}

pub fn load(data_dir: &Path) -> SettingsDto {
    let p = path(data_dir);
    let mut cfg = SettingsDto::default();
    if p.exists() {
        if let Ok(raw) = std::fs::read_to_string(&p) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(v) = parsed.get("theme").and_then(|v| v.as_str()) { cfg.theme = v.to_string(); }
                if let Some(v) = parsed.get("backupDir").and_then(|v| v.as_str()) { cfg.backup_dir = v.to_string(); }
                if let Some(v) = parsed.get("minimizeToTray").and_then(|v| v.as_bool()) { cfg.minimize_to_tray = v; }
                if let Some(v) = parsed.get("launchAtStartup").and_then(|v| v.as_bool()) { cfg.launch_at_startup = v; }
                if let Some(v) = parsed.get("birthdayYearHidden").and_then(|v| v.as_bool()) { cfg.birthday_year_hidden = v; }
                if let Some(v) = parsed.get("onboardingDone").and_then(|v| v.as_bool()) { cfg.onboarding_done = v; }
                if let Some(v) = parsed.get("syncEnabled").and_then(|v| v.as_bool()) { cfg.sync_enabled = v; }
                if let Some(v) = parsed.get("roomId").and_then(|v| v.as_str()) { cfg.room_id = v.to_string(); }
                if let Some(v) = parsed.get("snapshotHour").and_then(|v| v.as_i64()) { cfg.snapshot_hour = v as i32; }
                if let Some(v) = parsed.get("websocketEnabled").and_then(|v| v.as_bool()) { cfg.websocket_enabled = v; }
                if let Some(v) = parsed.get("reminderDaysAhead").and_then(|v| v.as_i64()) { cfg.reminder_days_ahead = v as i32; }
            }
        }
    }
    cfg.cookie_configured = crate::sync::session_path(data_dir).exists();
    cfg.data_dir = data_dir.to_string_lossy().to_string();
    cfg
}

pub fn save(data_dir: &Path, cfg: &SettingsDto) -> AppResult<()> {
    let body = serde_json::json!({
        "theme": cfg.theme,
        "backupDir": cfg.backup_dir,
        "minimizeToTray": cfg.minimize_to_tray,
        "launchAtStartup": cfg.launch_at_startup,
        "birthdayYearHidden": cfg.birthday_year_hidden,
        "snapshotHour": cfg.snapshot_hour,
        "websocketEnabled": cfg.websocket_enabled,
        "cookieConfigured": cfg.cookie_configured,
        "onboardingDone": cfg.onboarding_done,
        "syncEnabled": cfg.sync_enabled,
        "roomId": cfg.room_id,
        "reminderDaysAhead": cfg.reminder_days_ahead,
    });
    std::fs::write(path(data_dir), serde_json::to_string_pretty(&body)?)
        .map_err(|e| AppError::new("E_BACKUP_DIR", format!("配置写入失败：{e}")))?;
    Ok(())
}

/// 常规设置写入。同步开关本身只由 sync_set_enabled 修改，且必须带二次确认；
/// 此处仅允许房间号、快照时刻与提醒提前天数等不触发外部请求的配置。
pub fn update(data_dir: &Path, input: SettingsInput) -> AppResult<SettingsDto> {
    let mut cfg = load(data_dir);
    if let Some(v) = input.theme {
        if !["galaxy", "mist", "aurora"].contains(&v.as_str()) {
            return Err(AppError::invalid("主题值无效"));
        }
        cfg.theme = v;
    }
    if let Some(v) = input.backup_dir {
        if v.trim().is_empty() {
            return Err(AppError::new("E_BACKUP_DIR", "备份目录不能为空"));
        }
        cfg.backup_dir = v;
    }
    if let Some(v) = input.minimize_to_tray { cfg.minimize_to_tray = v; }
    if let Some(v) = input.launch_at_startup { cfg.launch_at_startup = v; }
    if let Some(v) = input.birthday_year_hidden { cfg.birthday_year_hidden = v; }
    if let Some(v) = input.onboarding_done { cfg.onboarding_done = v; }
    if let Some(v) = input.room_id {
        let trimmed = v.trim().to_string();
        if !trimmed.is_empty() && !trimmed.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::invalid("直播间房间号只能是纯数字"));
        }
        cfg.room_id = trimmed;
    }
    if let Some(v) = input.snapshot_hour {
        if !(0..=23).contains(&v) { return Err(AppError::invalid("每日快照时刻需在 0–23 之间")); }
        cfg.snapshot_hour = v;
    }
    if let Some(v) = input.reminder_days_ahead {
        if !(0..=14).contains(&v) { return Err(AppError::invalid("提醒提前天数需在 0–14 之间")); }
        cfg.reminder_days_ahead = v;
    }
    save(data_dir, &cfg)?;
    Ok(cfg)
}

/// 仅由用户显式开关调用：开启 / 关闭自动抓取
pub fn set_sync_enabled(data_dir: &Path, enabled: bool) -> AppResult<SettingsDto> {
    let mut cfg = load(data_dir);
    cfg.sync_enabled = enabled;
    save(data_dir, &cfg)?;
    Ok(cfg)
}

pub fn backup_root(data_dir: &Path) -> std::path::PathBuf {
    let cfg = load(data_dir);
    std::path::PathBuf::from(cfg.backup_dir)
}
