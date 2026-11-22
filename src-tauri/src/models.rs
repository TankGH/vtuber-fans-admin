use serde::{Deserialize, Serialize};

pub type GuardLevel = i32;
pub type AddressStatus = String;
pub type GuardStatus = String;

pub const ADDRESS_STATUSES: &[&str] = &["none", "pending", "valid", "invalid", "shipped"];
pub const LOCKABLE_FIELDS: &[&str] = &[
    "nickname", "birthday", "address", "first_interaction_at",
    "guard_anniversary_date", "watch_anniversary_date", "note",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BirthdayValue {
    pub month: i32,
    pub day: i32,
    pub year: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AddressValue {
    pub receiver: String,
    pub phone: String,
    pub province: String,
    pub city: String,
    pub district: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanProfileDto {
    pub uid: String,
    pub current_nickname: String,
    pub nickname_history: Vec<String>,
    pub first_interaction_at: Option<String>,
    pub birthday_masked: Option<String>,
    pub address_masked: Option<String>,
    pub address_status: AddressStatus,
    pub guard_anniversary_date: Option<String>,
    pub watch_anniversary_date: Option<String>,
    pub note: String,
    pub manual_locked_fields: Vec<String>,
    /// 最新快照中的等级；为 None 表示当前不在名单中
    pub guard_level: Option<GuardLevel>,
    pub rank: Option<i32>,
    /// 最后一次出现在大航海名单中的等级，用于过期成员的灰化徽章
    pub last_guard_level: Option<GuardLevel>,
    /// 曾在大航海名单中但当前已不在（或有疑似到期事件）
    pub guard_expired: bool,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressDto {
    pub uid: String,
    pub receiver: String,
    pub phone: String,
    pub province: String,
    pub city: String,
    pub district: String,
    pub detail: String,
    pub address_status: AddressStatus,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FanProfileInput {
    pub uid: String,
    pub current_nickname: String,
    pub first_interaction_at: Option<String>,
    pub birthday: Option<BirthdayValue>,
    pub address: Option<AddressValue>,
    pub address_status: Option<AddressStatus>,
    pub guard_anniversary_date: Option<String>,
    pub watch_anniversary_date: Option<String>,
    pub note: Option<String>,
    pub manual_locked_fields: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileQuery {
    pub keyword: Option<String>,
    pub guard_level: Option<GuardLevel>,
    pub address_status: Option<AddressStatus>,
    pub only_locked: Option<bool>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardMemberDto {
    pub uid: String,
    pub nickname: String,
    pub guard_level: GuardLevel,
    pub rank: Option<i32>,
    pub valid_until: Option<String>,
    pub status: GuardStatus,
    pub snapshot_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub id: i64,
    pub snapshot_date: String,
    pub fetched_at: String,
    pub member_count: usize,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardEventDto {
    pub id: i64,
    pub uid: String,
    pub nickname: String,
    pub event_type: String,
    pub guard_level: Option<GuardLevel>,
    pub unit_months: Option<i32>,
    pub price_yuan: Option<f64>,
    pub event_at: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportMapping {
    pub uid: String,
    pub nickname: String,
    pub guard_level: String,
    pub rank: String,
    pub first_interaction_at: String,
    pub birthday: String,
    pub address: String,
    pub note: String,
    pub unit_months: String,
    pub price_yuan: String,
    /// 事件类型列（purchase / renew / 购买 / 续费）
    pub event_type: String,
    /// 购买 / 续费发生日期列
    pub event_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldConflict {
    pub row: usize,
    pub field: String,
    pub uid: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowDto {
    pub row: usize,
    pub uid: String,
    pub nickname: String,
    pub action: String,
    pub reason: String,
    pub guard_level: Option<GuardLevel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub total_rows: usize,
    pub new_count: usize,
    pub merge_count: usize,
    pub conflict_count: usize,
    pub invalid_count: usize,
    pub headers: Vec<String>,
    pub suggested_mapping: ImportMapping,
    pub conflicts: Vec<FieldConflict>,
    pub rows: Vec<ImportRowDto>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub batch_id: i64,
    pub total_rows: usize,
    pub new_count: usize,
    pub merge_count: usize,
    pub skipped_count: usize,
    /// 本次生成的大航海购买 / 续费事件数（供记账本归集）
    pub event_count: usize,
    /// 实际采用的快照日期
    pub snapshot_date: String,
    /// 非致命提示，例如金额 / 月数列未映射
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDto {
    pub id: String,
    pub file_name: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub fan_count: usize,
    pub snapshot_count: usize,
    pub event_count: usize,
    pub sha256: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsDto {
    pub theme: String,
    pub backup_dir: String,
    pub minimize_to_tray: bool,
    pub launch_at_startup: bool,
    pub birthday_year_hidden: bool,
    pub data_dir: String,
    pub onboarding_done: bool,
    pub reminder_days_ahead: i32,
    /// 百日提醒：按 100×n 天自动生成（n 为正整数），可独立开关
    pub milestone_hundreds_enabled: bool,
    /// 周年提醒：按 n 周年自动生成（n 为正整数），可独立开关
    pub milestone_years_enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsInput {
    pub theme: Option<String>,
    pub backup_dir: Option<String>,
    pub minimize_to_tray: Option<bool>,
    pub launch_at_startup: Option<bool>,
    pub birthday_year_hidden: Option<bool>,
    pub onboarding_done: Option<bool>,
    pub reminder_days_ahead: Option<i32>,
    pub milestone_hundreds_enabled: Option<bool>,
    pub milestone_years_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDto {
    pub id: i64,
    pub kind: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupHealth {
    pub last_backup_at: Option<String>,
    pub days_since_backup: Option<i64>,
    pub backup_count: usize,
    pub healthy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub fan_count: usize,
    pub guard_count: usize,
    pub snapshot_count: usize,
    pub conflict_count: usize,
    /// 待处理的纪念日提醒数量，用于顶栏角标
    pub reminder_count: usize,
    pub settings: SettingsDto,
    pub backup_health: BackupHealth,
    pub activities: Vec<ActivityDto>,
    pub data_dir: String,
    pub native_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size_bytes: u64,
    pub masked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePlan {
    pub backup_id: String,
    pub safety_backup_id: String,
    pub fan_count: usize,
    pub requires_restart: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportArgs {
    pub file_path: Option<String>,
    pub file_content: Option<String>,
    pub file_name: Option<String>,
    pub kind: Option<String>,
    pub mapping: Option<ImportMapping>,
    pub snapshot_date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedRow {
    pub row: usize,
    pub uid: String,
    pub nickname: String,
    pub guard_level: Option<GuardLevel>,
    pub rank: Option<i32>,
    pub first_interaction_at: String,
    pub birthday: String,
    pub address: String,
    pub note: String,
    pub unit_months: Option<i32>,
    pub price_yuan: Option<f64>,
    /// 归一化后的事件类型：purchase / renew
    pub event_type: Option<String>,
    /// 购买 / 续费日期（YYYY-MM-DD）或完整 ISO 时间
    pub event_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupManifest {
    pub entries: Vec<BackupDto>,
    pub updated_at: String,
}

// ---- F3 纪念日提醒 ----

pub const REMINDER_TYPES: &[&str] = &["birthday", "guard_anniversary", "watch_anniversary"];
pub const CUSTOM_REMINDER_RULES: &[&str] = &["annual", "days", "once"];
/// 全局纪念日没有 UID，用固定哨兵值参与 reminder_ack 主键
pub const GLOBAL_REMINDER_UID: &str = "__global__";

/// 动态类型 guard_days_{n} / custom_{id} 同样合法；ack 时用此函数校验而非固定枚举
pub fn valid_reminder_type(kind: &str) -> bool {
    if REMINDER_TYPES.contains(&kind) { return true; }
    if let Some(n) = kind.strip_prefix("guard_days_") {
        return !n.is_empty() && n.parse::<u32>().is_ok();
    }
    if let Some(id) = kind.strip_prefix("custom_") {
        return !id.is_empty() && id.parse::<i64>().is_ok();
    }
    false
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDto {
    pub uid: String,
    pub nickname: String,
    pub reminder_type: String,
    pub reminder_label: String,
    /// 本次触发的具体日期（YYYY-MM-DD），与 reminder_ack 主键一致
    pub reminder_date: String,
    /// 距离今天还有几天，0 表示就是今天
    pub days_ahead: i32,
    pub acked: bool,
    pub acked_at: Option<String>,
    /// 预设祝福话术，只含昵称与纪念日名称，不含生日年份或地址
    pub greeting: String,
    /// auto = 由档案自动生成，custom = 用户自建
    pub source: String,
    pub custom_id: Option<i64>,
    /// 里程碑描述，如「100 天」「3 周年」
    pub milestone: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomReminderDto {
    pub id: i64,
    pub title: String,
    pub uid: Option<String>,
    pub nickname: Option<String>,
    pub anchor_date: String,
    /// annual = 每年同月日；days = 起算后第 N 天（一次性）；once = 指定日期（一次性）
    pub rule: String,
    pub offset_days: i32,
    pub note: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CustomReminderInput {
    pub id: Option<i64>,
    pub title: String,
    pub uid: Option<String>,
    pub anchor_date: String,
    pub rule: String,
    pub offset_days: Option<i32>,
    pub note: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderQuery {
    pub days_ahead: Option<i32>,
    pub include_acked: Option<bool>,
    /// 只返回指定来源：auto / custom
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ReminderAckInput {
    pub uid: String,
    pub reminder_type: String,
    pub reminder_date: String,
    pub acked: Option<bool>,
}

// ---- F4 舰礼寄送台账 ----

pub const SHIPMENT_STATUSES: &[&str] = &["pending", "address_missing", "shipped", "invalid_address"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftBatchDto {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub status: String,
    pub member_count: usize,
    pub shipped_count: usize,
    pub pending_count: usize,
    pub address_ready_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftShipmentDto {
    pub id: i64,
    pub batch_id: i64,
    pub uid: String,
    pub nickname: String,
    pub guard_level: Option<i32>,
    pub address_status: String,
    pub address_masked: Option<String>,
    pub shipment_status: String,
    pub tracking_no: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GiftBatchInput {
    pub name: String,
    pub member_uids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GiftShipmentInput {
    pub id: i64,
    pub shipment_status: Option<String>,
    pub tracking_no: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GiftAddressStatusInput {
    pub uid: String,
    pub address_status: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GiftIdArgs {
    pub id: i64,
    pub confirm: Option<bool>,
}

// ---- F5 主播记账本 ----

pub const LEDGER_TYPES: &[&str] = &["income", "expense"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntryDto {
    pub id: i64,
    pub entry_type: String,
    pub category: String,
    pub amount_yuan: f64,
    pub occurred_at: String,
    pub batch_id: Option<i64>,
    pub guard_event_id: Option<i64>,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LedgerInput {
    pub entry_type: String,
    pub category: String,
    pub amount_yuan: f64,
    pub occurred_at: String,
    pub batch_id: Option<i64>,
    pub guard_event_id: Option<i64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LedgerQuery {
    pub entry_type: Option<String>,
    pub month: Option<String>,
    pub batch_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LedgerIdArgs {
    pub id: i64,
    pub confirm: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerBucketDto {
    pub month: String,
    pub income_yuan: f64,
    pub expense_yuan: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSummaryDto {
    pub total_income_yuan: f64,
    pub total_expense_yuan: f64,
    pub net_yuan: f64,
    pub entry_count: usize,
    pub buckets: Vec<LedgerBucketDto>,
    pub unlinked_event_count: usize,
}

