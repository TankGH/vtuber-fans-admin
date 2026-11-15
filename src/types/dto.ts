// 与 src-tauri/src/models.rs 的 serde 结构一一对应，改动需两侧同步

export type ThemeKey = "galaxy" | "mist" | "aurora";
export type AddressStatus = "none" | "pending" | "valid" | "invalid" | "shipped";
export type GuardLevel = 1 | 2 | 3;
export type GuardStatus = "active" | "expire_suspected";
export type EventType = "purchase" | "renew" | "expire_suspected";
export type SourceKind = "manual" | "import" | "snapshot" | "websocket";
export type ImportKind = "fans" | "guard" | "address" | "events";
export type FieldName =
  | "nickname"
  | "birthday"
  | "address"
  | "first_interaction_at"
  | "guard_anniversary_date"
  | "watch_anniversary_date"
  | "note";

export interface FanProfileDto {
  uid: string;
  currentNickname: string;
  nicknameHistory: string[];
  firstInteractionAt: string | null;
  birthdayMasked: string | null;
  addressMasked: string | null;
  addressStatus: AddressStatus;
  guardAnniversaryDate: string | null;
  watchAnniversaryDate: string | null;
  note: string;
  manualLockedFields: FieldName[];
  guardLevel: GuardLevel | null;
  rank: number | null;
  /** 最后一次出现在大航海名单中的等级（过期成员用于显示灰化徽章） */
  lastGuardLevel: GuardLevel | null;
  /** 曾在大航海名单中但当前已不在，或存在疑似到期事件 */
  guardExpired: boolean;
  source: SourceKind;
  createdAt: string;
  updatedAt: string;
}

export interface AddressDto {
  uid: string;
  receiver: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  addressStatus: AddressStatus;
}

export interface FanProfileInput {
  uid: string;
  currentNickname: string;
  firstInteractionAt?: string | null;
  birthday?: { month: number; day: number; year?: number | null } | null;
  address?: {
    receiver: string;
    phone: string;
    province: string;
    city: string;
    district: string;
    detail: string;
  } | null;
  addressStatus?: AddressStatus;
  guardAnniversaryDate?: string | null;
  watchAnniversaryDate?: string | null;
  note?: string;
  manualLockedFields?: FieldName[];
}

export interface ProfileQuery {
  keyword?: string;
  guardLevel?: GuardLevel | null;
  addressStatus?: AddressStatus | null;
  onlyLocked?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GuardMemberDto {
  uid: string;
  nickname: string;
  guardLevel: GuardLevel;
  rank: number | null;
  validUntil: string | null;
  status: GuardStatus;
  snapshotDate: string | null;
}

export interface SnapshotDto {
  id: number;
  snapshotDate: string;
  roomId: string;
  fetchedAt: string;
  memberCount: number;
  source: string;
}

export interface GuardEventDto {
  id: number;
  uid: string;
  nickname: string;
  eventType: EventType;
  guardLevel: GuardLevel | null;
  unitMonths: number | null;
  priceYuan: number | null;
  eventAt: string;
  source: string;
}

export interface ImportMapping {
  uid: string;
  nickname: string;
  guardLevel: string;
  rank: string;
  firstInteractionAt: string;
  birthday: string;
  address: string;
  note: string;
  /** 购买月数；与金额任一存在即生成一条大航海事件，供记账本归集 */
  unitMonths: string;
  priceYuan: string;
  /** 事件类型（purchase / renew），留空按购买处理 */
  eventType: string;
  /** 购买 / 续费发生日期，留空按导入时刻处理 */
  eventAt: string;
}

export interface FieldConflict {
  row: number;
  field: FieldName | string;
  uid: string;
  reason: string;
}

export interface ImportRowDto {
  row: number;
  uid: string;
  nickname: string;
  action: "new" | "merge" | "conflict" | "invalid";
  reason: string;
  guardLevel: GuardLevel | null;
}

export interface ImportPreview {
  totalRows: number;
  newCount: number;
  mergeCount: number;
  conflictCount: number;
  invalidCount: number;
  headers: string[];
  suggestedMapping: ImportMapping;
  conflicts: FieldConflict[];
  rows: ImportRowDto[];
  truncated: boolean;
}

export interface ImportResult {
  batchId: number;
  totalRows: number;
  newCount: number;
  mergeCount: number;
  skippedCount: number;
  /** 本次导入生成的大航海购买 / 续费事件数 */
  eventCount: number;
  /** 实际采用的快照日期（YYYY-MM-DD） */
  snapshotDate: string;
  /** 非致命提示，例如「金额 / 月数未映射，未生成收入事件」 */
  warnings: string[];
  errors: string[];
  createdAt: string;
}

export interface BackupDto {
  id: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  fanCount: number;
  snapshotCount: number;
  eventCount: number;
  sha256: string;
  verified: boolean;
}

export interface SettingsDto {
  theme: ThemeKey;
  backupDir: string;
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  birthdayYearHidden: boolean;
  snapshotHour: number;
  websocketEnabled: boolean;
  cookieConfigured: boolean;
  dataDir: string;
  onboardingDone: boolean;
  syncEnabled: boolean;
  roomId: string;
  reminderDaysAhead: number;
  /** 百日提醒：100×n 天，n 为正整数 */
  milestoneHundredsEnabled: boolean;
  /** 周年提醒：n 周年，n 为正整数 */
  milestoneYearsEnabled: boolean;
}

export interface SettingsInput {
  theme?: ThemeKey;
  backupDir?: string;
  minimizeToTray?: boolean;
  launchAtStartup?: boolean;
  birthdayYearHidden?: boolean;
  onboardingDone?: boolean;
  roomId?: string;
  snapshotHour?: number;
  reminderDaysAhead?: number;
  milestoneHundredsEnabled?: boolean;
  milestoneYearsEnabled?: boolean;
}

export interface ActivityDto {
  id: number;
  kind: string;
  summary: string;
  createdAt: string;
}

export interface BackupHealth {
  lastBackupAt: string | null;
  daysSinceBackup: number | null;
  backupCount: number;
  healthy: boolean;
}

export interface BootstrapDto {
  fanCount: number;
  guardCount: number;
  snapshotCount: number;
  conflictCount: number;
  reminderCount: number;
  syncStatus: SyncStatusDto;
  settings: SettingsDto;
  backupHealth: BackupHealth;
  activities: ActivityDto[];
  dataDir: string;
  nativeMode: boolean;
}

export interface ExportResult {
  path: string;
  sizeBytes: number;
  masked: boolean;
}

export interface RestorePlan {
  backupId: string;
  safetyBackupId: string;
  fanCount: number;
  requiresRestart: boolean;
  message: string;
}

export interface AppErrorPayload {
  code: string;
  message: string;
}

export interface ImportParseArgs {
  filePath?: string;
  fileContent?: string;
  fileName?: string;
  kind: ImportKind;
  mapping: ImportMapping;
  snapshotDate?: string;
}

export interface ImportCommitArgs extends ImportParseArgs {
  previewToken?: string;
}

// ---- F3 纪念日提醒 ----

// 类型标识含动态部分：guard_days_100 / guard_years_3 / custom_12
export type ReminderType = string;

export type ReminderRule = "annual" | "days" | "once";

export const CUSTOM_REMINDER_RULES: Array<{ value: ReminderRule; label: string; hint: string }> = [
  { value: "annual", label: "每年重复", hint: "按起算日期的月日，每年循环提醒" },
  { value: "days", label: "起算后第 N 天", hint: "一次性，例如上舰 100 天、相识 500 天" },
  { value: "once", label: "仅指定日期一次", hint: "一次性，过期后不再出现" },
];

export interface ReminderDto {
  uid: string;
  nickname: string;
  reminderType: ReminderType;
  reminderLabel: string;
  reminderDate: string;
  daysAhead: number;
  acked: boolean;
  ackedAt: string | null;
  greeting: string;
  source: "auto" | "custom";
  customId: number | null;
  milestone: string | null;
}

export interface CustomReminderDto {
  id: number;
  title: string;
  uid: string | null;
  nickname: string | null;
  anchorDate: string;
  rule: ReminderRule;
  offsetDays: number;
  note: string;
  enabled: boolean;
  createdAt: string;
}

export interface CustomReminderInput {
  id?: number;
  title: string;
  uid?: string | null;
  anchorDate: string;
  rule: ReminderRule;
  offsetDays?: number;
  note?: string;
  enabled?: boolean;
}

export interface ReminderQuery {
  daysAhead?: number;
  includeAcked?: boolean;
  source?: "auto" | "custom";
}

export interface ReminderAckInput {
  uid: string;
  reminderType: ReminderType;
  reminderDate: string;
  acked?: boolean;
}

// ---- F4 舰礼寄送台账 ----

export type ShipmentStatus = "pending" | "address_missing" | "shipped" | "invalid_address";

export interface GiftBatchDto {
  id: number;
  name: string;
  createdAt: string;
  status: string;
  memberCount: number;
  shippedCount: number;
  pendingCount: number;
  addressReadyCount: number;
}

export interface GiftShipmentDto {
  id: number;
  batchId: number;
  uid: string;
  nickname: string;
  guardLevel: GuardLevel | null;
  addressStatus: AddressStatus;
  addressMasked: string | null;
  shipmentStatus: ShipmentStatus;
  trackingNo: string | null;
  updatedAt: string;
}

export interface GiftBatchInput {
  name: string;
  memberUids: string[];
}

export interface GiftShipmentInput {
  id: number;
  shipmentStatus?: ShipmentStatus;
  trackingNo?: string;
}

// ---- F5 主播记账本 ----

export type LedgerType = "income" | "expense";

export interface LedgerEntryDto {
  id: number;
  entryType: LedgerType;
  category: string;
  amountYuan: number;
  occurredAt: string;
  batchId: number | null;
  guardEventId: number | null;
  note: string;
}

export interface LedgerInput {
  entryType: LedgerType;
  category: string;
  amountYuan: number;
  occurredAt: string;
  batchId?: number | null;
  guardEventId?: number | null;
  note?: string;
}

export interface LedgerQuery {
  entryType?: LedgerType | "";
  month?: string;
  batchId?: number;
}

export interface LedgerBucketDto {
  month: string;
  incomeYuan: number;
  expenseYuan: number;
}

export interface LedgerSummaryDto {
  totalIncomeYuan: number;
  totalExpenseYuan: number;
  netYuan: number;
  entryCount: number;
  buckets: LedgerBucketDto[];
  unlinkedEventCount: number;
}

// ---- 用户可选启用的 B 站同步 ----

export type LoginState = "disabled" | "not_logged_in" | "logged_in" | "expired";

export interface SyncStatusDto {
  enabled: boolean;
  loginState: LoginState;
  cookieConfigured: boolean;
  mid: string;
  uname: string;
  roomId: string;
  snapshotHour: number;
  lastSyncAt: string | null;
  lastError: string | null;
  message: string;
}

export interface SyncQrDto {
  qrSvg: string;
  qrUrl: string;
  qrcodeKey: string;
  expiresIn: number;
  message: string;
}

export interface SyncQrPollDto {
  status: "waiting" | "scanned" | "expired" | "success" | "error";
  message: string;
  uname: string | null;
}

export interface SyncSnapshotResultDto {
  snapshotId: number;
  snapshotDate: string;
  memberCount: number;
  newCount: number;
  mergeCount: number;
  source: string;
}

export interface SyncEnableArgs {
  enabled: boolean;
  confirm?: boolean;
}
