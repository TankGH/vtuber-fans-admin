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
}

export interface SettingsInput {
  theme?: ThemeKey;
  backupDir?: string;
  minimizeToTray?: boolean;
  launchAtStartup?: boolean;
  birthdayYearHidden?: boolean;
  onboardingDone?: boolean;
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
