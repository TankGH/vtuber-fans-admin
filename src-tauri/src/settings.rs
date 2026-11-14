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
            }
        }
    }
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
    });
    std::fs::write(path(data_dir), serde_json::to_string_pretty(&body)?)
        .map_err(|e| AppError::new("E_BACKUP_DIR", format!("配置写入失败：{e}")))?;
    Ok(())
}

/// 同步配置（Cookie / 快照时刻 / WS 开关）本期不接受写入，保持禁用态
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
    save(data_dir, &cfg)?;
    Ok(cfg)
}

pub fn backup_root(data_dir: &Path) -> std::path::PathBuf {
    let cfg = load(data_dir);
    std::path::PathBuf::from(cfg.backup_dir)
}
