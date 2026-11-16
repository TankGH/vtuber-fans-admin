use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::db::{self, AppState};
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::{backup, gifts, guard, import, ledger, profile, reminder, settings, sync};

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
struct ConfirmArgs { confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct LockArgs { uid: String, field: String, locked: bool }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DeleteArgs { uids: Vec<String>, confirm: Option<bool> }

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
struct CustomReminderArgs { input: Option<CustomReminderInput> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct BackupIdArgs { backup_id: String, confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ExportArgs { dest_path: Option<String>, confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct IdArgs { id: i64, confirm: Option<bool> }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct BatchIdArgs { batch_id: i64, dest_path: Option<String>, confirm: Option<bool> }

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>, payload: Value) -> AppResult<BootstrapDto> {
    let _ = payload;
    db::bootstrap(&state)
}

/// 清除全部数据必须带 confirm=true，前端危险操作弹窗负责二次确认
#[tauri::command]
pub fn app_clear_all_data(state: State<'_, AppState>, payload: Value) -> AppResult<()> {
    let a: ConfirmArgs = args(&payload)?;
    db::clear_all(&state, a.confirm == Some(true))
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

/// 批量删除档案必须带 confirm=true，由前端二次确认对话框传入
#[tauri::command]
pub fn profile_delete(state: State<'_, AppState>, payload: Value) -> AppResult<usize> {
    let a: DeleteArgs = args(&payload)?;
    let mut db = state.lock_db()?;
    profile::delete(&mut db, &a.uids, a.confirm == Some(true))
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

// ---- F3 纪念日提醒 ----

#[tauri::command]
pub fn reminder_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<ReminderDto>> {
    let q: ReminderQuery = args(&payload)?;
    let cfg = settings::load(&state.data_dir);
    let db = state.lock_db()?;
    reminder::list(&db, &q, &cfg)
}

#[tauri::command]
pub fn reminder_ack(state: State<'_, AppState>, payload: Value) -> AppResult<ReminderDto> {
    let input: ReminderAckInput = args(&payload)?;
    let cfg = settings::load(&state.data_dir);
    let db = state.lock_db()?;
    reminder::ack(&db, &input, &cfg)
}

#[tauri::command]
pub fn custom_reminder_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<CustomReminderDto>> {
    let _ = payload;
    let db = state.lock_db()?;
    reminder::list_custom(&db)
}

#[tauri::command]
pub fn custom_reminder_save(state: State<'_, AppState>, payload: Value) -> AppResult<CustomReminderDto> {
    let a: CustomReminderArgs = args(&payload)?;
    let input = a.input.ok_or_else(|| AppError::invalid("缺少纪念日内容"))?;
    let db = state.lock_db()?;
    reminder::save_custom(&db, &input)
}

/// 删除需要前端二次确认；同时清理该纪念日的历史处理标记
#[tauri::command]
pub fn custom_reminder_delete(state: State<'_, AppState>, payload: Value) -> AppResult<bool> {
    let a: IdArgs = args(&payload)?;
    let db = state.lock_db()?;
    reminder::delete_custom(&db, a.id)
}

/// 每日最多一次 Windows 原生 Toast；是否发送由 app_meta 中的日期标记决定
#[tauri::command]
pub fn reminder_notify(app: tauri::AppHandle, state: State<'_, AppState>, payload: Value) -> AppResult<bool> {
    use tauri_plugin_notification::NotificationExt;
    let _ = payload;
    let db = state.lock_db()?;
    let cfg = settings::load(&state.data_dir);
    let count = reminder::pending_count(&db, cfg.reminder_days_ahead, &cfg)?;
    if count == 0 || !reminder::should_toast(&db)? { return Ok(false); }
    app.notification().builder()
        .title("守村人·粉丝档案 · 纪念日提醒")
        .body(format!("未来 {} 天内有 {} 条待处理纪念日，请进入「纪念日提醒」查看。", cfg.reminder_days_ahead, count))
        .show()
        .map_err(|e| AppError::new("E_INTERNAL", format!("原生通知发送失败：{e}")))?;
    reminder::mark_toasted(&db)?;
    Ok(true)
}

// ---- F4 舰礼寄送台账 ----

#[tauri::command]
pub fn gift_batch_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<GiftBatchDto>> {
    let _ = payload;
    let db = state.lock_db()?;
    gifts::batch_list(&db)
}

#[tauri::command]
pub fn gift_batch_create(state: State<'_, AppState>, payload: Value) -> AppResult<GiftBatchDto> {
    let input: GiftBatchInput = args(&payload)?;
    let db = state.lock_db()?;
    gifts::batch_create(&db, &input)
}

#[tauri::command]
pub fn gift_shipment_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<GiftShipmentDto>> {
    let a: BatchIdArgs = args(&payload)?;
    let db = state.lock_db()?;
    gifts::shipment_list(&db, a.batch_id)
}

#[tauri::command]
pub fn gift_shipment_update(state: State<'_, AppState>, payload: Value) -> AppResult<GiftShipmentDto> {
    let input: GiftShipmentInput = args(&payload)?;
    let db = state.lock_db()?;
    gifts::shipment_update(&db, &input)
}

#[tauri::command]
pub fn gift_address_set_status(state: State<'_, AppState>, payload: Value) -> AppResult<()> {
    let input: GiftAddressStatusInput = args(&payload)?;
    let db = state.lock_db()?;
    gifts::address_set_status(&db, &input)
}

/// 完整地址必须携带 confirm=true，由前端二次确认对话框负责
#[tauri::command]
pub fn gift_shipment_reveal_address(state: State<'_, AppState>, payload: Value) -> AppResult<AddressDto> {
    let a: IdArgs = args(&payload)?;
    let db = state.lock_db()?;
    gifts::reveal_address(&db, a.id, a.confirm == Some(true))
}

#[tauri::command]
pub fn gift_batch_export(state: State<'_, AppState>, payload: Value) -> AppResult<ExportResult> {
    let a: BatchIdArgs = args(&payload)?;
    let db = state.lock_db()?;
    gifts::export_masked(&db, &state.data_dir, a.batch_id, a.dest_path.as_deref(), a.confirm == Some(true))
}

// ---- F5 主播记账本 ----

#[tauri::command]
pub fn ledger_list(state: State<'_, AppState>, payload: Value) -> AppResult<Vec<LedgerEntryDto>> {
    let q: LedgerQuery = args(&payload)?;
    let db = state.lock_db()?;
    ledger::list(&db, &q)
}

#[tauri::command]
pub fn ledger_create(state: State<'_, AppState>, payload: Value) -> AppResult<LedgerEntryDto> {
    let input: LedgerInput = args(&payload)?;
    let db = state.lock_db()?;
    ledger::create(&db, &input)
}

#[tauri::command]
pub fn ledger_delete(state: State<'_, AppState>, payload: Value) -> AppResult<()> {
    let a: LedgerIdArgs = args(&payload)?;
    let db = state.lock_db()?;
    ledger::delete(&db, a.id, a.confirm == Some(true))
}

#[tauri::command]
pub fn ledger_summary(state: State<'_, AppState>, payload: Value) -> AppResult<LedgerSummaryDto> {
    let _ = payload;
    let db = state.lock_db()?;
    ledger::summary(&db)
}

#[tauri::command]
pub fn ledger_sync_events(state: State<'_, AppState>, payload: Value) -> AppResult<LedgerSummaryDto> {
    let _ = payload;
    let db = state.lock_db()?;
    ledger::sync_events(&db)?;
    ledger::summary(&db)
}

// ---- 用户可选启用的 B 站同步 ----

/// 所有涉及网络的命令都在阻塞线程池执行，避免同步 HTTP 卡住主窗口；
/// 关闭同步时，除 sync_status 外不会发起任何外部请求。
async fn run_blocking<F, T>(app: tauri::AppHandle, task: F) -> AppResult<T>
where
    F: FnOnce(&tauri::AppHandle) -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || task(&app))
        .await
        .map_err(|e| AppError::new("E_INTERNAL", format!("同步任务异常：{e}")))?
}

#[tauri::command]
pub async fn sync_status(app: tauri::AppHandle, payload: Value) -> AppResult<SyncStatusDto> {
    let _ = payload;
    run_blocking(app, sync::status).await
}

#[tauri::command]
pub async fn sync_set_enabled(app: tauri::AppHandle, payload: Value) -> AppResult<SyncStatusDto> {
    let a: SyncEnableArgs = args(&payload)?;
    let (enabled, confirm) = (a.enabled, a.confirm == Some(true));
    run_blocking(app, move |h| sync::set_enabled(h, enabled, confirm)).await
}

#[tauri::command]
pub async fn sync_qr_start(app: tauri::AppHandle, payload: Value) -> AppResult<SyncQrDto> {
    let _ = payload;
    run_blocking(app, sync::qr_start).await
}

#[tauri::command]
pub async fn sync_qr_poll(app: tauri::AppHandle, payload: Value) -> AppResult<SyncQrPollDto> {
    let _ = payload;
    run_blocking(app, sync::qr_poll).await
}

#[tauri::command]
pub async fn sync_logout(app: tauri::AppHandle, payload: Value) -> AppResult<SyncStatusDto> {
    let _ = payload;
    run_blocking(app, sync::logout).await
}

#[tauri::command]
pub async fn sync_snapshot_now(app: tauri::AppHandle, payload: Value) -> AppResult<SyncSnapshotResultDto> {
    let _ = payload;
    run_blocking(app, sync::snapshot_now).await
}
