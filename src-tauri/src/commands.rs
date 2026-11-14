use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::{backup, guard, import, profile, settings};

/// 所有命令统一接收一个 payload 对象，避免跨语言参数命名歧义；参数校验集中在此
fn args<T: DeserializeOwned>(payload: &Value) -> AppResult<T> {
    serde_json::from_value(payload.clone())
        .map_err(|e| AppError::invalid(format!("参数格式错误：{e}")))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UidArgs { uid: String, confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct LockArgs { uid: String, field: String, locked: bool }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CreateArgs { input: Option<FanProfileInput> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct UpdateArgs { uid: String, input: Option<FanProfileInput> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SettingsArgs { input: Option<SettingsInput> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct BackupIdArgs { backup_id: String, confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ExportArgs { dest_path: Option<String>, confirm: Option<bool> }

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>, payload: Value) -> AppResult<BootstrapDto> {
    let _ = payload;
    db::bootstrap(&state)
}

#[tauri::command]
pub fn profile_list(state: State<'_, AppState>, payload: Value) -> AppResult<Paged<FanProfileDto>> {
    let q: ProfileQuery = args(&payload)?;
    let hide_year = settings::load(&state.data_dir).birthday_year_hidden;
    let db = state.lock_db()?;
    profile::list(&db, &q, hide_year)
}

#[tauri::command]
pub fn profile_get(state: State<'_, AppState>, payload: Value) -> AppResult<FanProfileDto> {
    let a: UidArgs = args(&payload)?;
    let hide_year = settings::load(&state.data_dir).birthday_year_hidden;
    let db = state.lock_db()?;
    profile::get(&db, &a.uid, hide_year)
}

#[tauri::command]
pub fn profile_create(state: State<'_, AppState>, payload: Value) -> AppResult<FanProfileDto> {
    let a: CreateArgs = args(&payload)?;
    let input = a.input.ok_or_else(|| AppError::invalid("缺少档案内容"))?;
    let db = state.lock_db()?;
    profile::create(&db, &input)
}

#[tauri::command]
pub fn profile_update(state: State<'_, AppState>, payload: Value) -> AppResult<FanProfileDto> {
    let a: UpdateArgs = args(&payload)?;
    let input = a.input.ok_or_else(|| AppError::invalid("缺少档案内容"))?;
    let db = state.lock_db()?;
    profile::update(&db, &a.uid, &input)
}

/// 完整地址必须带 confirm=true，前端二次确认对话框负责传入
#[tauri::command]
pub fn profile_reveal_address(state: State<'_, AppState>, payload: Value) -> AppResult<Option<AddressDto>> {
    let a: UidArgs = args(&payload)?;
    if a.confirm != Some(true) {
        return Err(AppError::invalid("查看完整地址需要二次确认"));
    }
    let db = state.lock_db()?;
    Ok(Some(profile::reveal_address(&db, &a.uid)?))
}

#[tauri::command]
pub fn profile_set_lock(state: State<'_, AppState>, payload: Value) -> AppResult<FanProfileDto> {
    let a: LockArgs = args(&payload)?;
    let db = state.lock_db()?;
    profile::set_lock(&db, &a.uid, &a.field, a.locked)
}

#[tauri::command]
pub fn guard_list(state: State<'_, AppState>, payload: Value) -> AppResult<Paged<GuardMemberDto>> {
    let _ = payload;
    let db = state.lock_db()?;
    let items = guard::list_members(&db)?;
    let total = items.len();
    Ok(Paged { items, total, page: 1, page_size: 50 })
}

#[tauri::command]
pub fn guard_snapshots(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<SnapshotDto>> {
    let _ = payload;
    let db = state.lock_db()?;
    guard::list_snapshots(&db)
}

#[tauri::command]
pub fn guard_events(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<GuardEventDto>> {
    let a: UidArgs = args(&payload)?;
    let db = state.lock_db()?;
    guard::list_events(&db, if a.uid.is_empty() { None } else { Some(&a.uid) })
}

#[tauri::command]
pub fn import_parse(state: State<'_, AppState>, payload: Value) -> AppResult<ImportPreview> {
    let a: ImportArgs = args(&payload)?;
    import::preview(&state, &a)
}

#[tauri::command]
pub fn import_commit(state: State<'_, AppState>, payload: Value) -> AppResult<ImportResult> {
    let a: ImportArgs = args(&payload)?;
    import::commit(&state, &a)
}

#[tauri::command]
pub fn backup_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<BackupDto>> {
    let _ = payload;
    backup::list_backups(&state)
}

#[tauri::command]
pub fn backup_now(state: State<'_, AppState>, payload: Value) -> AppResult<BackupDto> {
    let _ = payload;
    backup::backup_now(&state)
}

#[tauri::command]
pub fn backup_export_db(state: State<'_, AppState>, payload: Value) -> AppResult<ExportResult> {
    let a: ExportArgs = args(&payload)?;
    if a.confirm != Some(true) { return Err(AppError::invalid("导出加密库需要二次确认")); }
    backup::export_db(&state, a.dest_path.as_deref())
}

#[tauri::command]
pub fn backup_export_csv(state: State<'_, AppState>, payload: Value) -> AppResult<ExportResult> {
    let a: ExportArgs = args(&payload)?;
    backup::export_csv(&state, a.dest_path.as_deref())
}

#[tauri::command]
pub fn restore_prepare(state: State<'_, AppState>, payload: Value) -> AppResult<RestorePlan> {
    let a: BackupIdArgs = args(&payload)?;
    if a.confirm != Some(true) { return Err(AppError::invalid("恢复操作需要二次确认")); }
    backup::restore_prepare(&state, &a.backup_id)
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, payload: Value) -> AppResult<SettingsDto> {
    let _ = payload;
    Ok(settings::load(&state.data_dir))
}

#[tauri::command]
pub fn settings_update(state: State<'_, AppState>, payload: Value) -> AppResult<SettingsDto> {
    let a: SettingsArgs = args(&payload)?;
    let input = a.input.unwrap_or_default();
    settings::update(&state.data_dir, input)
}

#[tauri::command]
pub fn open_data_dir(state: State<'_, AppState>, payload: Value) -> AppResult<()> {
    let _ = payload;
    let dir = state.data_dir.clone();
    // 仅打开本地数据目录，不执行任何 shell 命令字符串
    std::process::Command::new("explorer").arg(&dir).spawn()
        .map_err(|e| AppError::new("E_INTERNAL", format!("打开数据目录失败：{e}")))?;
    Ok(())
}
