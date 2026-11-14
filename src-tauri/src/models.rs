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
    pub guard_level: Option<GuardLevel>,
    pub rank: Option<i32>,
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
    pub room_id: String,
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
    pub snapshot_hour: i32,
    pub websocket_enabled: bool,
    pub cookie_configured: bool,
    pub data_dir: String,
    pub onboarding_done: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupManifest {
    pub entries: Vec<BackupDto>,
    pub updated_at: String,
}
